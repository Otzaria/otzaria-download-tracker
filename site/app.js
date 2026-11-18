"use strict";

// Every user-visible string lives in i18n.js; this file only ever asks for a
// key. That keeps Hebrew and English in one place and makes it impossible for a
// literal to sneak back into the rendering code.
const I18n = window.I18n;
const t = (key, params) => I18n.t(key, params);
const isRTL = () => I18n.isRTL;

// Number, date and relative-time formats all follow the active language and are
// rebuilt whenever it changes.
let numberFormat;
let compactFormat;
let dateFormat;
let dateTimeFormat;
let snapshotDateFormat;
let relativeTimeFormat;
let percentFormat;

function buildFormatters() {
  const numberLocale = I18n.locale("number");
  const dateLocale = I18n.locale("date");
  numberFormat = new Intl.NumberFormat(numberLocale);
  compactFormat = new Intl.NumberFormat(numberLocale, { notation: "compact", maximumFractionDigits: 1 });
  dateFormat = new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", year: "numeric" });
  snapshotDateFormat = new Intl.DateTimeFormat(dateLocale, {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  dateTimeFormat = new Intl.DateTimeFormat(dateLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  relativeTimeFormat = new Intl.RelativeTimeFormat(I18n.locale("relative"), { numeric: "auto" });
  percentFormat = new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

buildFormatters();

const themeStorageKey = "otzaria-download-tracker-theme";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorByMode = { light: "#f3e6da", dark: "#000000" };

const PLATFORMS = [
  { id: "windows", label: "Windows", icon: "desktop_windows" },
  { id: "macos", label: "macOS", icon: "laptop_mac" },
  { id: "android", label: "Android", icon: "phone_android" },
  { id: "linux", label: "Linux", icon: "computer" },
  { id: "ios", label: "iOS", icon: "phone_iphone" },
];

// The three measurement families the whole UI is built around. "app" is the
// software itself (both repositories together), and the two repository keys are
// only an optional drill-down into that same family. Every label is resolved on
// demand so a language switch needs no cached copy to be invalidated.
const familyLabel = (key) => t(`family.${key}`);
const categoryLabel = (key) => t(`category.${key}`);
const sourceLabel = (key) => t(`source.${key}`);
const osLabel = (key) => t(`os.${key}`);
const variantLabel = (key) => t(`variant.${key}`);
const channelLabel = (key) => t(`channel.${key}`);

const state = {
  overview: null,
  latest: null,
  timeseries: null,
  chart: null,
  osChart: null,
  mode: "releases",
  source: "app",
  range: "all",
  releaseType: "all",
  releaseOS: "all",
  releaseVariant: "all",
  releaseChannel: "all",
  releaseSearch: "",
  releaseLimit: 8,
  rankedReleaseList: null,
  rankedRows: [],
  rankedRange: "all",
  selectedRankingRow: null,
  latestPromise: null,
  timeseriesPromise: null,
  chartLibraryPromise: null,
  historyPromises: {},
  assetIndex: null,
  chartRenderToken: 0,
  osFocus: null,
  osRenderToken: 0,
  rangeChipsVisible: false,
  statsReady: false,
  releasesReady: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function currentPalette() {
  return {
    app: cssColor("--chart-app"),
    sivan22: cssColor("--chart-sivan22"),
    otzaria: cssColor("--chart-otzaria"),
    library: cssColor("--chart-library"),
    delta: cssColor("--chart-delta"),
    windows: cssColor("--chart-windows"),
    macos: cssColor("--chart-macos"),
    android: cssColor("--chart-android"),
    linux: cssColor("--chart-linux"),
    ios: cssColor("--chart-ios"),
    other: cssColor("--chart-other"),
  };
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

let palette = currentPalette();

function formatNumber(value) {
  return numberFormat.format(Number(value) || 0);
}

/** Intl's Hebrew compact notation appends a right-to-left mark ("99.3K\u200f"),
 * which reorders whatever is concatenated after it even inside an LTR box. A
 * first-strong isolate keeps that mark from leaking into the surrounding text. */
function formatCompact(value) {
  return `\u2068${compactFormat.format(Number(value) || 0)}\u2069`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function relativeTime(date) {
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (Math.abs(diffMinutes) < 60) return relativeTimeFormat.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTimeFormat.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return relativeTimeFormat.format(diffDays, "day");
}

/** Classify a release asset filename into a platform bucket by convention, not metadata. */
function classifyOS(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.includes("android") || name.endsWith(".apk")) return "android";
  if (name.includes("iphone") || name.includes("ipad") || name.includes("ios")) return "ios";
  if (name.includes("windows") || name.endsWith(".exe") || name.endsWith(".msix")) return "windows";
  if (name.includes("macos") || name.includes("mac") || name.endsWith(".dmg")) return "macos";
  if (name.includes("linux") || name.endsWith(".deb") || name.endsWith(".rpm") || name.includes("appimage")) return "linux";
  return "other";
}

/** Classify an app asset into a use-case bucket: mobile install, a regular
 * (lightweight) desktop installer, or a full build bundled with the library. */
function classifyVariant(asset) {
  const name = String(asset.name || "").toLowerCase();
  if (name.includes("full")) return "full";
  const os = classifyOS(asset.name);
  if (os === "android" || os === "ios") return "mobile";
  return "regular";
}

/** Classify a release by maturity/channel from its tag+name text. GitHub's own
 * "prerelease" flag is inconsistently set by the maintainers (the newest
 * release is literally titled "Preview from dev" yet flagged non-prerelease),
 * so this looks at the actual naming convention instead: alpha/beta first
 * (rare, historical), then PR test builds, then dev-branch previews, and
 * anything left over is a plain numbered release. */
function classifyChannel(release) {
  const text = `${release.tag} ${release.name}`.toLowerCase();
  if (/\balpha\b|\bbeta\b/.test(text)) return "early";
  if (/\bpr[\s#-]*\d+\b/.test(text)) return "pr";
  if (/preview from|\bdev\b/.test(text)) return "dev";
  return "stable";
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || navigator.userAgentData?.platform || "";
  const maxTouch = navigator.maxTouchPoints || 0;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (platform === "MacIntel" && maxTouch > 1)) return "ios";
  if (/win/i.test(platform) || /windows/i.test(ua)) return "windows";
  if (/mac/i.test(platform) || /macintosh/i.test(ua)) return "macos";
  if (/linux/i.test(platform) || /linux/i.test(ua)) return "linux";
  return null;
}

function trackedAssets(release, category = null) {
  return release.assets.filter((asset) => {
    const tracked = ["app", "library", "delta"].includes(asset.category);
    return tracked && (!category || asset.category === category);
  });
}

function releaseDownloads(release, category = null) {
  return trackedAssets(release, category).reduce((sum, asset) => sum + asset.downloads, 0);
}

function isAppRelease(release) {
  return release.source === "otzaria" || release.source === "sivan22";
}

function releaseKey(release) {
  return `${release.source}:${release.id ?? release.tag}`;
}

/** Per-release counters, split by family so a library release never reports its
 * delta files as if they were the same kind of download. */
function releaseDownloadParts(release, assets) {
  const categories = isAppRelease(release) ? ["app"] : ["library", "delta"];
  return categories
    .map((category) => ({
      label: categoryLabel(category),
      value: assets.reduce((sum, asset) => sum + (asset.category === category ? asset.downloads : 0), 0),
    }))
    .filter((part) => part.value > 0);
}

/** Read one measurement family (or one repository drill-down) out of a
 * timeseries point. Families come from by_category, the repository split from
 * by_source; the two are never summed together. */
function valueFor(point, source, section) {
  const group = point[section];
  if (!group) return null;
  if (source === "sivan22" || source === "otzaria") return group.by_source?.[source] ?? null;
  return group.by_category?.[source] ?? null;
}

function setButtonState(buttons, activeValue, attribute) {
  buttons.forEach((button) => {
    const active = button.dataset[attribute] === activeValue;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function applyTheme(choice, persist = true) {
  const safeChoice = ["light", "dark", "system"].includes(choice) ? choice : "system";
  const resolved = safeChoice === "system" ? (themeMedia.matches ? "dark" : "light") : safeChoice;
  document.documentElement.dataset.themeChoice = safeChoice;
  document.documentElement.dataset.theme = resolved;
  $("#theme-color")?.setAttribute("content", themeColorByMode[resolved]);

  if (persist) {
    try {
      window.localStorage.setItem(themeStorageKey, safeChoice);
    } catch (_) {
      // The selected theme still works for this page view when storage is blocked.
    }
  }

  $$("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === safeChoice;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  palette = currentPalette();
  if (state.statsReady) {
    renderStats();
  }
}

function bindThemeControls() {
  const initial = document.documentElement.dataset.themeChoice || "system";
  applyTheme(initial, false);
  $$("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
  });
  const handleSystemThemeChange = () => {
    if (document.documentElement.dataset.themeChoice === "system") applyTheme("system", false);
  };
  if (typeof themeMedia.addEventListener === "function") {
    themeMedia.addEventListener("change", handleSystemThemeChange);
  } else {
    themeMedia.addListener(handleSystemThemeChange);
  }
}

/* ---------- Language ---------- */

function syncLanguageButtons() {
  $$("[data-lang-choice]").forEach((button) => {
    const active = button.dataset.langChoice === I18n.language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

/** The one glyph on the page that carries a direction of its own: the arrow
 * that points from the ranking towards the full list below it. */
function syncDirectionalIcons() {
  const arrow = $(".chart-all-arrow");
  if (arrow) arrow.textContent = isRTL() ? "arrow_back" : "arrow_forward";
}

/** A language switch repaints the page in place: the static markup is already
 * re-translated by i18n.js, so this rebuilds the locale-aware formatters and
 * every fragment that JavaScript itself wrote, charts included — their options
 * carry direction-dependent axes and tooltips, so both are recreated. */
async function applyLanguageToUI() {
  buildFormatters();
  syncLanguageButtons();
  syncDirectionalIcons();
  if (state.overview) {
    renderMetrics();
    renderDownloadGrid();
  }
  if (state.timeseries) updateRecentChange();
  renderRankedReleaseScope();
  if (state.releasesReady) renderReleases();
  if (state.statsReady) {
    await renderStats();
  }
}

function bindLanguageControls() {
  syncLanguageButtons();
  syncDirectionalIcons();
  I18n.onChange(() => {
    applyLanguageToUI();
  });
  $$("[data-lang-choice]").forEach((button) =>
    button.addEventListener("click", () => I18n.setLanguage(button.dataset.langChoice)),
  );
}

function bindScrollSpy() {
  const navLinks = $$("#main-nav a");
  const sections = ["stats", "download", "releases"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!navLinks.length || !sections.length || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => link.classList.toggle("active", link.dataset.nav === entry.target.id));
      });
    },
    { rootMargin: "-40% 0px -55% 0px" },
  );
  sections.forEach((section) => observer.observe(section));
}

function renderMetrics() {
  const summary = state.overview.summary;
  // The headline is the software family only (summary.by_category.app), which is
  // what people mean by "how many downloads does Otzaria have".
  $("#hero-total").textContent = formatNumber(summary.by_category.app);
  $("#hero-total").classList.remove("loading-value");
  $("#hero-library").textContent = formatNumber(summary.by_category.library);
  $("#hero-delta-total").textContent = formatNumber(summary.by_category.delta);

  const deltaWrap = $("#hero-delta");
  deltaWrap.hidden = true;

  const updatedDate = new Date(state.overview.collected_at);
  const updatedElement = $("#updated-at");
  updatedElement.dateTime = state.overview.collected_at;
  updatedElement.title = dateTimeFormat.format(updatedDate);
  updatedElement.textContent = relativeTime(updatedDate);

  $("#metric-app").textContent = formatCompact(summary.by_category.app);
  $("#metric-sivan22").textContent = formatCompact(summary.by_source.sivan22);
  $("#metric-otzaria").textContent = formatCompact(summary.by_source.otzaria);
  $("#metric-library").textContent = formatCompact(summary.by_category.library);
  $("#metric-delta").textContent = formatCompact(summary.by_category.delta);
  $("#metric-releases").textContent = formatNumber(summary.release_count);

  const scope = $("#hero-scope");
  if (scope) {
    // Explicit footnote: the grand total mixes installers with multi-gigabyte
    // library files, so it is never the headline number.
    scope.textContent = t("hero.scope", {
      downloads: formatNumber(summary.tracked_downloads),
      releases: formatNumber(summary.release_count),
      assets: formatNumber(summary.asset_count),
    });
  }
}

/* ---------- Download section ---------- */

function pickCurrentRelease() {
  const release = state.overview?.featured_release;
  if (!release || release.prerelease || classifyChannel(release) !== "stable") return null;
  return release;
}

const NATIVE_PACKAGE = /\.(exe|msi|msix|dmg|pkg|deb|rpm|appimage|apk|ipa)$/i;
const PACKAGE_ARCHIVE = /\.(zip|tar\.(?:gz|xz|zst)|rar|7z|bin)$/i;
const SPLIT_PACKAGE = /(?:\.part-\d+|[-_.]part-?\d+\.zip)$/i;

function isDownloadAssistant(asset) {
  return /^otzaria-download-assistant[-_.]/i.test(asset.name);
}

function isAppBuild(asset) {
  if (asset.category !== "app" || isDownloadAssistant(asset)) return false;
  const name = asset.name;
  if (/^otzaria-update[-_.]|-library(?:-index)?\.tar\./i.test(name)) return false;
  return NATIVE_PACKAGE.test(name) || PACKAGE_ARCHIVE.test(name) || SPLIT_PACKAGE.test(name);
}

function platformAssetPriority(asset) {
  if (isDownloadAssistant(asset)) return 3;
  if (classifyVariant(asset) === "full") return 2;
  return NATIVE_PACKAGE.test(asset.name) ? 0 : 1;
}

function platformDownloadAssets(release, platform) {
  return release.assets.filter((asset) => {
    if (asset.category !== "app" || classifyOS(asset.name) !== platform) return false;
    if (isDownloadAssistant(asset)) return NATIVE_PACKAGE.test(asset.name) || PACKAGE_ARCHIVE.test(asset.name);
    return isAppBuild(asset) && !SPLIT_PACKAGE.test(asset.name);
  }).sort((left, right) =>
    platformAssetPriority(left) - platformAssetPriority(right) || right.downloads - left.downloads,
  );
}

function platformAssetLabel(asset) {
  return isDownloadAssistant(asset) ? t("download.assistant") : variantLabel(classifyVariant(asset));
}

function buildPlatformCard(platform, current, detected) {
  const variants = platformDownloadAssets(current, platform.id);
  const recommended = variants.length > 0 && platform.id === detected;
  const card = document.createElement("article");
  card.className = "platform-card";
  if (recommended) card.classList.add("is-recommended");

  const icon = document.createElement("span");
  icon.className = "platform-icon";
  icon.innerHTML = `<span class="material-symbols" aria-hidden="true">${platform.icon}</span>`;
  card.append(icon);

  if (recommended) {
    const tag = document.createElement("span");
    tag.className = "recommended-tag";
    tag.textContent = t("download.recommended");
    card.append(tag);
  }

  const heading = document.createElement("h3");
  heading.textContent = platform.label;
  card.append(heading);

  const meta = document.createElement("p");
  meta.className = "platform-meta";
  card.append(meta);

  if (!variants.length) {
    card.classList.add("is-unavailable");
    meta.textContent = t("download.unavailable", { platform: platform.label });
    const link = document.createElement("a");
    link.className = "btn btn-outlined";
    link.href = "#releases";
    link.textContent = t("download.searchOlder");
    link.addEventListener("click", () => {
      clearRankedReleaseList();
      setReleaseListFilters({ type: "app", os: platform.id });
      state.osFocus = platform.id;
      if (state.statsReady) renderOsChart();
      refreshReleases();
    });
    card.append(link);
    return card;
  }

  const primary = variants[0];
  meta.textContent = t("download.assetMeta", {
    variant: platformAssetLabel(primary),
    size: formatBytes(primary.size),
    count: formatNumber(primary.downloads),
  });

  const button = document.createElement("a");
  button.className = "btn btn-filled";
  button.href = primary.download_url;
  button.rel = "noopener noreferrer";
  button.append(t("download.button"), " ");
  const buttonIcon = document.createElement("span");
  buttonIcon.className = "material-symbols";
  buttonIcon.setAttribute("aria-hidden", "true");
  buttonIcon.textContent = "download";
  button.append(buttonIcon);
  card.append(button);

  if (variants.length > 1) {
    const details = document.createElement("details");
    details.className = "platform-more";
    const summary = document.createElement("summary");
    summary.textContent = t("download.moreOptions", { count: formatNumber(variants.length - 1) });
    const list = document.createElement("div");
    list.className = "platform-more-list";
    variants.slice(1).forEach((asset) => {
      const row = document.createElement("div");
      row.className = "platform-more-row";
      const name = document.createElement("span");
      name.textContent = asset.name;
      name.title = asset.name;
      const link = document.createElement("a");
      link.href = asset.download_url;
      link.rel = "noopener noreferrer";
      link.textContent = t("download.moreRow", { variant: platformAssetLabel(asset), size: formatBytes(asset.size) });
      row.append(name, link);
      list.append(row);
    });
    details.append(summary, list);
    card.append(details);
  }

  return card;
}

function renderDownloadGrid() {
  const container = $("#download-grid");
  const current = pickCurrentRelease();
  const version = $("#download-version-line");
  const banner = $("#os-banner");
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");
  version.removeAttribute("data-i18n");
  version.hidden = !current;
  banner.hidden = true;

  if (!current) {
    const empty = document.createElement("p");
    empty.className = "empty-releases";
    empty.textContent = t("download.noRelease");
    container.append(empty);
    return;
  }

  version.textContent = t("download.versionLine", {
    tag: current.tag,
    date: dateFormat.format(new Date(current.published_at)),
    count: formatNumber(releaseDownloads(current, "app")),
  });

  const detectedId = detectPlatform();
  const detected = PLATFORMS.find((platform) => platform.id === detectedId);
  if (detected && platformDownloadAssets(current, detected.id).length) {
    banner.hidden = false;
    $("#os-banner-text").textContent = t("download.osBanner", { platform: detected.label });
  }

  PLATFORMS.forEach((platform) => container.append(buildPlatformCard(platform, current, detectedId)));
}

/* ---------- OS breakdown chart ---------- */

const OS_KEYS = ["windows", "macos", "android", "linux", "ios", "other"];

// The library and its delta patches are the very same bytes on every platform,
// so an "operating system" breakdown of them would be an invented number.
const osNotApplicableCopy = (source) => t(`os.notApplicable.${source}`);

function emptyOsTotals() {
  return Object.fromEntries(OS_KEYS.map((key) => [key, 0]));
}

/** Which measurement the donut can actually describe: only the software family
 * has an operating system. Returns "app", one repository id, or null. */
function osFamily() {
  if (state.source === "library" || state.source === "delta") return null;
  return state.source === "sivan22" || state.source === "otzaria" ? state.source : "app";
}

/** The donut follows the range chips only while they are really in play: while
 * history is too short for any chip the row is hidden, and a silent range filter
 * behind a hidden row would be a number nobody could explain. */
function donutRange() {
  return state.rangeChipsVisible ? state.range : "all";
}

/** Daily snapshots store counters per asset id. Join them to their platform
 * and release in the catalog for both charts. */
function historyAssetIndex() {
  if (!state.assetIndex) {
    const index = new Map();
    const liveReleases = new Map();
    state.latest.releases.forEach((release) => {
      liveReleases.set(releaseKey(release), release);
      release.assets.forEach((asset) => {
        index.set(`${release.source}:${asset.id}`, { release, name: asset.name, available: true });
      });
    });
    for (const [key, asset] of Object.entries(state.timeseries?.historical_assets || {})) {
      if (index.has(key)) continue;
      const liveRelease = liveReleases.get(releaseKey(asset.release));
      index.set(key, { ...asset, release: liveRelease || asset.release, available: Boolean(liveRelease) });
    }
    state.assetIndex = index;
  }
  return state.assetIndex;
}

// Both panels and overlapping range changes share this queue as well as the
// per-date promise cache. A 90-day range can need more than 90 snapshots, but
// only a few requests (including their JSON bodies) should be active at once.
const HISTORY_REQUEST_LIMIT = 4;
const HISTORY_REQUEST_TIMEOUT_MS = 30_000;
const historyQueue = [];
const historyJobs = new Map();
let activeHistoryRequests = 0;

function historyCancellation() {
  const error = new Error("History selection changed");
  error.name = "AbortError";
  return error;
}

// Both panels use the same selected date range. Reconcile their combined
// demand before rendering either one, retaining every overlapping request.
function syncHistorySelection(requiredDates) {
  const wanted = new Set(requiredDates);
  const obsolete = [...historyJobs.values()].filter((job) => !wanted.has(job.date));
  // Remove all obsolete queued work before any aborted request can drain it.
  const retained = historyQueue.filter((job) => wanted.has(job.date));
  historyQueue.length = 0;
  historyQueue.push(...retained);
  for (const job of obsolete) {
    job.cancelled = true;
    // Evict now: another selection can request this date again before the
    // aborted fetch settles. Its later cleanup must not erase a replacement.
    if (state.historyPromises[job.date] === job.promise) delete state.historyPromises[job.date];
    if (historyJobs.get(job.date) === job) historyJobs.delete(job.date);
    if (job.controller) job.controller.abort();
    else job.reject(historyCancellation());
  }
  // Active jobs retain their slots until fetch/body cleanup reaches finally.
  drainHistoryQueue();
}

function drainHistoryQueue() {
  while (activeHistoryRequests < HISTORY_REQUEST_LIMIT && historyQueue.length) {
    const job = historyQueue.shift();
    activeHistoryRequests += 1;
    fetchHistoryPoint(job).then(job.resolve, job.reject);
  }
}

async function fetchHistoryPoint(job) {
  const controller = new AbortController();
  job.controller = controller;
  let timedOut = false;
  // Start the deadline when a request gets a slot, not while it is queued.
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, HISTORY_REQUEST_TIMEOUT_MS);
  try {
    const snapshot = await fetchJson(`data/history/${job.date}.json`, { signal: controller.signal });
    if (job.cancelled) throw historyCancellation();
    return snapshot;
  } catch (error) {
    if (job.cancelled) throw historyCancellation();
    if (timedOut) throw new Error(t("error.historyTimeout"));
    throw error;
  } finally {
    clearTimeout(timeout);
    // HTTP errors can leave an unread streaming body. Cancel that transfer
    // before releasing its slot; completed successful bodies are unaffected.
    controller.abort();
    if (historyJobs.get(job.date) === job) historyJobs.delete(job.date);
    activeHistoryRequests -= 1;
    drainHistoryQueue();
  }
}

function loadHistoryPoint(date) {
  if (!state.historyPromises[date]) {
    const job = { date, controller: null, cancelled: false };
    const pending = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    const cached = pending.catch((error) => {
      // Keep successful snapshots reusable; a transient failure must not make
      // every later range selection fail until the page is reloaded.
      if (state.historyPromises[date] === cached) delete state.historyPromises[date];
      throw error;
    });
    job.promise = cached;
    state.historyPromises[date] = cached;
    historyJobs.set(date, job);
    historyQueue.push(job);
    drainHistoryQueue();
  }
  return state.historyPromises[date];
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Use the latest N calendar dates, including the latest snapshot date itself. */
function firstTimePointIndex(points, range) {
  if (range === "all" || !points.length) return 0;
  const cutoff = Date.parse(points.at(-1).date) - (Number(range) - 1) * MILLISECONDS_PER_DAY;
  const firstIndex = points.findIndex((point) => Date.parse(point.date) >= cutoff);
  return firstIndex >= 0 ? firstIndex : points.length;
}

/** Load the selected dates plus the preceding snapshot as a baseline for gains. */
function historyDatesForRange(days) {
  const points = state.timeseries?.points || [];
  if (points.length < 2) return [];
  const firstIndex = firstTimePointIndex(points, days);
  if (firstIndex === points.length) return [];
  return points.slice(Math.max(0, firstIndex - 1)).map((point) => point.date);
}

/** All-time totals: the cumulative counter GitHub reports for every asset today. */
function osTotalsAllTime(family, selectedKey = null) {
  const totals = emptyOsTotals();
  state.latest.releases.forEach((release) => {
    if (!isAppRelease(release)) return;
    if (family !== "app" && release.source !== family) return;
    if (selectedKey && releaseKey(release) !== selectedKey) return;
    trackedAssets(release, "app").forEach((asset) => {
      totals[classifyOS(asset.name)] += asset.downloads;
    });
  });
  return totals;
}

function forEachHistoryGain(snapshots, visit) {
  for (let day = 1; day < snapshots.length; day += 1) {
    const previous = snapshots[day - 1]?.assets || {};
    const current = snapshots[day]?.assets || {};
    Object.entries(current).forEach(([key, entry]) => {
      const [downloads, category] = Array.isArray(entry) ? entry : [0, ""];
      const gained = downloads - (previous[key]?.[0] ?? 0);
      if (gained > 0) visit(key, category, gained);
    });
  }
}

/** Range totals use the same positive asset-counter differences as the ranking. */
async function osTotalsForRange(family, days, selectedKey = null) {
  const dates = historyDatesForRange(days);
  if (dates.length < 2) return null;
  const snapshots = await Promise.all(dates.map(loadHistoryPoint));
  const index = historyAssetIndex();
  const totals = emptyOsTotals();
  forEachHistoryGain(snapshots, (key, category, gained) => {
    if (category !== "app") return;
    if (family !== "app" && !key.startsWith(`${family}:`)) return;
    const asset = index.get(key);
    if (selectedKey && (!asset || releaseKey(asset.release) !== selectedKey)) return;
    totals[classifyOS(asset?.name)] += gained;
  });
  return totals;
}

/** Percentages in tenths, distributed by largest remainder so the legend always
 * adds up to exactly 100.0% instead of 99.8% or 100.3%. */
function percentShares(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 1000);
  const shares = exact.map((value) => Math.floor(value));
  let remainder = 1000 - shares.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction)
    .forEach((item) => {
      if (remainder <= 0) return;
      shares[item.index] += 1;
      remainder -= 1;
    });
  return shares;
}

function formatShare(tenths) {
  return `${percentFormat.format(tenths / 10)}%`;
}

function osSliceColors(keys, focus) {
  return keys.map((key) => {
    const color = palette[key] || palette.other;
    return focus && focus !== key ? hexToRgba(color, 0.2) : color;
  });
}

/** A click on a slice or a legend row isolates that platform here and feeds the
 * very same choice into the "all releases" filter below. */
function toggleOsFocus(key) {
  if (key === "other") {
    state.osFocus = state.osFocus === key
      ? (state.releaseOS === "all" ? null : state.releaseOS)
      : key;
    if (state.osFocus === key) showToast(t("toast.osOther"));
  } else {
    state.osFocus = state.osFocus === key ? null : key;
    const target = state.osFocus || "all";
    if (state.releaseOS !== target) {
      state.releaseOS = target;
      state.releaseLimit = 8;
      setButtonState($$("[data-os]"), state.releaseOS, "os");
      refreshReleases();
    }
    showToast(state.osFocus
      ? t("toast.osFiltered", { os: osLabel(state.osFocus) })
      : t("toast.osFilterCleared"));
  }
  renderOsChart();
}

function hideOsData() {
  if (state.osChart) {
    state.osChart.destroy();
    state.osChart = null;
  }
  $("#donut-stage").hidden = true;
  $("#os-legend").replaceChildren();
  $("#os-legend").hidden = true;
  $("#os-note").hidden = true;
}

function showOsMessage(text) {
  hideOsData();
  const empty = $("#os-empty");
  empty.hidden = false;
  empty.textContent = text;
}

function renderOsLegend(entries, shares, total, focus) {
  const legend = $("#os-legend");
  legend.replaceChildren();
  legend.hidden = false;
  const detected = detectPlatform();

  entries.forEach(([key, value], position) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "donut-legend-row";
    row.dataset.osKey = key;
    const isFocused = focus === key;
    row.classList.toggle("is-focused", isFocused);
    row.classList.toggle("is-dimmed", Boolean(focus) && !isFocused);
    row.setAttribute("aria-pressed", String(isFocused));

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    dot.style.background = palette[key] || palette.other;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = osLabel(key);
    if (key === detected) {
      const badge = document.createElement("span");
      badge.className = "you-badge";
      badge.textContent = t("donut.yourOs");
      label.append(" ", badge);
    }

    const valueElement = document.createElement("span");
    valueElement.className = "value";
    valueElement.textContent = `${formatCompact(value)} · ${formatShare(shares[position])}`;

    row.append(dot, label, valueElement);
    row.setAttribute(
      "aria-label",
      t("donut.legendRowAria", {
        os: osLabel(key),
        count: formatNumber(value),
        share: formatShare(shares[position]),
      }) + (key === detected ? t("donut.legendRowYours") : ""),
    );
    row.title = t("donut.legendRowTitle", { os: osLabel(key), count: formatNumber(value) });
    row.addEventListener("click", () => toggleOsFocus(key));
    legend.append(row);
  });

  // A visible control total: the rows above must add up to this line exactly.
  const sum = document.createElement("p");
  sum.className = "donut-legend-total";
  sum.textContent = t("donut.legendTotal", { count: formatNumber(total) });
  legend.append(sum);
}

async function renderOsChart() {
  const token = (state.osRenderToken += 1);
  if (!state.latest) return;

  const subtitle = $("#donut-subtitle");
  const family = osFamily();
  const range = donutRange();
  const selected = state.mode === "releases" ? state.selectedRankingRow : null;
  const selectedKey = selected?.key ?? null;
  const familyName = selected ? rankingReleaseLabel(selected) : familyLabel(state.source);

  if (!family) {
    subtitle.textContent = t("donut.subtitle.sameFile", { family: familyName });
    showOsMessage(osNotApplicableCopy(state.source));
    return;
  }

  let totals = null;
  let fallbackNote = "";
  if (range === "all") {
    totals = osTotalsAllTime(family, selectedKey);
  } else {
    hideOsData();
    $("#os-empty").hidden = true;
    subtitle.textContent = t("donut.subtitle.calculating", { family: familyName });
    try {
      totals = await osTotalsForRange(family, range, selectedKey);
    } catch (_) {
      totals = null;
      fallbackNote = t("donut.fallback.snapshotError");
    }
    if (token !== state.osRenderToken) return;
    if (!totals) {
      totals = osTotalsAllTime(family, selectedKey);
      fallbackNote = fallbackNote || t("donut.fallback.notEnough");
    }
  }

  const rangeLabel = rangeChipLabel(range);
  const isCumulative = range === "all" || Boolean(fallbackNote);
  subtitle.textContent =
    isCumulative
      ? t(selected ? "donut.subtitle.releaseAllTime" : "donut.subtitle.allTime", { family: familyName })
      : t("donut.subtitle.range", { family: familyName, range: rangeLabel });

  const entries = Object.entries(totals)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1]);

  if (!entries.length) {
    const message = isCumulative
      ? t(selected?.available === false ? "donut.empty.removed" : "donut.empty.allTime", { family: familyName })
      : t("donut.empty.range", { family: familyName, range: rangeLabel });
    showOsMessage(message);
    if (fallbackNote) {
      $("#os-note").textContent = fallbackNote;
      $("#os-note").hidden = false;
    }
    return;
  }

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const shares = percentShares(entries.map(([, value]) => value));
  const keys = entries.map(([key]) => key);
  const focus = keys.includes(state.osFocus) ? state.osFocus : null;

  $("#donut-stage").hidden = false;
  $("#os-empty").hidden = true;

  if (state.osChart) state.osChart.destroy();
  const canvas = $("#os-chart");
  canvas.setAttribute(
    "aria-label",
    t("donut.canvasAriaData", {
      family: familyName,
      breakdown: entries
        .map(([key, value], position) =>
          t("donut.canvasEntry", {
            os: osLabel(key),
            share: formatShare(shares[position]),
            count: formatNumber(value),
          }),
        )
        .join(", "),
    }),
  );

  state.osChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: keys.map((key) => osLabel(key)),
      datasets: [
        {
          data: entries.map(([, value]) => value),
          backgroundColor: osSliceColors(keys, focus),
          borderColor: cssColor("--card-background"),
          borderWidth: 2,
          offset: keys.map((key) => (focus === key ? 10 : 0)),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300 },
      onClick: (_event, elements) => {
        if (!elements.length) return;
        toggleOsFocus(keys[elements[0].index]);
      },
      onHover: (event, elements) => {
        const target = event.native?.target;
        if (target) target.style.cursor = elements.length ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: isRTL(),
          textDirection: I18n.dir,
          backgroundColor: cssColor("--surface-container-highest"),
          titleColor: cssColor("--on-surface"),
          bodyColor: cssColor("--on-surface"),
          borderColor: cssColor("--outline-variant"),
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (context) =>
              t("donut.tooltip", { count: formatNumber(context.raw), share: formatShare(shares[context.dataIndex]) }),
            afterLabel: () => t("donut.tooltipHint"),
          },
        },
      },
    },
  });

  const center = $("#os-total");
  center.replaceChildren();
  const centerValue = document.createElement("strong");
  centerValue.textContent = formatCompact(total);
  const centerLabel = document.createElement("span");
  centerLabel.textContent = isCumulative ? t("donut.centerAll") : t("donut.centerRange");
  center.append(centerValue, centerLabel);

  renderOsLegend(entries, shares, total, focus);

  const note = $("#os-note");
  const notes = [];
  if (fallbackNote) notes.push(fallbackNote);
  if (range === "all") {
    // The cumulative counters predate the daily collection, so this donut is
    // deliberately larger than the "new downloads" figure of the chart beside it.
    const firstDate = state.timeseries?.points?.[0]?.date;
    notes.push(
      firstDate
        ? t("donut.note.allTimeSince", { date: snapshotDateFormat.format(Date.parse(firstDate)) })
        : t("donut.note.allTime"),
    );
  }
  if (totals.other > 0) {
    notes.push(t("donut.note.other"));
  }
  notes.push(t("donut.note.filename"));
  note.textContent = notes.join(" ");
  note.hidden = false;
}

