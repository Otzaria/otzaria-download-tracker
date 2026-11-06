"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../site/app.js"), "utf8");
const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));
const dates = Array.from({ length: 110 }, (_, index) =>
  new Date(Date.UTC(2026, 6, 19 + index)).toISOString().slice(0, 10));
const recentDates = new Set(dates.slice(-9));
const snapshotFor = (date) => ({ assets: { "otzaria:1": [dates.indexOf(date), "app"] } });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Advance network responses and request deadlines deterministically. These
// timings describe a simulated transport, not a live server benchmark.
function virtualClock() {
  let now = 0;
  let nextId = 0;
  const events = new Map();
  const next = () => [...events].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  return {
    get now() { return now; },
    get size() { return events.size; },
    setTimeout(callback, delay) {
      const id = ++nextId;
      events.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { events.delete(id); },
    async advanceTo(target) {
      await flush();
      let count = 0;
      while (events.size && next()[1].at <= target) {
        assert.ok(++count < 10_000, "virtual clock did not settle");
        const [id, event] = next();
        events.delete(id);
        now = event.at;
        event.callback();
        await flush();
      }
      now = target;
      await flush();
    },
    async runAll() {
      await flush();
      let count = 0;
      while (events.size) {
        assert.ok(++count < 10_000, "virtual clock did not settle");
        await this.advanceTo(next()[1].at);
      }
    },
  };
}

// Keep the slot occupied through body reading and, optionally, delayed abort
// cleanup. A cancellation must not admit replacement transfers prematurely.
function transport(clock, { responseDelay, abortDelay = 0 } = {}) {
  const requests = [];
  let active = 0;
  let peak = 0;
  return {
    requests,
    get active() { return active; },
    get peak() { return peak; },
    fetch(url, { signal }) {
      const date = url.match(/^data\/history\/(.+)\.json$/)?.[1];
      assert.ok(date, `unexpected request: ${url}`);
      const headers = deferred();
      const body = deferred();
      // Aborting between headers and json() also invalidates the body, even
      // though the consumer has not attached its rejection handler yet.
      body.promise.catch(() => {});
      const scheduled = [];
      let headersSent = false;
      let bodyRead = false;
      let completed = false;
      active += 1;
      peak = Math.max(peak, active);
      const finish = () => {
        if (completed) return;
        completed = true;
        active -= 1;
        scheduled.forEach((id) => clock.clearTimeout(id));
      };
      const request = {
        date, signal, startedAt: clock.now,
        get pending() { return !completed; },
        get bodyRead() { return bodyRead; },
        headers(status = 200) {
          if (headersSent || completed) return;
          headersSent = true;
          headers.resolve({
            ok: status === 200, status,
            body: { cancel() { finish(); return Promise.resolve(); } },
            json() { bodyRead = true; return body.promise.finally(finish); },
          });
        },
        complete(value = snapshotFor(date)) {
          if (completed) return;
          request.headers();
          body.resolve(value);
        },
        fail(error) {
          if (completed) return;
          finish();
          if (!headersSent) headers.reject(error);
          body.reject(error);
        },
      };
      signal.addEventListener("abort", () => {
        if (completed) return;
        const fail = () => request.fail(new DOMException("Aborted", "AbortError"));
        if (abortDelay) scheduled.push(clock.setTimeout(fail, abortDelay));
        else fail();
      }, { once: true });
      requests.push(request);
      const delay = responseDelay?.(date);
      if (delay != null) scheduled.push(clock.setTimeout(() => request.complete(), delay));
      return headers.promise;
    },
  };
}

function element() {
  return {
    textContent: "", hidden: false, dataset: {}, style: {}, children: [], attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener() {},
    querySelectorAll() { return []; },
  };
}

// Run the real renderers; only the DOM surface and Chart constructor are
// stand-ins. This checks which chart data and text survive an obsolete render.
function loadApp(options) {
  const clock = virtualClock();
  const network = transport(clock, options);
  const elements = new Map();
  const node = (selector) => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const chips = ["all", "7", "30", "90", "182", "365"].map((range) => {
    const chip = node(`[data-range="${range}"]`);
    chip.dataset.range = range;
    chip.textContent = range;
    return chip;
  });
  node("#range-filter").querySelectorAll = () => chips;
  const charts = [];
  class Chart {
    constructor(canvas, config) { this.canvas = canvas; this.config = config; charts.push(this); }
    destroy() { this.destroyed = true; }
  }
  const context = vm.createContext({
    window: {
      I18n: { locale: () => "en-US", t: (key, params) => params ? `${key}:${JSON.stringify(params)}` : key },
      matchMedia: () => ({ matches: false }), localStorage: { setItem() {} }, Chart,
    },
    document: {
      documentElement: element(), addEventListener() {}, createElement: element,
      querySelector: node, querySelectorAll: () => [],
    },
    navigator: { userAgent: "", platform: "", maxTouchPoints: 0 },
    getComputedStyle: () => ({ getPropertyValue: () => "#000000" }),
    AbortController, Chart, fetch: network.fetch,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  vm.runInContext(appSource, context, { filename: "site/app.js" });
  const state = vm.runInContext("state", context);
  state.timeseries = { points: dates.map((date, index) => ({
    date, totals: { by_category: { app: index, library: index }, by_source: { otzaria: index } },
    changes: { by_category: { app: 1, library: 1 }, by_source: { otzaria: 1 } },
  })) };
  state.latest = { releases: [{
    source: "otzaria", tag: "v1", name: "v1", published_at: "2026-07-19T00:00:00Z",
    assets: [{ id: 1, name: "app.apk", downloads: 109, category: "app" }],
  }] };
  state.statsReady = true;
  return { api: context, state, clock, network, charts, node };
}

function observed(promise, clock) {
  return promise.then(
    (value) => ({ status: "fulfilled", value, at: clock.now }),
    (error) => ({ status: "rejected", error, at: clock.now }),
  );
}

function calculations(app, days) {
  return [
    observed(app.api.osTotalsForRange("app", days), app.clock),
    observed(app.api.rangeRankingRows(days), app.clock),
  ];
}

async function completeAll(app) {
  await flush();
  for (let batches = 0; app.network.active; batches += 1) {
    assert.ok(batches < 100, "history queue did not settle");
    for (const request of app.network.requests.filter((item) => item.pending).reverse()) request.complete();
    await flush();
  }
}

function assertRangeCharts(app, count) {
  assert.deepEqual(plain(app.state.chart.config.data.datasets[0].data), [count]);
  assert.deepEqual(plain(app.state.osChart.config.data.datasets[0].data), [count]);
}

for (const obsolete of ["healthy", "stalled"]) {
  test(`90→7 renders in three batches even when obsolete requests are ${obsolete}`, async () => {
    const app = loadApp({ responseDelay: (date) => obsolete === "healthy" || recentDates.has(date) ? 100 : null });
    app.state.range = "90";
    const oldRender = observed(app.api.renderStats(), app.clock);
    assert.equal(app.network.requests.length, 4);
    assert.equal(app.state.chartRenderToken, 1);
    assert.equal(app.state.osRenderToken, 1, "donut must start before the ranking finishes");

    app.state.range = "7";
    const currentRender = observed(app.api.refreshStats(), app.clock);
    assert.equal(app.state.chartRenderToken, 2);
    assert.equal(app.state.osRenderToken, 2, "selection must invalidate both old renderers immediately");
    await app.clock.runAll();

    assert.equal((await oldRender).status, "fulfilled");
    assert.equal((await currentRender).at, 300);
    assertRangeCharts(app, 8);
    assert.equal(app.charts.length, 2, "the obsolete selection must never create a chart or fallback");
    assert.equal(app.network.requests.length, 13, "only four old requests and the nine selected snapshots should start");
    assert.equal(app.network.requests.find((item) => recentDates.has(item.date)).startedAt, 0);
    assert.equal(app.network.peak, 4);
    assert.equal(app.network.active, 0);
    assert.equal(app.clock.size, 0);
  });
}

for (const phase of ["headers", "body"]) {
  test(`90→all cancels active ${phase} and queued history without waiting for timeouts`, async () => {
    const app = loadApp({ abortDelay: 25 });
    app.state.range = "90";
    const oldRender = app.api.renderStats();
    if (phase === "body") {
      app.network.requests.forEach((request) => request.headers());
      await flush();
      assert.ok(app.network.requests.every((request) => request.bodyRead));
    }

    app.state.range = "all";
    await app.api.renderStats();
    assertRangeCharts(app, 109);
    assert.ok(app.network.requests.every((request) => request.signal.aborted));
    assert.equal(app.network.requests.length, 4);
    assert.equal(app.network.active, 4, "aborted transfers still occupy slots during cleanup");
    assert.deepEqual(Object.keys(app.state.historyPromises), []);
    await app.clock.advanceTo(24);
    assert.equal(app.network.active, 4);
    await app.clock.advanceTo(25);
    await oldRender;
    assert.equal(app.network.active, 0);
    assert.equal(app.network.requests.length, 4, "obsolete queued dates must never start");
    assertRangeCharts(app, 109);
    assert.equal(app.charts.length, 2);
    assert.equal(app.clock.size, 0);
  });
}

test("overlapping active and queued snapshots keep their promises for both panels", async () => {
  const app = loadApp();
  const longDates = plain(app.api.historyDatesForRange(90));
  const shortDates = plain(app.api.historyDatesForRange(7));
  const firstFour = [longDates[0], shortDates[0], longDates[1], shortDates[1]];
  const seeded = firstFour.map((date) => observed(app.api.loadHistoryPoint(date), app.clock));
  const oldCalculations = calculations(app, 90);
  const original = new Map(shortDates.map((date) => [date, app.state.historyPromises[date]]));
  app.api.syncHistorySelection(new Set(shortDates));
  const selected = calculations(app, 7);

  shortDates.forEach((date) => assert.equal(app.api.loadHistoryPoint(date), original.get(date)));
  assert.ok(app.network.requests.filter((request) => recentDates.has(request.date)).every((request) => !request.signal.aborted));
  await completeAll(app);
  const [os, ranking] = await Promise.all(selected);
  assert.equal(os.value.android, 8);
  assert.equal(ranking.value[0].value, 8);
  assert.ok((await Promise.all(oldCalculations)).every((result) => result.error.name === "AbortError"));
  await Promise.all(seeded);
  assert.equal(app.network.requests.length, 11);
  shortDates.forEach((date) => {
    assert.equal(app.api.loadHistoryPoint(date), original.get(date), "completed snapshots stay cached");
    assert.equal(app.network.requests.filter((request) => request.date === date).length, 1);
  });
  assert.equal(app.network.peak, 4);
  assert.equal(app.clock.size, 0);
});

for (const initial of [90, 7]) {
  test(`same-turn ${initial}→all→7 replaces canceled promises without exceeding four transfers`, async () => {
    const app = loadApp({ responseDelay: () => 100, abortDelay: 25 });
    const previous = calculations(app, initial);
    const original = new Map(Object.entries(app.state.historyPromises));
    app.api.syncHistorySelection([]);
    assert.deepEqual(Object.keys(app.state.historyPromises), [], "eviction must be synchronous");
    app.api.syncHistorySelection(app.api.historyDatesForRange(7));
    const selected = calculations(app, 7);
    const replacements = new Map(Object.entries(app.state.historyPromises));
    replacements.forEach((promise, date) => assert.notEqual(promise, original.get(date)));
    assert.equal(app.network.requests.length, 4, "abort cleanup must finish before replacement transfers start");
    await app.clock.advanceTo(24);
    assert.equal(app.network.requests.length, 4);
    await app.clock.advanceTo(25);
    replacements.forEach((promise, date) => {
      assert.equal(app.state.historyPromises[date], promise, "old cleanup must not evict the replacement");
    });
    await app.clock.runAll();
    assert.ok((await Promise.all(previous)).every((result) => result.error.name === "AbortError"));
    const [os, ranking] = await Promise.all(selected);
    assert.equal(os.at, 325);
    assert.equal(os.value.android, 8);
    assert.equal(ranking.value[0].value, 8);
    assert.equal(app.network.peak, 4);
    assert.equal(app.network.requests.length, 13);
    assert.equal(app.network.active, 0);
    assert.equal(app.clock.size, 0);
  });
}

test("repeated quick switches retain the shared short range and never revive obsolete queued work", async () => {
  const app = loadApp({ responseDelay: () => 100 });
  const selections = [90, 30, 7, 90, 7].map((days) => {
    app.api.syncHistorySelection(app.api.historyDatesForRange(days));
    return { days, pending: calculations(app, days) };
  });
  await app.clock.runAll();
  for (const selection of selections) {
    const [os, ranking] = await Promise.all(selection.pending);
    if (selection.days === 7) {
      assert.equal(os.value.android, 8);
      assert.equal(ranking.value[0].value, 8);
    } else {
      assert.equal(os.error.name, "AbortError");
      assert.equal(ranking.error.name, "AbortError");
    }
  }
  assert.equal(app.network.requests.length, 13);
  assert.equal(app.network.peak, 4);
  assert.equal(app.clock.now, 300);
});

test("after a range cancellation and network failure, both panels retry only the failed snapshot", async () => {
  const app = loadApp();
  const previous = calculations(app, 90);
  const shortDates = plain(app.api.historyDatesForRange(7));
  app.api.syncHistorySelection(shortDates);
  const selected = calculations(app, 7);
  await flush();
  const failed = app.network.requests.find((request) => request.pending);
  failed.fail(new Error("temporary network failure"));
  await completeAll(app);
  assert.ok((await Promise.all(previous)).every((result) => result.error.name === "AbortError"));
  assert.ok((await Promise.all(selected)).every((result) => result.error.message === "temporary network failure"));
  const cache = new Map(shortDates.filter((date) => date !== failed.date).map((date) => [date, app.state.historyPromises[date]]));
  const countBeforeRetry = app.network.requests.length;

  app.api.syncHistorySelection(shortDates);
  const retried = calculations(app, 7);
  assert.equal(app.network.requests.length, countBeforeRetry + 1);
  assert.equal(app.network.requests.at(-1).date, failed.date);
  await completeAll(app);
  const [os, ranking] = await Promise.all(retried);
  assert.equal(os.value.android, 8);
  assert.equal(ranking.value[0].value, 8);
  cache.forEach((promise, date) => assert.equal(app.state.historyPromises[date], promise));
  app.api.syncHistorySelection([]);
  assert.equal(Object.keys(app.state.historyPromises).length, 9, "all-time selection retains completed cache entries");
  assert.equal(app.network.peak, 4);
  assert.equal(app.clock.size, 0);
});

for (const outcome of ["resolve", "reject"]) {
  test(`obsolete calculation ${outcome}s cannot overwrite the current charts or fallback text`, async () => {
    const app = loadApp();
    const oldRows = deferred();
    const oldTotals = deferred();
    const row = (value) => ({ value, colorKey: "otzaria", axisLabel: "v1", name: "v1", tag: "v1" });
    app.api.rangeRankingRows = (days) => days === "90" ? oldRows.promise : Promise.resolve([row(8)]);
    app.api.osTotalsForRange = (_family, days) => days === "90" ? oldTotals.promise : Promise.resolve({ android: 8 });
    app.state.range = "90";
    const previous = app.api.renderStats();
    assert.equal(app.state.chartRenderToken, 1);
    assert.equal(app.state.osRenderToken, 1);
    app.state.range = "7";
    const current = app.api.renderStats();
    assert.equal(app.state.chartRenderToken, 2);
    assert.equal(app.state.osRenderToken, 2);
    await current;
    const chart = app.state.chart;
    const donut = app.state.osChart;
    const summary = app.node("#chart-summary").textContent;
    const subtitle = app.node("#donut-subtitle").textContent;

    oldRows[outcome](outcome === "resolve" ? [row(91)] : new Error("old request failed"));
    oldTotals[outcome](outcome === "resolve" ? { android: 91 } : new Error("old request failed"));
    await previous;
    assert.equal(app.state.chart, chart);
    assert.equal(app.state.osChart, donut);
    assert.equal(app.node("#chart-summary").textContent, summary);
    assert.equal(app.node("#donut-subtitle").textContent, subtitle);
    assertRangeCharts(app, 8);
    assert.equal(app.charts.length, 2);
    assert.equal(app.network.requests.length, 0);
  });
}

test("history demand follows the visible range and panels that actually need snapshots", async () => {
  const app = loadApp();
  let required;
  app.api.syncHistorySelection = (selection) => { required = [...selection]; };
  app.api.renderChart = async () => {};
  app.api.renderOsChart = async () => {};
  for (const [source, mode, range, needsHistory] of [
    ["app", "releases", "90", true], ["app", "daily", "90", true],
    ["sivan22", "cumulative", "7", true], ["library", "releases", "7", true],
    ["delta", "releases", "7", true], ["library", "daily", "7", false],
    ["delta", "cumulative", "90", false], ["app", "releases", "all", false],
  ]) {
    Object.assign(app.state, { source, mode, range });
    await app.api.renderStats();
    assert.deepEqual(required, needsHistory ? plain(app.api.historyDatesForRange(range)) : [], `${source}/${mode}/${range}`);
  }
  app.state.timeseries.points = app.state.timeseries.points.slice(-2);
  Object.assign(app.state, { source: "app", mode: "releases", range: "7" });
  await app.api.renderStats();
  assert.equal(app.state.rangeChipsVisible, false);
  assert.deepEqual(required, [], "a hidden range must not trigger historical transfers");
});

test("language and theme refreshes invalidate both pending panels immediately", async () => {
  for (const refresh of ["applyLanguageToUI", "applyTheme"]) {
    const app = loadApp({ responseDelay: () => 100 });
    app.state.range = "90";
    const previous = app.api.renderStats();
    app.state.range = "7";
    const current = app.api[refresh]("dark");
    assert.equal(app.state.chartRenderToken, 2, refresh);
    assert.equal(app.state.osRenderToken, 2, refresh);
    await app.clock.runAll();
    await Promise.all([previous, current]);
    assertRangeCharts(app, 8);
    assert.equal(app.network.requests.length, 13, refresh);
    assert.equal(app.network.peak, 4, refresh);
  }
});

test("initial all-time rendering stays lazy and initial ranged rendering starts both panels", async () => {
  for (const range of ["all", "7"]) {
    const app = loadApp({ responseDelay: () => 100 });
    app.state.statsReady = false;
    app.state.range = range;
    app.state.latestPromise = Promise.resolve(app.state.latest);
    app.state.timeseriesPromise = Promise.resolve(app.state.timeseries);
    const initial = app.api.ensureStatsReady();
    await flush();
    assert.equal(app.state.chartRenderToken, 1);
    assert.equal(app.state.osRenderToken, 1);
    await app.clock.runAll();
    await initial;
    assert.equal(app.state.statsReady, true);
    assertRangeCharts(app, range === "all" ? 109 : 8);
    assert.equal(app.network.requests.length, range === "all" ? 0 : 9);
    assert.equal(app.clock.size, 0);
  }
});
