"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "site/app.js"), "utf8");

function collectPayload(assets) {
  const result = spawnSync("python3", ["-c", `
import json, sys
from datetime import datetime, timezone
from scripts.collect_downloads import SOURCES, build_latest, build_overview
raw = {source.id: [] for source in SOURCES}
raw["otzaria"] = [json.load(sys.stdin)]
latest = build_latest(raw, datetime(2026, 11, 8, tzinfo=timezone.utc))
print(json.dumps({"latest": latest, "overview": build_overview(latest)}))
`], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ id: 1, tag_name: "v1.0.0", name: "1.0.0", assets }),
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

function element(tag) {
  return {
    tag, children: [], attributes: {},
    classList: { add() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}

function loadApp(payload) {
  const context = vm.createContext({
    window: {
      I18n: { locale: () => "en-US", t: (key) => key },
      matchMedia: () => ({ matches: false }),
    },
    document: { documentElement: {}, addEventListener() {}, createElement: element },
    getComputedStyle: () => ({ getPropertyValue: () => "#000000" }),
    fetch() { throw new Error("Unexpected network request"); },
  });
  vm.runInContext(appSource, context, { filename: "site/app.js" });
  const state = vm.runInContext("state", context);
  state.latest = payload.latest;
  state.overview = payload.overview;
  return context;
}

function links(node) {
  if (!node || typeof node !== "object") return [];
  return [...(node.tag === "a" ? [node.href] : []), ...node.children.flatMap(links)];
}

const asset = (id, name, download_count) => ({
  id, name, download_count, size: 1024,
  browser_download_url: `https://example.test/${name}`,
});
const platform = { id: "android", label: "Android", icon: "phone_android" };

for (const apkName of ["app-release.apk", "otzaria-android.apk"]) {
  test(`collector payload offers ${apkName} when metadata has more downloads`, () => {
    const apk = asset(101, apkName, 15);
    const metadata = asset(102, "otzaria-android.json", 100);
    const payload = collectPayload([apk, metadata]);
    const app = loadApp(payload);
    const card = app.buildPlatformCard(platform, app.pickCurrentRelease(), "android");
    const primary = card.children.find((node) => node.className === "btn btn-filled");
    assert.equal(primary.href, apk.browser_download_url);
    assert.deepEqual(links(card), [apk.browser_download_url]);
    assert.equal(payload.overview.summary.by_category.app, 15);
    assert.equal(app.osTotalsAllTime("app").android, 15);
    assert.equal(app.allTimeRankingRows()[0].value, 15);
  });
}

test("metadata without an APK does not become an Android installer", () => {
  const payload = collectPayload([asset(102, "otzaria-android.json", 100)]);
  const app = loadApp(payload);
  const card = app.buildPlatformCard(platform, app.pickCurrentRelease(), "android");
  assert.equal(card.children.find((node) => node.className === "btn btn-filled"), undefined);
  assert.deepEqual(links(card), ["#releases"]);
  assert.equal(payload.overview.summary.by_category.app, 0);
  assert.equal(app.osTotalsAllTime("app").android, 0);
});
