"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../site/app.js"), "utf8");
const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Evaluate the real browser script. DOMContentLoaded is registered but never
// dispatched: the tests exercise its loaders and calculations without a DOM.
function loadApp(fetch) {
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    window: {
      I18n: { locale: () => "en-US", t: (key) => key },
      matchMedia: () => ({ matches: false }),
    },
    document: { documentElement: {}, addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "#000000" }),
    AbortController,
    fetch,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(appSource, context, { filename: "site/app.js" });
  return {
    api: context,
    state: vm.runInContext("state", context),
    timers,
    expire(id) { timers.get(id).callback(); },
  };
}

// Header arrival and body completion are independently controllable, like a
// real fetch Response. Abort rejects whichever phase is still outstanding.
function transport({ cancelFails = false } = {}) {
  const requests = [];
  let active = 0;
  let peak = 0;
  return {
    requests,
    get active() { return active; },
    get peak() { return peak; },
    fetch(url, options) {
      const headers = deferred();
      const body = deferred();
      let headersSent = false;
      let bodyRead = false;
      let bodyCancelled = false;
      let completed = false;
      active += 1;
      peak = Math.max(peak, active);
      const finish = () => {
        if (!completed) { completed = true; active -= 1; }
      };
      const request = {
        url,
        options,
        get pending() { return !completed; },
        get bodyCancelled() { return bodyCancelled; },
        headers(status = 200) {
          if (headersSent) return;
          headersSent = true;
          headers.resolve({
            ok: status === 200,
            status,
            body: { cancel() {
              bodyCancelled = true;
              if (cancelFails) return Promise.reject(new Error("cancel failed"));
              finish();
              return Promise.resolve();
            } },
            json: () => { bodyRead = true; return body.promise.finally(finish); },
          });
        },
        complete(value) {
          request.headers();
          body.resolve(value);
        },
        fail(error) {
          if (completed) return;
          if (bodyRead) body.reject(error);
          else if (headersSent) finish();
          else { finish(); headers.reject(error); }
        },
      };
      options.signal.addEventListener("abort", () => {
        request.fail(new DOMException("Aborted", "AbortError"));
      }, { once: true });
      requests.push(request);
      return headers.promise;
    },
  };
}

async function completeAll(network, snapshotFor) {
  while (network.requests.some((request) => request.pending)) {
    // Deliberately finish each batch in reverse order. Promise.all must keep
    // snapshot chronology regardless of network completion order.
    for (const request of network.requests.filter((item) => item.pending).reverse()) {
      const date = request.url.match(/([^/]+)\.json$/)[1];
      request.complete(snapshotFor(date));
    }
    await flush();
  }
}

function release(source, tag, assets) {
  return { source, tag, name: tag, published_at: "2026-01-01T00:00:00Z", assets };
}

const asset = (id, name, downloads, category = "app") => ({ id, name, downloads, category });

test("history stays lazy and all-time calculations do not fetch snapshots", async () => {
  const app = loadApp(() => { throw new Error("unexpected fetch"); });
  app.state.latest = { releases: [release("otzaria", "v1", [asset(1, "app.apk", 12)])] };
  app.state.timeseries = { points: [] };
  assert.equal(app.api.osTotalsAllTime("app").android, 12);
  assert.equal(app.api.allTimeRankingRows()[0].value, 12);
  assert.equal(await app.api.osTotalsForRange("app", 7), null);
  assert.equal(await app.api.rangeRankingRows(7), null);
  assert.equal(app.timers.size, 0);
});

test("overlapping ranges and both panels share one four-request queue and per-date cache", async () => {
  const network = transport();
  const app = loadApp(network.fetch);
  const dates = Array.from({ length: 110 }, (_, index) =>
    new Date(Date.UTC(2026, 6, 19 + index)).toISOString().slice(0, 10));
  const snapshots = new Map(dates.map((date, index) => [date, {
    date, assets: { "otzaria:1": [index, "app"] },
  }]));
  app.state.timeseries = { points: dates.map((date) => ({ date })) };
  app.state.latest = { releases: [release("otzaria", "v1", [asset(1, "app.apk", 109)])] };
  const longOs = app.api.osTotalsForRange("app", 90);
  const longRanking = app.api.rangeRankingRows(90);
  const shortOs = app.api.osTotalsForRange("app", 30);
  const shortRanking = app.api.rangeRankingRows(30);

  assert.equal(network.requests.length, 4);
  assert.equal(app.timers.size, 4);
  await completeAll(network, (date) => snapshots.get(date));
  assert.equal((await longOs).android, 91);
  assert.equal((await longRanking)[0].value, 91);
  assert.equal((await shortOs).android, 31);
  assert.equal((await shortRanking)[0].value, 31);
  assert.equal(network.peak, 4);
  assert.equal(network.requests.length, 92);
  assert.equal(new Set(network.requests.map((request) => request.url)).size, 92);
  assert.equal(network.active, 0);
  assert.equal(app.timers.size, 0);
  assert.ok(network.requests.every((request) => request.options.cache === "no-cache"));

  await Promise.all([app.api.osTotalsForRange("app", 90), app.api.rangeRankingRows(90)]);
  assert.equal(network.requests.length, 92, "successful snapshots should be reused");
});

