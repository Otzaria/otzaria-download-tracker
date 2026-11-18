"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../site/app.js"), "utf8");
const asset = (name, downloads = 1, category = "app") => ({
  name, downloads, category, size: 1024, download_url: `https://example.test/${name}`,
});
const release = (id, assets, source = "otzaria") => ({ id, source, tag: `v${id}`, name: `Version ${id}`, assets });

function element(tag) {
  const classes = new Set();
  const listeners = new Map();
  return {
    tag,
    children: [],
    dataset: {},
    attributes: {},
    classList: { add: (name) => classes.add(name), contains: (name) => classes.has(name), toggle() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    click() { listeners.get("click")?.(); },
  };
}

function loadApp(releases) {
  const search = element("input");
  const os = ["all", "windows", "ios"].map((id) => {
    const button = element("button");
    button.dataset.os = id;
    return button;
  });
  const context = vm.createContext({
    window: {
      I18n: { locale: () => "en-US", t: (key) => key },
      matchMedia: () => ({ matches: false }),
    },
    document: {
      documentElement: {},
      addEventListener() {},
      createElement: element,
      querySelector: (selector) => selector === "#release-search" ? search : null,
      querySelectorAll: (selector) => selector === "[data-os]" ? os : [],
    },
    getComputedStyle: () => ({ getPropertyValue: () => "#000000" }),
  });
  vm.runInContext(appSource, context, { filename: "site/app.js" });
  const state = vm.runInContext("state", context);
  state.latest = { releases };
  return { context, state, search, os };
}

test("OS, build type, and file search must match the same downloadable app build", () => {
  const windows = asset("otzaria-windows.exe", 37);
  const androidFull = asset("otzaria-android-full-part1.zip");
  const windowsFull = asset("otzaria-windows-full.exe.part-000", 12);
  const updater = asset("otzaria-update-windows-x64.zip");
  const auxiliary = asset("hidden-windows.exe", 100, "auxiliary");
  const mixed = release(1, [windows, androidFull]);
  const match = release(2, [windowsFull, androidFull, updater, auxiliary]);
  const { context, state } = loadApp([mixed, match]);

  context.setReleaseListFilters({ os: "windows", variant: "full" });
  assert.deepEqual(Array.from(context.filteredReleases()), [match]);
  const visible = context.matchingReleaseAssets(match, "", "en-US");
  assert.deepEqual(Array.from(visible), [windowsFull]);
  assert.equal(context.releaseDownloadParts(match, visible)[0].value, 12);

  state.releaseSearch = "version 2";
  assert.deepEqual(Array.from(context.filteredReleases()), [match]);
  state.releaseSearch = "android";
  assert.equal(context.filteredReleases().length, 0);
  state.releaseSearch = "hidden";
  assert.equal(context.filteredReleases().length, 0);

  context.setReleaseListFilters({ os: "windows", variant: "regular" });
  assert.deepEqual(Array.from(context.filteredReleases()), [mixed]);
});

test("a ranked delta scope only returns the ranked release and exposes its delta files", () => {
  const library = asset("seforim.db.zst", 100, "library");
  const delta = asset("patch-v1-v2.db.zst", 71, "delta");
  const selected = release(2, [library, delta], "seforim");
  const other = release(3, [delta], "seforim");
  const { context, state } = loadApp([selected, other]);
  state.rankedReleaseList = { keys: new Set([context.releaseKey(selected)]), category: "delta" };

  assert.deepEqual(Array.from(context.filteredReleases()), [selected]);
  assert.deepEqual(Array.from(context.matchingReleaseAssets(selected, "", "en-US")), [delta]);
  state.releaseSearch = "seforim.db";
  assert.equal(context.filteredReleases().length, 0);
});

test("the recommended download prefers a complete installer over popular helpers", () => {
  const executable = asset("otzaria-0.9.98-windows.exe", 37);
  const assistant = asset("Otzaria-Download-Assistant-windows.exe", 200);
  const zip = asset("otzaria-windows.zip", 1000);
  const assets = [
    assistant,
    asset("otzaria-update-windows-x64.zip", 3000),
    asset("otzaria-windows-full.exe.part-000", 2000),
    zip,
    executable,
    asset("otzaria-app-files-windows-x64.json", 1000),
  ];
  const current = release(1, assets);
  const { context } = loadApp([current]);

  assert.deepEqual(Array.from(context.platformDownloadAssets(current, "windows")), [executable, zip, assistant]);
  const card = context.buildPlatformCard({ id: "windows", label: "Windows" }, current, "windows");
  assert.equal(card.children.find((node) => node.className === "btn btn-filled").href, executable.download_url);
  assert.equal(card.classList.contains("is-recommended"), true);
  assert.equal(context.platformAssetLabel(assistant), "download.assistant");
});

test("the missing-platform shortcut clears stale history filters and searches the requested OS", () => {
  const current = release(1, [asset("otzaria-windows.exe")]);
  const { context, state, search, os } = loadApp([current]);
  const platform = { id: "ios", label: "iOS", icon: "phone_iphone" };
  const card = context.buildPlatformCard(platform, current, "ios");
  const link = card.children.find((node) => node.tag === "a");
  assert.equal(card.classList.contains("is-recommended"), false);
  assert.equal(link.href, "#releases");

  let refreshes = 0;
  context.refreshReleases = () => { refreshes += 1; };
  context.setReleaseListFilters({ type: "library", os: "windows", variant: "full", channel: "pr", search: "old" });
  state.releaseLimit = 24;
  state.rankedReleaseList = { keys: new Set() };
  link.click();

  assert.equal(refreshes, 1);
  assert.equal(state.rankedReleaseList, null);
  assert.deepEqual(
    [state.releaseType, state.releaseOS, state.releaseVariant, state.releaseChannel, state.releaseSearch, state.releaseLimit],
    ["app", "ios", "all", "all", "", 8],
  );
  assert.equal(search.value, "");
  assert.equal(os.find((button) => button.dataset.os === "ios").attributes["aria-pressed"], "true");
});