/* ---------- Timeline chart ---------- */

// The daily snapshot history is still short (collection started on 2026-07-19),
// so a 7/30/90/182/365 day chip would slice exactly the same points as "all" and
// look broken when clicked. A chip for N days is therefore shown only once the
// collected points span more than N/2 days, and the whole row is hidden when only
// "all" would remain. The chips return on their own as history grows, and they
// now apply to every mode — including the release ranking, where a range turns a
// cumulative, age-biased ordering into a genuine "what is being downloaded now".
function syncRangeChips() {
  const row = $("#range-filter");
  state.rangeChipsVisible = false;
  if (!row) return;

  const chips = $$("[data-range]", row);
  const points = state.timeseries?.points || [];
  const firstDate = Date.parse(points[0]?.date ?? "");
  const lastDate = Date.parse(points.at(-1)?.date ?? "");
  const spanDays =
    Number.isFinite(firstDate) && Number.isFinite(lastDate) ? (lastDate - firstDate) / MILLISECONDS_PER_DAY : 0;

  let usableRanges = 0;
  chips.forEach((chip) => {
    if (chip.dataset.range === "all") return;
    const usable = spanDays > Number(chip.dataset.range) / 2;
    chip.hidden = !usable;
    if (usable) usableRanges += 1;
  });

  row.hidden = usableRanges === 0;
  state.rangeChipsVisible = !row.hidden;

  const activeChip = chips.find((chip) => chip.dataset.range === state.range);
  if (activeChip && activeChip.hidden) {
    state.range = "all";
    setButtonState(chips, state.range, "range");
  }
}