test("a slot remains occupied until the response body has been consumed", async () => {
  const network = transport();
  const app = loadApp(network.fetch);
  const pending = Array.from({ length: 5 }, (_, index) => app.api.loadHistoryPoint(`day-${index}`));
  network.requests.forEach((request) => request.headers());
  await flush();
  assert.equal(network.requests.length, 4);
  network.requests[0].complete({ assets: {} });
  await flush();
  assert.equal(network.requests.length, 5);
  await completeAll(network, () => ({ assets: {} }));
  await Promise.all(pending);
  assert.equal(network.peak, 4);
});

test("HTTP errors cancel unread streaming bodies before admitting queued work", async () => {
  const network = transport();
  const app = loadApp(network.fetch);
  const pending = Array.from({ length: 8 }, (_, index) => app.api.loadHistoryPoint(`error-${index}`));
  const settled = Promise.allSettled(pending);
  network.requests.forEach((request) => request.headers(503));
  await flush();
  assert.equal(network.requests.length, 8);
  assert.ok(network.requests.slice(0, 4).every((request) => request.options.signal.aborted));
  assert.equal(network.active, 4, "only the next four response bodies may remain active");
  network.requests.slice(4).forEach((request) => request.headers(503));
  const results = await settled;
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.ok(network.requests.every((request) => request.options.signal.aborted));
  assert.ok(network.requests.every((request) => request.bodyCancelled));
  assert.equal(network.active, 0);
  assert.equal(network.peak, 4);
  assert.equal(app.timers.size, 0);
});

test("an error-body cancellation failure preserves the HTTP error and still aborts", async () => {
  const network = transport({ cancelFails: true });
  const app = loadApp(network.fetch);
  const pending = app.api.loadHistoryPoint("cancel-failure");
  const rejected = assert.rejects(pending, { message: "error.fetchFailed" });
  network.requests[0].headers(503);
  await rejected;
  assert.equal(network.requests[0].bodyCancelled, true);
  assert.equal(network.requests[0].options.signal.aborted, true);
  assert.equal(network.active, 0);
  assert.equal(app.state.historyPromises["cancel-failure"], undefined);
});

for (const failure of ["network", "http", "json"]) {
  test(`${failure} failure evicts only the failed promise and allows a shared retry`, async () => {
    const network = transport();
    const app = loadApp(network.fetch);
    const first = app.api.loadHistoryPoint("2026-11-01");
    assert.equal(app.api.loadHistoryPoint("2026-11-01"), first);
    const rejected = assert.rejects(first);
    if (failure === "http") network.requests[0].headers(503);
    else {
      if (failure === "json") {
        network.requests[0].headers();
        await flush();
      }
      network.requests[0].fail(new Error(failure));
    }
    await rejected;
    assert.equal(app.state.historyPromises["2026-11-01"], undefined);
    assert.equal(app.timers.size, 0);
    const retry = app.api.loadHistoryPoint("2026-11-01");
    assert.notEqual(retry, first);
    assert.equal(app.api.loadHistoryPoint("2026-11-01"), retry);
    assert.equal(network.requests.length, 2);
    network.requests[1].complete({ assets: { "otzaria:1": [5, "app"] } });
    assert.deepEqual(await retry, { assets: { "otzaria:1": [5, "app"] } });
    assert.equal(app.api.loadHistoryPoint("2026-11-01"), retry);
    assert.equal(app.timers.size, 0);
  });
}

