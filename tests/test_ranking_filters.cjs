"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../site/app.js"), "utf8");
const asset = (id, name, downloads) => ({ id, name, downloads, category: "app" });
const sharedTag = "v1.2.3";
const archived = { id: 7, source: "sivan22", tag: sharedTag, name: "Legacy v1.2.3", assets: [
  asset(8, "app-windows.exe", 111), asset(9, "app-linux.deb", 12),
] };
const current = { id: 7, source: "otzaria", tag: sharedTag, name: "Current v1.2.3", assets: [
  asset(8, "app.apk", 217),
] };
const older = { id: 5, source: "sivan22", tag: "v1.2.3-beta", name: "Earlier beta", assets: [
  asset(6, "app-windows.exe", 90),
] };
const dates = Array.from({ length: 11 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);

function element() {
  const listeners = new Map();
  return {
    hidden: false, textContent: "", value: "", attributes: {}, children: [], dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll() { return []; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type) { return listeners.get(type)?.({ target: this, preventDefault() {} }); },
    scrollIntoView() {},
  };
}

function loadApp() {
  const elements = new Map();
  const node = (selector) => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const ranges = ["all", "7", "30"].map((range) => {
    const button = node(`[data-range="${range}"]`);
    button.dataset.range = range;
    button.textContent = range;
    return button;
  });
  node("#range-filter").querySelectorAll = () => ranges;
  const groups = { "[data-range]": ranges };
  for (const [key, values] of Object.entries({ mode: ["daily", "releases"], source: ["app", "sivan22", "otzaria"] })) {
    groups[`[data-${key}]`] = values.map((value) => {
      const button = node(`[data-${key}="${value}"]`);
      button.dataset[key] = value;
      return button;
    });
  }

  class Chart {
    constructor(_canvas, config) {
      this.config = config;
      this.data = config.data;
    }
    destroy() {}
    update() {}
  }

  const context = vm.createContext({
    window: {
      I18n: { locale: () => "en-US", t: (key, params) => params ? `${key}:${JSON.stringify(params)}` : key },
      matchMedia: () => ({ matches: true }), Chart,
    },
    document: {
      documentElement: element(), createElement: element, addEventListener() {},
      getElementById: (id) => node(`#${id}`), querySelector: node,
      querySelectorAll: (selector) => groups[selector] || [],
    },
    navigator: { userAgent: "", platform: "", maxTouchPoints: 0 },
    getComputedStyle: () => ({ getPropertyValue: () => "#000000" }),
    AbortController, Chart, setTimeout, clearTimeout,
    async fetch(url) {
      const date = url.match(/^data\/history\/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
      assert.ok(dates.includes(date), `unexpected request: ${url}`);
      const last = date === dates.at(-1);
      return { ok: true, json: async () => ({ assets: {
        "sivan22:8": [last ? 111 : 100, "app"],
        "sivan22:9": [last ? 12 : 4, "app"],
        "otzaria:8": [last ? 217 : 200, "app"],
        "sivan22:6": [date === dates[0] ? 1 : 90, "app"],
      } }) };
    },
  });
  vm.runInContext(appSource, context, { filename: "site/app.js" });
  // Keep the real filter controls, list refresh, and chart callbacks. The
  // release cards and toast animation are outside this fixture's DOM surface.
  vm.runInContext("renderReleases = () => {}; showToast = () => {};", context);
  const state = vm.runInContext("state", context);
  state.latest = { releases: [current, archived, older] };
  state.timeseries = { points: dates.map((date) => ({ date })) };
  state.statsReady = true;
  state.releasesReady = true;
  context.bindControls();
  return { context, state, node };
}

function donutValues(state) {
  const { labels, datasets } = state.osChart.config.data;
  return Object.fromEntries(labels.map((label, index) => [label, datasets[0].data[index]]));
}

async function clickBar(state, index) {
  await state.chart.config.options.onClick({}, [{ index }]);
  await new Promise(setImmediate);
}

test("choosing a ranking bar scopes both the OS counts and the visible selection, and clicking it again resets them", async () => {
  const { context, state, node } = loadApp();
  await context.renderStats();
  assert.deepEqual(donutValues(state), { "os.android": 217, "os.windows": 201, "os.linux": 12 });

  await clickBar(state, 0);
  assert.deepEqual(donutValues(state), { "os.android": 217 });
  assert.equal(state.selectedRankingRow.key, context.releaseKey(current));
  assert.equal(node("#ranking-release-select").value, context.releaseKey(current));
  assert.match(node("#donut-subtitle").textContent, /v1\.2\.3/);
  assert.equal(node("#ranking-selected-link").hidden, false);

  await clickBar(state, 0);
  assert.equal(state.selectedRankingRow, null);
  assert.deepEqual(donutValues(state), { "os.android": 217, "os.windows": 201, "os.linux": 12 });
  assert.equal(node("#ranking-selected-link").hidden, true);
});

test("the week view keeps identical release IDs and tags in the two repositories distinct", async () => {
  const { state, node, context } = loadApp();
  await node('[data-range="7"]').dispatch("click");
  assert.deepEqual(donutValues(state), { "os.android": 17, "os.windows": 11, "os.linux": 8 });

  await clickBar(state, 0);
  assert.equal(state.selectedRankingRow.tag, sharedTag);
  assert.equal(state.selectedRankingRow.key, context.releaseKey(archived));
  assert.deepEqual(donutValues(state), { "os.windows": 11, "os.linux": 8 });

  const releaseSelect = node("#ranking-release-select");
  releaseSelect.value = context.releaseKey(current);
  await releaseSelect.dispatch("change");
  await new Promise(setImmediate);
  assert.equal(state.selectedRankingRow.tag, sharedTag);
  assert.equal(state.selectedRankingRow.key, context.releaseKey(current));
  assert.deepEqual(donutValues(state), { "os.android": 17 });

  await node("#ranking-selected-link").dispatch("click");
  assert.deepEqual(new Set(context.filteredReleases()), new Set([current]));
});

test("a release stays selected across ranges with an empty week and clears when the mode or repository changes", async () => {
  const { context, state, node } = loadApp();
  await context.renderStats();
  await clickBar(state, 2);
  assert.equal(state.selectedRankingRow.key, context.releaseKey(older));
  assert.deepEqual(donutValues(state), { "os.windows": 90 });

  await node('[data-range="7"]').dispatch("click");
  assert.equal(node("#ranking-release-select").value, context.releaseKey(older));
  assert.equal(state.osChart, null);
  assert.equal(node("#os-empty").hidden, false);
  assert.match(node("#os-empty").textContent, /donut\.empty\.range/);
  assert.match(node("#donut-subtitle").textContent, /v1\.2\.3-beta/);

  await node('[data-mode="daily"]').dispatch("click");
  assert.equal(state.selectedRankingRow, null);
  assert.equal(node("#ranking-selection").hidden, true);
  assert.deepEqual(donutValues(state), { "os.android": 17, "os.windows": 11, "os.linux": 8 });

  await node('[data-mode="releases"]').dispatch("click");
  await clickBar(state, 1);
  assert.equal(state.selectedRankingRow.key, context.releaseKey(current));
  await node('[data-source="sivan22"]').dispatch("click");
  assert.equal(state.selectedRankingRow, null);
  assert.equal(node("#ranking-release-select").value, "");
  assert.deepEqual(donutValues(state), { "os.windows": 11, "os.linux": 8 });
});

test("showing the ranked releases in the archive uses exactly the range's results and clears stale archive filters", async () => {
  const { context, state, node } = loadApp();
  await node('[data-range="7"]').dispatch("click");
  Object.assign(state, {
    releaseType: "library", releaseOS: "ios", releaseVariant: "full", releaseChannel: "beta",
    releaseSearch: "previous search", releaseLimit: 24,
  });
  node("#release-search").value = state.releaseSearch;
  assert.equal(context.filteredReleases().length, 0);

  await node("#chart-all-releases").dispatch("click");
  assert.deepEqual(new Set(context.filteredReleases()), new Set([current, archived]));
  assert.equal(node("#release-search").value, "");
  assert.equal(node("#release-rank-scope").hidden, false);
  assert.equal(state.releaseOS, "all");
  assert.equal(state.releaseVariant, "all");
  assert.equal(state.releaseChannel, "all");
});

test("removed assets keep their historical platform and release without appearing in the current catalog", async () => {
  const { context, state, node } = loadApp();
  const removed = { id: 11, source: "otzaria", tag: "v0.9", name: "Removed release" };
  state.timeseries.historical_assets = {
    "sivan22:10": { name: "old-macos.dmg", release: archived },
    "otzaria:12": { name: "old-linux.deb", release: removed },
  };
  const originalFetch = context.fetch;
  context.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const snapshot = await response.json();
    const last = args[0].includes(dates.at(-1));
    snapshot.assets["sivan22:10"] = [last ? 9 : 5, "app"];
    snapshot.assets["otzaria:12"] = [last ? 70 : 10, "app"];
    return { ok: true, json: async () => snapshot };
  };

  await node('[data-range="7"]').dispatch("click");
  assert.deepEqual(donutValues(state), { "os.linux": 68, "os.android": 17, "os.windows": 11, "os.macos": 4 });
  await clickBar(state, 0);
  assert.equal(state.selectedRankingRow.key, context.releaseKey(removed));
  assert.deepEqual(donutValues(state), { "os.linux": 60 });
  assert.equal(node("#ranking-selected-link").hidden, true);
  await node("#chart-all-releases").dispatch("click");
  assert.deepEqual(new Set(context.filteredReleases()), new Set([current, archived]));
  await clickBar(state, 1);
  assert.deepEqual(donutValues(state), { "os.windows": 11, "os.linux": 8, "os.macos": 4 });
});

test("a transient catalog or timeseries failure permits a shared retry", async () => {
  const { context } = loadApp();
  for (const load of [context.loadLatest, context.loadTimeseries]) {
    let requests = 0;
    context.fetch = async () => {
      if (++requests === 1) throw new Error("offline");
      return { ok: true, json: async () => ({ releases: [], points: [] }) };
    };
    await assert.rejects(load(), /offline/);
    const retry = load();
    assert.equal(load(), retry);
    await retry;
    assert.equal(requests, 2);
  }
});