function filteredTimePoints() {
  const points = state.timeseries?.points || [];
  return points.slice(firstTimePointIndex(points, state.range));
}

function timeDataset() {
  const section = state.mode === "daily" ? "changes" : "totals";
  const data = filteredTimePoints().map((point) => ({
    x: Date.parse(point.date),
    y: valueFor(point, state.source, section),
  }));
  return [
    {
      label: familyLabel(state.source),
      data,
      borderColor: palette[state.source],
      backgroundColor: hexToRgba(palette[state.source], 0.12),
      pointBackgroundColor: cssColor("--card-background"),
      pointBorderColor: palette[state.source],
      pointBorderWidth: 2,
      pointRadius: data.length > 45 ? 0 : 4,
      pointHoverRadius: 6,
      borderWidth: 2.5,
      fill: true,
      tension: 0.3,
      spanGaps: false,
    },
  ];
}

function timeChartSummary() {
  const family = familyLabel(state.source);
  const points = filteredTimePoints();
  if (state.mode === "daily") {
    const total = points.reduce((sum, point) => sum + (valueFor(point, state.source, "changes") || 0), 0);
    return t("chart.summary.daily", { count: formatNumber(total), family });
  }
  const last = points.at(-1);
  return last
    ? t("chart.summary.cumulative", { count: formatNumber(valueFor(last, state.source, "totals")), family })
    : t("chart.summary.empty");
}