for (const phase of ["headers", "body"]) {
  test(`timeout during ${phase} aborts the request, frees its slot and permits retry`, async () => {
    const network = transport();
    const app = loadApp(network.fetch);
    const first = app.api.loadHistoryPoint("2026-11-01");
    const rejected = assert.rejects(first, { message: "error.historyTimeout" });
    const remaining = [2, 3, 4, 5].map((day) => app.api.loadHistoryPoint(`2026-11-0${day}`));
    assert.equal(network.requests.length, 4);
    assert.equal(app.timers.size, 4, "queued jobs should not have a deadline yet");
    assert.ok([...app.timers.values()].every((timer) => timer.delay === 30_000));
    if (phase === "body") {
      network.requests[0].headers();
      await flush();
    }
    app.expire(app.timers.keys().next().value);
    await rejected;
    await flush();
    assert.equal(network.requests[0].options.signal.aborted, true);
    assert.equal(network.requests.length, 5);
    const retry = app.api.loadHistoryPoint("2026-11-01");
    await completeAll(network, () => ({ assets: {} }));
    await Promise.all([...remaining, retry]);
    assert.equal(network.requests.length, 6);
    assert.equal(network.peak, 4);
    assert.equal(app.timers.size, 0);
  });
}

test("out-of-order loads preserve daily gains, resets, missing assets and measurement families", async () => {
  const network = transport();
  const app = loadApp(network.fetch);
  const snapshots = {
    "2026-10-28": { assets: {
      "otzaria:1": [10, "app"], "otzaria:2": [100, "app"], "otzaria:3": [5, "app"],
      "otzaria:4": [2, "app"], "sivan22:1": [20, "app"],
      "seforim:10": [10, "library"], "seforim:11": [10, "delta"], "seforim:12": [10, "library"],
    } },
    "2026-11-01": { assets: {
      "otzaria:1": [13, "app"], "otzaria:2": [4, "app"], "otzaria:4": [5, "app"],
      "sivan22:1": [24, "app"], "seforim:10": [15, "library"], "seforim:11": [8, "delta"],
      "seforim:12": [12, "delta"], "otzaria:5": [2, "app"],
    } },
    "2026-11-05": { assets: {
      "otzaria:1": [15, "app"], "otzaria:2": [7, "app"], "otzaria:3": [9, "app"],
      "sivan22:1": [25, "app"], "seforim:10": [18, "library"], "seforim:11": [13, "delta"],
      "seforim:12": [15, "delta"], "otzaria:5": [6, "app"],
    } },
  };
  const dates = ["2026-10-01", "2026-10-20", ...Object.keys(snapshots)];
  app.state.timeseries = { points: dates.map((date) => ({ date })) };
  app.state.latest = { releases: [
    release("otzaria", "v-new", [asset(1, "renamed.apk", 15), asset(2, "app.exe", 7), asset(5, "app.deb", 6)]),
    release("otzaria", "v-mac", [asset(3, "app.dmg", 9)]),
    release("sivan22", "v-legacy", [asset(1, "app.exe", 25)]),
    release("seforim", "v27-20260906092829", [
      asset(10, "library.db", 18, "library"), asset(11, "patch.db", 13, "delta"),
      asset(12, "changed-category.db", 15, "delta"),
    ]),
  ] };

  assert.deepEqual(plain(app.api.historyDatesForRange(7)), Object.keys(snapshots));
  const totals = app.api.osTotalsForRange("app", 7);
  const rows = app.api.rangeRankingRows(7);
  await completeAll(network, (date) => snapshots[date]);
  assert.deepEqual(plain(await totals), { windows: 8, macos: 9, android: 5, linux: 6, ios: 0, other: 3 });
  assert.deepEqual(plain(await rows).map(({ tag, value, colorKey }) => ({ tag, value, colorKey })), [
    { tag: "v-new", value: 14, colorKey: "otzaria" },
    { tag: "v-mac", value: 9, colorKey: "otzaria" },
    { tag: "v-legacy", value: 5, colorKey: "sivan22" },
  ]);
  assert.equal((await app.api.osTotalsForRange("otzaria", 7)).windows, 3);
  assert.equal((await app.api.osTotalsForRange("sivan22", 7)).windows, 5);
  for (const [source, expected] of [["library", 8], ["delta", 10], ["sivan22", 5]]) {
    app.state.source = source;
    const selected = await app.api.rangeRankingRows(7);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].value, expected);
    assert.equal(selected[0].colorKey, source);
  }
  assert.equal(network.requests.length, 3);
});