/** A small legend so a multi-series chart (the two software repositories) is
 * readable without hovering; single-series charts already have the active chip. */
function renderChartLegend(entries) {
  const legend = $("#chart-legend");
  if (!legend) return;
  legend.replaceChildren();
  legend.hidden = entries.length < 2;
  if (legend.hidden) return;
  entries.forEach((entry) => {
    const row = document.createElement("span");
    row.className = "chart-legend-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = entry.color;
    const label = document.createElement("span");
    label.textContent = entry.label;
    row.append(dot, label);
    legend.append(row);
  });
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function destroyChart() {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
}

function showChartEmpty(title, detail) {
  destroyChart();
  const empty = $("#chart-empty");
  empty.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = title;
  const text = document.createElement("span");
  text.textContent = detail;
  empty.append(heading, text);
  empty.hidden = false;
  $("#downloads-chart").hidden = true;
}

/* ---------- Release ranking ---------- */

// How many bars the ranking draws. Fifteen rows still leave every bar thick
// enough to compare by length and every caption readable without rotation.
const TOP_RELEASES = 15;

// The software family keeps its two repositories apart — same software, two
// chapters of its history — so every bar stays attributable to one repository.
const rankingConfigurations = [
  { key: "sivan22", family: "app", category: "app", match: (release) => release.source === "sivan22" },
  { key: "otzaria", family: "app", category: "app", match: (release) => release.source === "otzaria" },
  { key: "library", family: "library", category: "library", match: (release) => release.source === "seforim" },
  { key: "delta", family: "delta", category: "delta", match: (release) => release.source === "seforim" },
];

function activeRankingConfigurations() {
  return rankingConfigurations.filter((config) => state.source === config.key || state.source === config.family);
}

/** A short, still unique caption for the category axis. Library and delta tags
 * carry a full timestamp ("v27-20260906092829") that would swallow the axis, so
 * only their sequence number is kept. */
function releaseAxisLabel(release) {
  return release.source === "seforim" ? release.tag.split("-")[0] : release.tag;
}

function rankingRow(release, config, value, available = true) {
  return {
    key: releaseKey(release),
    category: config.category,
    source: release.source,
    available,
    value,
    colorKey: config.key,
    axisLabel: releaseAxisLabel(release),
    name: release.name,
    tag: release.tag,
    publishedAt: release.published_at,
  };
}

/** All-time ranking: the cumulative counter GitHub reports for every asset of
 * the release today. */
function allTimeRankingRows() {
  const rows = [];
  activeRankingConfigurations().forEach((config) => {
    state.latest.releases.filter(config.match).forEach((release) => {
      const value = releaseDownloads(release, config.category);
      if (value > 0) rows.push(rankingRow(release, config, value));
    });
  });
  return rows.sort((left, right) => right.value - left.value);
}

/** Range ranking: the same positive per-asset daily differences the collector
 * records, grouped by the release each asset belongs to. Unlike the cumulative
 * counters this ordering carries no age bias at all — every release is measured
 * over exactly the same days. Snapshots are fetched lazily and cached, and are
 * the very files the donut beside it already loads for the same range. */
async function rangeRankingRows(days) {
  const dates = historyDatesForRange(days);
  if (dates.length < 2) return null;
  const configs = activeRankingConfigurations();
  const snapshots = await Promise.all(dates.map(loadHistoryPoint));
  const index = historyAssetIndex();
  const rows = new Map();
  forEachHistoryGain(snapshots, (key, category, gained) => {
    const asset = index.get(key);
    if (!asset) return;
    const config = configs.find((item) => item.category === category && item.match(asset.release));
    if (!config) return;
    const rowKey = releaseKey(asset.release);
    const row = rows.get(rowKey);
    if (row) row.value += gained;
    else rows.set(rowKey, rankingRow(asset.release, config, gained, asset.available));
  });
  return [...rows.values()].sort((left, right) => right.value - left.value);
}

function rangeChipLabel(range) {
  return $(`[data-range="${range}"]`)?.textContent?.trim() || t("range.daysFallback", { count: range });
}

function rankingReleaseLabel(row) {
  return t("ranking.releaseLabel", { tag: row.tag, source: sourceLabel(row.source) });
}

function renderRankingSelection() {
  const controls = $("#ranking-selection");
  if (!controls) return;
  const selected = state.selectedRankingRow;
  const options = state.rankedRows.slice(0, TOP_RELEASES);
  if (selected && !options.some((row) => row.key === selected.key)) options.push(selected);
  controls.hidden = state.mode !== "releases" || !options.length;
  if (controls.hidden) return;

  const select = $("#ranking-release-select");
  const all = document.createElement("option");
  all.value = "";
  all.textContent = t("ranking.selection.all");
  select.replaceChildren(all);
  options.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.key;
    option.textContent = rankingReleaseLabel(row);
    select.append(option);
  });
  select.value = selected?.key ?? "";

  $("#ranking-selected-link").hidden = !selected || selected.available === false;
  $("#ranking-selected-unavailable").hidden = selected?.available !== false;
}

function rankingBarColors(rows) {
  const selected = state.selectedRankingRow;
  return rows.map((row) => {
    const color = palette[row.colorKey];
    return selected && row.key !== selected.key ? hexToRgba(color, 0.35) : color;
  });
}

function selectRankingRelease(key) {
  if (state.mode !== "releases") return;
  const selected = state.rankedRows.find((row) => row.key === key) || null;
  if (key && !selected) return;
  if (state.selectedRankingRow?.key === selected?.key) return;
  state.selectedRankingRow = selected;
  renderRankingSelection();
  if (state.chart) {
    const dataset = state.chart.data.datasets[0];
    dataset.backgroundColor = rankingBarColors(state.rankedRows.slice(0, TOP_RELEASES));
    state.chart.update("none");
  }
  return renderOsChart();
}

function renderRankedReleaseScope() {
  const scope = $("#release-rank-scope");
  if (!scope) return;
  const selection = state.rankedReleaseList;
  scope.hidden = !selection;
  if (!selection) return;
  $("#release-rank-scope-label").textContent = selection.single
    ? t("ranking.list.release", { release: rankingReleaseLabel(selection.single) })
    : t("ranking.list.ranked", {
        count: formatNumber(selection.keys.size),
        family: familyLabel(selection.source),
        range: rangeChipLabel(selection.range),
      });
}

function clearRankedReleaseList() {
  state.rankedReleaseList = null;
  renderRankedReleaseScope();
}

function showRankedReleaseList(rows, single = false) {
  const available = rows.filter((row) => row.available !== false);
  if (state.mode !== "releases" || !available.length) return;
  const category = available[0].category;
  state.rankedReleaseList = {
    keys: new Set(available.map((row) => row.key)),
    category: category === "app" ? null : category,
    single: single ? available[0] : null,
    source: state.source,
    range: state.rankedRange,
  };
  setReleaseListFilters();
  if (state.osFocus) {
    state.osFocus = null;
    renderOsChart();
  }
  renderRankedReleaseScope();
  return refreshReleases();
}

function bindRankingLink() {
  $("#chart-all-releases")?.addEventListener("click", () => showRankedReleaseList(state.rankedRows));
  $("#ranking-release-select")?.addEventListener("change", (event) => selectRankingRelease(event.target.value));
  $("#ranking-selected-link")?.addEventListener("click", () => {
    if (state.selectedRankingRow) showRankedReleaseList([state.selectedRankingRow], true);
  });
  $("#release-rank-scope-clear")?.addEventListener("click", () => {
    clearRankedReleaseList();
    state.releaseLimit = 8;
    refreshReleases();
  });
}

function rankingScopeWord(rangeActive) {
  return rangeActive ? t("ranking.scope.new") : t("ranking.scope.all");
}

async function renderReleaseRanking(token) {
  const family = familyLabel(state.source);
  const summary = $("#chart-summary");
  const note = $("#chart-note");
  const link = $("#chart-all-releases");
  // The chips are only honoured while they are really on screen; a silent range
  // filter behind a hidden row would be a number nobody could explain.
  const range = state.rangeChipsVisible ? state.range : "all";

  let rows = null;
  let fallbackNote = "";
  if (range === "all") {
    rows = allTimeRankingRows();
  } else {
    state.rankedRows = [];
    if (link) link.hidden = true;
    renderRankingSelection();
    showChartEmpty(t("ranking.calculating", { range: rangeChipLabel(range) }), "");
    renderChartLegend([]);
    note.textContent = "";
    summary.textContent = t("ranking.calculating", { range: rangeChipLabel(range) });
    try {
      rows = await rangeRankingRows(range);
    } catch (_) {
      rows = null;
      fallbackNote = t("ranking.fallback.snapshotError");
    }
    if (token !== state.chartRenderToken) return;
    if (!rows) {
      rows = allTimeRankingRows();
      fallbackNote = fallbackNote || t("ranking.fallback.notEnough");
    }
  }

  const rangeActive = range !== "all" && !fallbackNote;
  const rangeLabel = rangeActive ? rangeChipLabel(range) : "";
  const scope = rankingScopeWord(rangeActive);
  state.rankedRows = rows;
  state.rankedRange = rangeActive ? range : "all";
  renderRankingSelection();

  if (link) {
    const availableCount = rows.filter((row) => row.available !== false).length;
    link.hidden = !availableCount;
    $("#chart-all-releases-text").textContent = rangeActive
      ? t("ranking.allLink.range", { count: formatNumber(availableCount), range: rangeLabel })
      : t("ranking.allLink.family", { count: formatNumber(availableCount), family });
  }

  if (!rows.length) {
    summary.textContent = rangeActive
      ? t("ranking.summary.emptyRange", { scope, range: rangeLabel, family })
      : t("ranking.summary.emptyAll", { family });
    renderChartLegend([]);
    note.textContent = fallbackNote || (rangeActive
      ? t("ranking.note.emptyRange", { family, range: rangeLabel })
      : t("ranking.note.emptyAll", { family }));
    showChartEmpty(
      t("ranking.empty.title"),
      rangeActive
        ? t("ranking.empty.detailRange", { family, range: rangeLabel })
        : t("ranking.note.emptyAll", { family }),
    );
    return;
  }

  const shown = rows.slice(0, TOP_RELEASES);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const shownTotal = shown.reduce((sum, row) => sum + row.value, 0);
  // Exact tenths by largest remainder, the same rule the donut legend uses.
  const shownShare = formatShare(percentShares([shownTotal, total - shownTotal])[0]);
  const top = shown[0];

  summary.textContent =
    t("ranking.summary.lead", { tag: top.axisLabel, count: formatNumber(top.value), scope }) +
    (shown.length > 1
      ? t("ranking.summary.top", {
          count: formatNumber(shown.length),
          share: shownShare,
          total: formatNumber(total),
        })
      : t("ranking.summary.single", { total: formatNumber(total) })) +
    t("ranking.summary.family", { family }) +
    (rangeActive ? t("ranking.summary.range", { range: rangeLabel }) : "");

  const usedKeys = [...new Set(shown.map((row) => row.colorKey))];
  renderChartLegend(usedKeys.map((key) => ({ label: familyLabel(key), color: palette[key] })));

  const notes = [];
  if (fallbackNote) notes.push(fallbackNote);
  if (rangeActive) {
    notes.push(t("ranking.note.range", { range: rangeLabel }));
  } else {
    notes.push(t("chart.note.allTime"));
    if (state.rangeChipsVisible) notes.push(t("ranking.note.pickRange"));
  }
  if (rows.some((row) => row.available === false)) notes.push(t("ranking.note.unavailable"));
  notes.push(t(osFamily() ? "ranking.note.click" : "ranking.note.clickSameFile"));
  note.textContent = notes.join(" ");

  const canvas = $("#downloads-chart");
  const empty = $("#chart-empty");
  empty.hidden = true;
  canvas.hidden = false;
  canvas.setAttribute(
    "aria-label",
    t("ranking.aria.base", { count: formatNumber(shown.length), family, scope }) +
      (rangeActive ? t("ranking.aria.range", { range: rangeLabel }) : t("ranking.aria.allTime")) +
      ": " +
      shown.map((row, position) => `${position + 1}. ${row.axisLabel} — ${formatNumber(row.value)}`).join(", "),
  );

  destroyChart();

  const textColor = cssColor("--on-surface");
  // The number rides at the end of each bar, so the ranking is fully readable
  // without a tooltip — the tooltip only adds the release name and its date.
  const valueLabels = {
    id: "rankingValueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const bars = chart.getDatasetMeta(0).data;
      ctx.save();
      ctx.font = "600 12px Rubik, system-ui, sans-serif";
      ctx.fillStyle = textColor;
      ctx.textBaseline = "middle";
      bars.forEach((bar, position) => {
        // The value axis is reversed in RTL, so the bar tip sits left of its
        // base there and right of it in LTR; the label simply follows the tip
        // whichever way the bar grows, which makes it direction-agnostic.
        const direction = bar.x <= bar.base ? -1 : 1;
        ctx.textAlign = direction < 0 ? "right" : "left";
        ctx.fillText(formatNumber(shown[position].value), bar.x + direction * 8, bar.y);
      });
      ctx.restore();
    },
  };

  state.chart = new Chart(canvas, {
    type: "bar",
    plugins: [valueLabels],
    data: {
      labels: shown.map((row) => row.axisLabel),
      datasets: [
        {
          label: scope,
          data: shown.map((row) => row.value),
          backgroundColor: rankingBarColors(shown),
          hoverBackgroundColor: shown.map((row) => palette[row.colorKey]),
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 26,
          categoryPercentage: 0.88,
          barPercentage: 0.86,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduceMotion() ? 0 : 300 },
      interaction: { mode: "index", axis: "y", intersect: false },
      // Head-room for the value label that rides past the tip of each bar: in
      // RTL the bars grow leftwards, in LTR rightwards.
      layout: { padding: isRTL() ? { left: 8, right: 4 } : { left: 4, right: 8 } },
      onClick: (_event, elements) => {
        if (!elements.length) return;
        const key = shown[elements[0].index]?.key;
        if (key) return selectRankingRelease(state.selectedRankingRow?.key === key ? "" : key);
      },
      onHover: (event, elements) => {
        const target = event.native?.target;
        if (target) target.style.cursor = elements.length ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: isRTL(),
          textDirection: I18n.dir,
          backgroundColor: cssColor("--surface-container-highest"),
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: cssColor("--outline-variant"),
          borderWidth: 1,
          padding: 12,
          titleFont: { family: "Rubik", size: 12 },
          bodyFont: { family: "Rubik", size: 12 },
          callbacks: {
            title: (items) => (items.length ? shown[items[0].dataIndex].name : ""),
            label: (context) => t("ranking.tooltip.label", { scope, count: formatNumber(shown[context.dataIndex].value) }),
            afterLabel(context) {
              const row = shown[context.dataIndex];
              const published = row.publishedAt ? dateFormat.format(new Date(row.publishedAt)) : t("common.noDate");
              return t("ranking.tooltip.after", { tag: row.tag, published, source: sourceLabel(row.source) });
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          // The value axis starts at the inline start of the stage: the right
          // edge in Hebrew, the left edge in English.
          reverse: isRTL(),
          suggestedMax: Math.ceil(top.value * 1.16),
          border: { display: false },
          grid: { color: hexToRgba(cssColor("--outline"), 0.18) },
          ticks: {
            color: cssColor("--on-surface-variant"),
            maxTicksLimit: 5,
            callback: (value) => compactFormat.format(value),
          },
        },
        y: {
          // The category axis sits opposite the value axis, i.e. at the inline
          // start of the stage in both directions.
          position: isRTL() ? "right" : "left",
          grid: { display: false },
          border: { color: cssColor("--outline-variant") },
          ticks: {
            color: cssColor("--on-surface-variant"),
            autoSkip: false,
            font: { family: "Rubik", size: 12 },
          },
        },
      },
    },
  });
}

function renderTimeChart() {
  const canvas = $("#downloads-chart");
  const empty = $("#chart-empty");
  const datasets = timeDataset();
  const hasData = state.mode !== "daily" || datasets.some((dataset) => dataset.data.some((point) => point.y !== null));

  $("#chart-summary").textContent = timeChartSummary();
  renderChartLegend(
    datasets.filter((dataset) => dataset.data.length).map((dataset) => ({ label: dataset.label, color: dataset.borderColor })),
  );
  $("#chart-note").textContent = state.mode === "daily" ? t("chart.note.daily") : t("chart.note.cumulative");

  if (!hasData) {
    showChartEmpty(t("chart.empty.title"), t("chart.empty.detail"));
    return;
  }

  destroyChart();
  empty.hidden = true;
  canvas.hidden = false;
  canvas.setAttribute(
    "aria-label",
    t("chart.aria.time", {
      mode: state.mode === "daily" ? t("chart.aria.daily") : t("chart.aria.cumulative"),
      family: familyLabel(state.source),
    }),
  );

  state.chart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduceMotion() ? 0 : 300 },
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: isRTL(),
          textDirection: I18n.dir,
          backgroundColor: cssColor("--surface-container-highest"),
          titleColor: cssColor("--on-surface"),
          bodyColor: cssColor("--on-surface"),
          borderColor: cssColor("--outline-variant"),
          borderWidth: 1,
          padding: 12,
          titleFont: { family: "Rubik", size: 12 },
          bodyFont: { family: "Rubik", size: 12 },
          callbacks: {
            title: (items) => (items.length ? snapshotDateFormat.format(items[0].raw.x) : ""),
            label: (context) => t("chart.tooltip.downloads", { count: formatNumber(context.raw.y) }),
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          grid: { display: false },
          border: { color: cssColor("--outline-variant") },
          ticks: {
            color: cssColor("--on-surface-variant"),
            maxTicksLimit: 8,
            callback: (value) => snapshotDateFormat.format(Number(value)),
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: hexToRgba(cssColor("--outline"), 0.18) },
          ticks: {
            color: cssColor("--on-surface-variant"),
            callback: (value) => compactFormat.format(value),
          },
        },
      },
    },
  });
}

async function renderChart() {
  const token = (state.chartRenderToken += 1);
  const isRanking = state.mode === "releases";
  $(".chart-stage")?.classList.toggle("is-ranking", isRanking);
  const actions = $("#chart-actions");
  if (actions) actions.hidden = !isRanking;
  if (isRanking) {
    await renderReleaseRanking(token);
    return;
  }
  state.rankedRows = [];
  renderRankingSelection();
  renderTimeChart();
}

/* ---------- Releases list ---------- */

function setReleaseListFilters({ type = "all", os = "all", variant = "all", channel = "all", search = "" } = {}) {
  Object.assign(state, {
    releaseType: type,
    releaseOS: os,
    releaseVariant: variant,
    releaseChannel: channel,
    releaseSearch: search,
    releaseLimit: 8,
  });
  setButtonState($$("[data-type]"), type, "type");
  setButtonState($$("[data-os]"), os, "os");
  setButtonState($$("[data-variant]"), variant, "variant");
  setButtonState($$("[data-channel]"), channel, "channel");
  const input = $("#release-search");
  if (input) input.value = search;
}

function releaseAssetFiltersActive() {
  return state.releaseOS !== "all" || state.releaseVariant !== "all";
}

function releaseTextMatches(release, query, collation) {
  return !query || `${release.name} ${release.tag}`.toLocaleLowerCase(collation).includes(query);
}

function matchingReleaseAssets(release, query, collation) {
  const category = state.rankedReleaseList?.category;
  const applyAssetFilters = releaseAssetFiltersActive();
  const matchesRelease = releaseTextMatches(release, query, collation);
  const matches = release.assets.filter((asset) => {
    if (asset.category === "auxiliary" || (category && asset.category !== category)) return false;
    if (applyAssetFilters && !isAppBuild(asset) && !(asset.category === "app" && isDownloadAssistant(asset))) return false;
    if (state.releaseOS !== "all" && classifyOS(asset.name) !== state.releaseOS) return false;
    if (state.releaseVariant !== "all" && classifyVariant(asset) !== state.releaseVariant) return false;
    return matchesRelease || asset.name.toLocaleLowerCase(collation).includes(query);
  });
  // Split builds need their accompanying assembly script even though the
  // script itself has no platform or build variant in its filename.
  if (applyAssetFilters && matches.some((asset) => SPLIT_PACKAGE.test(asset.name))) {
    const helpers = release.assets.filter((asset) =>
      asset.category === "app" && /^assemble_split_asset\.(ps1|sh)$/i.test(asset.name) &&
      (state.releaseOS === "all" ||
        (state.releaseOS === "windows" ? /\.ps1$/i : /\.sh$/i).test(asset.name)),
    );
    matches.push(...helpers);
  }
  return matches;
}

function releaseKind(release) {
  if (release.source === "seforim") {
    const hasLibrary = release.assets.some((asset) => asset.category === "library");
    const hasDelta = release.assets.some((asset) => asset.category === "delta");
    if (hasLibrary && hasDelta) return t("releaseKind.libraryAndDelta");
    if (hasLibrary) return t("releaseKind.library");
    if (hasDelta) return t("releaseKind.delta");
    return t("releaseKind.other");
  }
  return channelLabel(classifyChannel(release));
}

function renderReleaseItem(release, visibleAssets) {
  const fragment = $("#release-template").content.cloneNode(true);
  const details = $(".release-item", fragment);
  details.dataset.source = release.source;
  if (state.rankedReleaseList?.single) details.open = true;
  $(".release-source-mark .material-symbols", fragment).textContent = release.source === "seforim" ? "menu_book" : "apps";
  $(".release-title", fragment).textContent = release.name;
  $(".release-subtitle", fragment).textContent = t("release.subtitle", {
    source: sourceLabel(release.source),
    kind: releaseKind(release),
    tag: release.tag,
  });
  $(".release-date", fragment).textContent = release.published_at
    ? dateFormat.format(new Date(release.published_at))
    : t("common.noDate");

  const downloadsCell = $(".release-downloads", fragment);
  downloadsCell.replaceChildren();
  const parts = releaseDownloadParts(release, visibleAssets);
  if (!parts.length) {
    downloadsCell.textContent = "—";
  } else {
    parts.forEach((part) => {
      const row = document.createElement("span");
      row.className = "release-downloads-row";
      const value = document.createElement("span");
      value.className = "release-downloads-value";
      value.textContent = formatNumber(part.value);
      const unit = document.createElement("span");
      unit.className = "release-downloads-unit";
      unit.textContent = part.label;
      row.append(value, unit);
      downloadsCell.append(row);
    });
  }
  downloadsCell.title = parts
    .map((part) => t("release.downloadsTitle", { label: part.label, count: formatNumber(part.value) }))
    .join(" · ");

  const links = $(".release-links", fragment);
  const releaseLink = document.createElement("a");
  releaseLink.href = release.url;
  releaseLink.target = "_blank";
  releaseLink.rel = "noopener noreferrer";
  releaseLink.textContent = t("release.githubPage");
  links.append(releaseLink);

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "link-button";
  copyButton.textContent = t("release.copyLink");
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(release.url);
      showToast(t("toast.linkCopied"));
    } catch (_) {
      showToast(t("toast.linkCopyFailed"));
    }
  });
  links.append(copyButton);

  const assets = $(".asset-list", fragment);
  visibleAssets.forEach((asset) => {
    const row = document.createElement("div");
    row.className = "asset-row";
    const name = document.createElement("span");
    name.className = "asset-name";
    name.textContent = asset.name;
    const meta = document.createElement("span");
    meta.className = "asset-meta";
    meta.textContent = `${formatBytes(asset.size)} · ${formatNumber(asset.downloads)}`;
    const link = document.createElement("a");
    link.href = asset.download_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("release.assetDownload");
    row.append(name, meta, link);
    assets.append(row);
  });

  if (!visibleAssets.length) {
    const empty = document.createElement("p");
    empty.className = "empty-releases";
    empty.textContent = t("release.noAssets");
    assets.append(empty);
  }
  return fragment;
}

function filteredReleases() {
  const collation = I18n.locale("collation");
  const query = state.releaseSearch.trim().toLocaleLowerCase(collation);
  return state.latest.releases.filter((release) => {
    if (state.rankedReleaseList && !state.rankedReleaseList.keys.has(releaseKey(release))) return false;
    const typeMatches =
      state.releaseType === "all" ||
      (state.releaseType === "app"
        ? isAppRelease(release)
        : state.releaseType === "library"
          ? release.source === "seforim"
          : release.source === state.releaseType);
    if (!typeMatches) return false;

    if (state.releaseChannel !== "all" && classifyChannel(release) !== state.releaseChannel) return false;

    if (!releaseAssetFiltersActive() && releaseTextMatches(release, query, collation)) return true;
    return matchingReleaseAssets(release, query, collation).length > 0;
  });
}

function renderReleases() {
  const releases = filteredReleases();
  const visible = releases.slice(0, state.releaseLimit);
  const list = $("#release-list");
  list.replaceChildren();
  list.setAttribute("aria-busy", "false");

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-releases";
    empty.textContent = t("release.noMatches");
    list.append(empty);
  } else {
    const collation = I18n.locale("collation");
    const query = state.releaseSearch.trim().toLocaleLowerCase(collation);
    visible.forEach((release) => list.append(renderReleaseItem(release, matchingReleaseAssets(release, query, collation))));
  }

  const count = $("#release-count");
  count.removeAttribute("data-i18n");
  count.textContent = t("release.count", { count: formatNumber(releases.length) });
  const loadMore = $("#load-more");
  loadMore.removeAttribute("data-i18n");
  loadMore.hidden = releases.length <= state.releaseLimit;
  if (!loadMore.hidden) {
    loadMore.textContent = t("release.loadMore", {
      count: formatNumber(Math.min(8, releases.length - state.releaseLimit)),
    });
  }
}

/* ---------- Controls ---------- */

function bindControls() {
  $$("[data-mode]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (state.mode !== button.dataset.mode) state.selectedRankingRow = null;
      state.mode = button.dataset.mode;
      setButtonState($$("[data-mode]"), state.mode, "mode");
      await refreshStats();
    }),
  );

  $$("[data-source]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (state.source !== button.dataset.source) state.selectedRankingRow = null;
      state.source = button.dataset.source;
      setButtonState($$("[data-source]"), state.source, "source");
      await refreshStats();
    }),
  );

  $$("[data-range]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.range = button.dataset.range;
      setButtonState($$("[data-range]"), state.range, "range");
      await refreshStats();
    }),
  );

  $$("[data-type]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.releaseType = button.dataset.type;
      state.releaseLimit = 8;
      setButtonState($$("[data-type]"), state.releaseType, "type");
      await refreshReleases();
    }),
  );

  $$("[data-os]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.releaseOS = button.dataset.os;
      state.releaseLimit = 8;
      setButtonState($$("[data-os]"), state.releaseOS, "os");
      state.osFocus = state.releaseOS === "all" ? null : state.releaseOS;
      if (state.statsReady) renderOsChart();
      await refreshReleases();
    }),
  );

  $$("[data-variant]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.releaseVariant = button.dataset.variant;
      state.releaseLimit = 8;
      setButtonState($$("[data-variant]"), state.releaseVariant, "variant");
      await refreshReleases();
    }),
  );

  $$("[data-channel]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.releaseChannel = button.dataset.channel;
      state.releaseLimit = 8;
      setButtonState($$("[data-channel]"), state.releaseChannel, "channel");
      await refreshReleases();
    }),
  );

  $("#release-search").addEventListener("input", async (event) => {
    state.releaseSearch = event.target.value;
    state.releaseLimit = 8;
    await refreshReleases();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    $("#release-search")?.focus();
  });

  bindRankingLink();

  $("#load-more").addEventListener("click", async () => {
    await ensureReleasesReady();
    state.releaseLimit += 8;
    if (state.releasesReady) renderReleases();
  });
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, { cache: "no-cache", ...options });
  if (!response.ok) {
    // No caller consumes an error body. Cancel it explicitly instead of
    // leaving a potentially unbounded response streaming in the background.
    try { await response.body?.cancel(); } catch { /* Preserve the HTTP error. */ }
    throw new Error(t("error.fetchFailed", { path, status: response.status }));
  }
  return response.json();
}

function loadLatest() {
  if (!state.latestPromise) {
    state.latestPromise = fetchJson("data/latest.json").then((latest) => {
      if (!Array.isArray(latest?.releases)) latest.releases = [];
      latest.releases.forEach((release) => {
        if (!Array.isArray(release.assets)) release.assets = [];
      });
      state.latest = latest;
      return latest;
    }).catch((error) => {
      state.latestPromise = null;
      throw error;
    });
  }
  return state.latestPromise;
}

function loadTimeseries() {
  if (!state.timeseriesPromise) {
    state.timeseriesPromise = fetchJson("data/timeseries.json").then((timeseries) => {
      state.timeseries = timeseries;
      return timeseries;
    }).catch((error) => {
      state.timeseriesPromise = null;
      throw error;
    });
  }
  return state.timeseriesPromise;
}

function loadChartLibrary() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!state.chartLibraryPromise) {
    state.chartLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.addEventListener("load", () => resolve(window.Chart), { once: true });
      script.addEventListener("error", () => {
        script.remove();
        reject(new Error(t("error.chartLibrary")));
      }, { once: true });
      document.head.append(script);
    }).catch((error) => {
      state.chartLibraryPromise = null;
      throw error;
    });
  }
  return state.chartLibraryPromise;
}

function updateRecentChange() {
  const last = state.timeseries?.points?.at(-1);
  // The badge sits next to the software headline, so it must count the software
  // family only — not the mixed tracked_downloads total.
  const recentChange = last?.changes?.by_category?.app || 0;
  const deltaWrap = $("#hero-delta");
  deltaWrap.hidden = recentChange <= 0;
  if (recentChange > 0) {
    $("#hero-delta-text").textContent = t("hero.deltaText", { count: formatNumber(recentChange) });
  }
}

async function ensureStatsReady() {
  if (state.statsReady) return;
  const summary = $("#chart-summary");
  summary.textContent = t("chart.loading");
  $("#stats").setAttribute("aria-busy", "true");
  try {
    await Promise.all([loadLatest(), loadTimeseries(), loadChartLibrary()]);
    if (state.statsReady) return;
    state.statsReady = true;
    $("#stats").setAttribute("aria-busy", "false");
    updateRecentChange();
    await renderStats();
  } catch (error) {
    $("#stats").setAttribute("aria-busy", "false");
    summary.textContent = error.message;
  }
}

async function refreshStats() {
  if (!state.statsReady) {
    await ensureStatsReady();
    return;
  }
  await renderStats();
}

async function renderStats() {
  syncRangeChips();
  const range = donutRange();
  // A finite ranking needs snapshots for every family. A timeline only needs
  // them for its app OS breakdown; library/delta timelines use timeseries.
  const needsHistory = range !== "all" && (state.mode === "releases" || osFamily() !== null);
  syncHistorySelection(needsHistory ? historyDatesForRange(range) : []);
  // Start both generations before yielding, so obsolete completions cannot
  // render a stale fallback or start a delayed second-panel refresh.
  await Promise.all([renderChart(), renderOsChart()]);
}

async function ensureReleasesReady() {
  if (state.releasesReady) return;
  try {
    await loadLatest();
    if (state.releasesReady) return;
    state.releasesReady = true;
    renderReleases();
  } catch (error) {
    $("#release-count").textContent = error.message;
    $("#release-list").setAttribute("aria-busy", "false");
  }
}

async function refreshReleases() {
  if (!state.releasesReady) {
    await ensureReleasesReady();
    return;
  }
  renderReleases();
}

function lazyLoadSection(element, loader) {
  if (!("IntersectionObserver" in window)) {
    loader();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loader();
    },
    { rootMargin: "700px 0px" },
  );
  observer.observe(element);
}

function initLazyContent() {
  lazyLoadSection($("#stats"), ensureStatsReady);
  lazyLoadSection($("#releases"), ensureReleasesReady);
}

async function init() {
  bindLanguageControls();
  bindThemeControls();
  bindControls();
  bindScrollSpy();
  try {
    state.overview = await fetchJson("data/overview.json");
    if (state.overview.featured_release && !Array.isArray(state.overview.featured_release.assets)) {
      state.overview.featured_release.assets = [];
    }
    renderMetrics();
    renderDownloadGrid();
    initLazyContent();
  } catch (error) {
    const message = document.createElement("div");
    message.className = "error-state";
    const title = document.createElement("strong");
    const detail = document.createElement("p");
    if (window.location.protocol === "file:") {
      // The static copy carries its own keys so the panel follows a later
      // language switch just like the rest of the page.
      title.dataset.i18n = "error.fileProtocol.title";
      title.textContent = t("error.fileProtocol.title");
      detail.dataset.i18n = "error.fileProtocol.detail";
      detail.textContent = t("error.fileProtocol.detail");
    } else {
      title.dataset.i18n = "error.load.title";
      title.textContent = t("error.load.title");
      detail.textContent = error.message;
    }
    message.append(title, detail);
    $("#main-content").prepend(message);
    $("#chart-summary").textContent = t("error.unavailable");
    $("#download-grid").setAttribute("aria-busy", "false");
  }
}

document.addEventListener("DOMContentLoaded", init);
