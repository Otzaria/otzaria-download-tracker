"use strict";

const numberFormat = new Intl.NumberFormat("he-IL");
const compactFormat = new Intl.NumberFormat("he-IL", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const relativeTimeFormat = new Intl.RelativeTimeFormat("he", { numeric: "auto" });

const themeStorageKey = "otzaria-download-tracker-theme";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorByMode = { light: "#f3e6da", dark: "#2c2731" };

const PLATFORMS = [
  { id: "windows", label: "Windows", icon: "desktop_windows" },
  { id: "macos", label: "macOS", icon: "laptop_mac" },
  { id: "android", label: "Android", icon: "phone_android" },
  { id: "linux", label: "Linux", icon: "computer" },
  { id: "ios", label: "iOS", icon: "phone_iphone" },
];

const labels = {
  all: "כל המקורות",
  sivan22: "Sivan22/otzaria",
  otzaria: "Otzaria/otzaria",
  library: "ספרייה מלאה",
  delta: "עדכוני דלתא",
};

const sourceLabels = {
  sivan22: "המאגר המקורי · Sivan22",
  otzaria: "המאגר הנוכחי · Otzaria",
  seforim: "ספריית הספרים",
};

const osLabels = {
  windows: "Windows",
  macos: "macOS",
  android: "Android",
  linux: "Linux",
  ios: "iOS",
  other: "אחר / קבצים ישנים",
};

const variantLabels = {
  mobile: "נייד",
  regular: "רגילה",
  full: "מלאה",
};

const channelLabels = {
  stable: "גרסה יציבה",
  dev: "גרסת פיתוח",
  pr: "בדיקת PR",
  early: "גרסה מוקדמת",
};

const state = {
  overview: null,
  latest: null,
  timeseries: null,
  chart: null,
  osChart: null,
  mode: "releases",
  source: "all",
  range: "all",
  releaseType: "all",
  releaseOS: "all",
  releaseVariant: "all",
  releaseChannel: "all",
  releaseSearch: "",
  releaseLimit: 8,
  latestPromise: null,
  timeseriesPromise: null,
  chartLibraryPromise: null,
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
    all: cssColor("--chart-all"),
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

function platformAssetPriority(asset) {
  const variant = classifyVariant(asset);
  if (variant === "regular" || variant === "mobile") return 0;
  if (variant === "full") return 1;
  return 2;
}

function sortPlatformAssets(left, right) {
  return platformAssetPriority(left) - platformAssetPriority(right) || right.downloads - left.downloads;
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

function valueFor(point, source, section) {
  const group = point[section];
  if (!group) return null;
  if (source === "all") return group.tracked_downloads;
  if (source === "sivan22" || source === "otzaria") return group.by_source[source];
  return group.by_category[source];
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
    renderChart();
    renderOsChart();
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

function bindScrollSpy() {
  const navLinks = $$("#main-nav a");
  const sections = ["about", "download", "stats", "releases", "method"]
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
  $("#hero-total").textContent = formatNumber(summary.tracked_downloads);
  $("#hero-total").classList.remove("loading-value");

  const deltaWrap = $("#hero-delta");
  deltaWrap.hidden = true;

  const updatedDate = new Date(state.overview.collected_at);
  const updatedElement = $("#updated-at");
  updatedElement.dateTime = state.overview.collected_at;
  updatedElement.title = dateTimeFormat.format(updatedDate);
  updatedElement.textContent = relativeTime(updatedDate);

  $("#metric-sivan22").textContent = compactFormat.format(summary.by_source.sivan22);
  $("#metric-otzaria").textContent = compactFormat.format(summary.by_source.otzaria);
  $("#metric-library").textContent = compactFormat.format(summary.by_category.library);
  $("#metric-delta").textContent = compactFormat.format(summary.by_category.delta);
  $("#metric-releases").textContent = formatNumber(summary.release_count);
}

/* ---------- Download section ---------- */

function pickCurrentRelease() {
  const release = state.overview?.featured_release;
  if (!release || release.prerelease || classifyChannel(release) !== "stable") return null;
  return release;
}

function buildPlatformCard(platform, current, detected) {
  const card = document.createElement("article");
  card.className = "platform-card";
  if (platform.id === detected) card.classList.add("is-recommended");

  const icon = document.createElement("span");
  icon.className = "platform-icon";
  icon.innerHTML = `<span class="material-symbols" aria-hidden="true">${platform.icon}</span>`;
  card.append(icon);

  if (platform.id === detected) {
    const tag = document.createElement("span");
    tag.className = "recommended-tag";
    tag.textContent = "מומלץ עבורכם";
    card.append(tag);
  }

  const heading = document.createElement("h3");
  heading.textContent = platform.label;
  card.append(heading);

  const meta = document.createElement("p");
  meta.className = "platform-meta";
  card.append(meta);

  const variants = current.assets
    .filter((asset) => asset.category === "app" && classifyOS(asset.name) === platform.id)
    .sort(sortPlatformAssets);

  if (!variants.length) {
    card.classList.add("is-unavailable");
    meta.textContent = `לא פורסם קובץ עבור ${platform.label} בגרסה היציבה הנוכחית.`;
    const link = document.createElement("a");
    link.className = "btn btn-outlined";
    link.href = "#releases";
    link.textContent = "חיפוש בגרסאות קודמות";
    card.append(link);
    return card;
  }

  const primary = variants[0];
  meta.textContent = `${variantLabels[classifyVariant(primary)]} · ${formatBytes(primary.size)} · ${formatNumber(primary.downloads)} הורדות לקובץ זה`;

  const button = document.createElement("a");
  button.className = "btn btn-filled";
  button.href = primary.download_url;
  button.rel = "noopener noreferrer";
  button.innerHTML = 'הורדה <span class="material-symbols" aria-hidden="true">download</span>';
  card.append(button);

  if (variants.length > 1) {
    const details = document.createElement("details");
    details.className = "platform-more";
    const summary = document.createElement("summary");
    summary.textContent = `אפשרויות נוספות (${variants.length - 1})`;
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
      link.textContent = `${variantLabels[classifyVariant(asset)]} · ${formatBytes(asset.size)} ↓`;
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
  container.replaceChildren();
  container.setAttribute("aria-busy", "false");

  if (!current) {
    const empty = document.createElement("p");
    empty.className = "empty-releases";
    empty.textContent = "לא נמצאה גרסה זמינה כרגע.";
    container.append(empty);
    return;
  }

  $("#download-version-line").textContent =
    `גרסה ${current.tag} · פורסמה ${dateFormat.format(new Date(current.published_at))} · ${formatNumber(current.downloads)} הורדות עד כה`;

  const detected = detectPlatform();
  const banner = $("#os-banner");
  const knownPlatform = PLATFORMS.some((platform) => platform.id === detected && detected !== "ios") || detected === "ios";
  if (detected && knownPlatform) {
    banner.hidden = false;
    const label = PLATFORMS.find((platform) => platform.id === detected)?.label || detected;
    $("#os-banner-text").textContent = `זיהינו שאתם משתמשים ב־${label} · ההורדה המומלצת מסומנת למטה`;
  } else {
    banner.hidden = true;
  }

  PLATFORMS.forEach((platform) => container.append(buildPlatformCard(platform, current, detected)));
}

/* ---------- OS breakdown chart ---------- */

function osTotals() {
  const totals = { windows: 0, macos: 0, android: 0, linux: 0, ios: 0, other: 0 };
  state.latest.releases.forEach((release) => {
    if (!isAppRelease(release)) return;
    release.assets.forEach((asset) => {
      if (asset.category !== "app") return;
      const os = classifyOS(asset.name);
      totals[os] = (totals[os] || 0) + asset.downloads;
    });
  });
  return totals;
}

function renderOsChart() {
  const totals = osTotals();
  const entries = Object.entries(totals)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;

  if (state.osChart) state.osChart.destroy();
  const canvas = $("#os-chart");
  state.osChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: entries.map(([key]) => osLabels[key]),
      datasets: [
        {
          data: entries.map(([, value]) => value),
          backgroundColor: entries.map(([key]) => palette[key] || palette.other),
          borderColor: cssColor("--card-background"),
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          textDirection: "rtl",
          backgroundColor: cssColor("--surface-container-highest"),
          titleColor: cssColor("--on-surface"),
          bodyColor: cssColor("--on-surface"),
          borderColor: cssColor("--outline-variant"),
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (context) => ` ${formatNumber(context.raw)} הורדות`,
          },
        },
      },
    },
  });

  const legend = $("#os-legend");
  legend.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-releases";
    empty.textContent = "אין עדיין נתונים לפילוח.";
    legend.append(empty);
    return;
  }
  entries.forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "donut-legend-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = palette[key] || palette.other;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = osLabels[key];
    const valueElement = document.createElement("span");
    valueElement.className = "value";
    valueElement.textContent = `${compactFormat.format(value)} · ${Math.round((value / total) * 100)}%`;
    row.append(dot, label, valueElement);
    legend.append(row);
  });
}

/* ---------- Timeline chart ---------- */

function releaseDatasets() {
  const configurations = [
    { key: "sivan22", category: "app", match: (release) => release.source === "sivan22" },
    { key: "otzaria", category: "app", match: (release) => release.source === "otzaria" },
    { key: "library", category: "library", match: (release) => release.source === "seforim" },
    { key: "delta", category: "delta", match: (release) => release.source === "seforim" },
  ];

  return configurations
    .filter((config) => state.source === "all" || state.source === config.key)
    .map((config) => ({
      label: labels[config.key],
      data: state.latest.releases
        .filter(config.match)
        .map((release) => ({
          x: Date.parse(release.published_at),
          y: releaseDownloads(release, config.category),
          name: release.name,
          tag: release.tag,
        }))
        .filter((point) => Number.isFinite(point.x) && point.y > 0)
        .sort((a, b) => a.x - b.x),
      borderColor: palette[config.key],
      backgroundColor: palette[config.key],
      pointRadius: 4,
      pointHoverRadius: 7,
      showLine: false,
    }));
}

function filteredTimePoints() {
  const points = state.timeseries.points || [];
  if (state.range === "all" || !points.length) return points;
  const latestDate = Date.parse(points.at(-1).date);
  const cutoff = latestDate - Number(state.range) * 86400000;
  return points.filter((point) => Date.parse(point.date) >= cutoff);
}

function timeDataset() {
  const section = state.mode === "daily" ? "changes" : "totals";
  const data = filteredTimePoints().map((point) => ({
    x: Date.parse(point.date),
    y: valueFor(point, state.source, section),
  }));
  return [
    {
      label: labels[state.source],
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

function chartSummary(datasets) {
  if (state.mode === "releases") {
    const points = datasets.reduce((sum, dataset) => sum + dataset.data.length, 0);
    return `${formatNumber(points)} נקודות גרסה · ${labels[state.source]}`;
  }
  const points = filteredTimePoints();
  if (state.mode === "daily") {
    const total = points.reduce((sum, point) => sum + (valueFor(point, state.source, "changes") || 0), 0);
    return `${formatNumber(total)} הורדות חדשות שנצפו בטווח`;
  }
  const last = points.at(-1);
  return last ? `${formatNumber(valueFor(last, state.source, "totals"))} הורדות מצטברות` : "אין נתונים בטווח";
}

function renderChart() {
  if (state.chart) state.chart.destroy();
  const canvas = $("#downloads-chart");
  const empty = $("#chart-empty");
  const isReleaseMode = state.mode === "releases";
  const datasets = isReleaseMode ? releaseDatasets() : timeDataset();
  const hasData = state.mode !== "daily" || datasets.some((dataset) => dataset.data.some((point) => point.y !== null));
  empty.hidden = hasData;
  canvas.hidden = !hasData;

  $("#chart-summary").textContent = chartSummary(datasets);
  $("#chart-note").textContent = isReleaseMode
    ? "כל נקודה מייצגת גרסה בתאריך הפרסום שלה; גובה הנקודה הוא מונה ההורדות הנוכחי של קובצי הגרסה."
    : state.mode === "daily"
      ? "הערך היומי הוא ההפרש החיובי בין שני Snapshots עוקבים. ביום הראשון אין עדיין הפרש להצגה."
      : "המונה המצטבר הוא תמונת המצב שנשמרה בכל יום. מחיקת Release עלולה להקטין מונה נוכחי, אך אינה הופכת להורדות שליליות.";

  if (!hasData) return;

  state.chart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500 },
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          textDirection: "rtl",
          backgroundColor: cssColor("--surface-container-highest"),
          titleColor: cssColor("--on-surface"),
          bodyColor: cssColor("--on-surface"),
          borderColor: cssColor("--outline-variant"),
          borderWidth: 1,
          padding: 12,
          titleFont: { family: "Rubik", size: 12 },
          bodyFont: { family: "Rubik", size: 12 },
          callbacks: {
            title(items) {
              if (!items.length) return "";
              const point = items[0].raw;
              return isReleaseMode ? point.name : dateFormat.format(new Date(point.x));
            },
            label(context) {
              const point = context.raw;
              const prefix = isReleaseMode ? context.dataset.label : "הורדות";
              return ` ${prefix}: ${formatNumber(point.y)}`;
            },
            afterLabel(context) {
              return isReleaseMode ? ` תגית: ${context.raw.tag}` : "";
            },
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
            callback: (value) => dateFormat.format(new Date(value)),
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

/* ---------- Releases list ---------- */

function releaseKind(release) {
  if (release.source === "seforim") {
    const hasLibrary = release.assets.some((asset) => asset.category === "library");
    const hasDelta = release.assets.some((asset) => asset.category === "delta");
    if (hasLibrary && hasDelta) return "ספרייה ועדכון דלתא";
    if (hasLibrary) return "ספריית הספרים המלאה";
    if (hasDelta) return "עדכון דלתא";
    return "קובצי ספרייה";
  }
  return channelLabels[classifyChannel(release)];
}

function renderReleaseItem(release) {
  const fragment = $("#release-template").content.cloneNode(true);
  const details = $(".release-item", fragment);
  details.dataset.source = release.source;
  $(".release-source-mark .material-symbols", fragment).textContent = release.source === "seforim" ? "menu_book" : "apps";
  $(".release-title", fragment).textContent = release.name;
  $(".release-subtitle", fragment).textContent = `${sourceLabels[release.source]} · ${releaseKind(release)} · ${release.tag}`;
  $(".release-date", fragment).textContent = release.published_at ? dateFormat.format(new Date(release.published_at)) : "ללא תאריך";
  $(".release-downloads", fragment).textContent = formatNumber(release.downloads);

  const links = $(".release-links", fragment);
  const releaseLink = document.createElement("a");
  releaseLink.href = release.url;
  releaseLink.target = "_blank";
  releaseLink.rel = "noopener noreferrer";
  releaseLink.textContent = "עמוד הגרסה ב־GitHub ↗";
  links.append(releaseLink);

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "link-button";
  copyButton.textContent = "העתקת קישור";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(release.url);
      showToast("הקישור הועתק ללוח");
    } catch (_) {
      showToast("לא ניתן היה להעתיק את הקישור");
    }
  });
  links.append(copyButton);

  const assets = $(".asset-list", fragment);
  const visibleAssets = release.assets.filter((asset) => asset.category !== "auxiliary");
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
    link.textContent = "הורדה ↗";
    row.append(name, meta, link);
    assets.append(row);
  });

  if (!visibleAssets.length) {
    const empty = document.createElement("p");
    empty.className = "empty-releases";
    empty.textContent = "לגרסה זו אין קבצים הנכללים במדדים הראשיים.";
    assets.append(empty);
  }
  return fragment;
}

function filteredReleases() {
  const query = state.releaseSearch.trim().toLocaleLowerCase("he");
  return state.latest.releases.filter((release) => {
    const typeMatches =
      state.releaseType === "all" ||
      (state.releaseType === "library" ? release.source === "seforim" : release.source === state.releaseType);
    if (!typeMatches) return false;

    if (state.releaseOS !== "all") {
      const hasOs = release.assets.some(
        (asset) => asset.category === "app" && classifyOS(asset.name) === state.releaseOS,
      );
      if (!hasOs) return false;
    }

    if (state.releaseVariant !== "all") {
      const hasVariant = release.assets.some(
        (asset) => asset.category === "app" && classifyVariant(asset) === state.releaseVariant,
      );
      if (!hasVariant) return false;
    }

    if (state.releaseChannel !== "all" && classifyChannel(release) !== state.releaseChannel) return false;

    if (!query) return true;
    const haystack = [release.name, release.tag, ...release.assets.map((asset) => asset.name)]
      .join(" ")
      .toLocaleLowerCase("he");
    return haystack.includes(query);
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
    empty.textContent = "לא נמצאו גרסאות המתאימות לסינון.";
    list.append(empty);
  } else {
    visible.forEach((release) => list.append(renderReleaseItem(release)));
  }

  $("#release-count").textContent = `${formatNumber(releases.length)} גרסאות נמצאו`;
  const loadMore = $("#load-more");
  loadMore.hidden = releases.length <= state.releaseLimit;
  if (!loadMore.hidden) loadMore.textContent = `הצג עוד ${formatNumber(Math.min(8, releases.length - state.releaseLimit))} גרסאות`;
}

/* ---------- Controls ---------- */

function bindControls() {
  $$("[data-mode]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.mode = button.dataset.mode;
      setButtonState($$("[data-mode]"), state.mode, "mode");
      await refreshStats();
    }),
  );

  $$("[data-source]").forEach((button) =>
    button.addEventListener("click", async () => {
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

  $("#load-more").addEventListener("click", async () => {
    await ensureReleasesReady();
    state.releaseLimit += 8;
    if (state.releasesReady) renderReleases();
  });
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`טעינת ${path} נכשלה (${response.status})`);
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
    });
  }
  return state.latestPromise;
}

function loadTimeseries() {
  if (!state.timeseriesPromise) {
    state.timeseriesPromise = fetchJson("data/timeseries.json").then((timeseries) => {
      state.timeseries = timeseries;
      return timeseries;
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
      script.addEventListener("error", () => reject(new Error("ספריית התרשימים לא נטענה")), { once: true });
      document.head.append(script);
    });
  }
  return state.chartLibraryPromise;
}

function updateRecentChange() {
  const last = state.timeseries?.points?.at(-1);
  const recentChange = last?.changes?.tracked_downloads || 0;
  const deltaWrap = $("#hero-delta");
  deltaWrap.hidden = recentChange <= 0;
  if (recentChange > 0) {
    $("#hero-delta-text").textContent = `+${formatNumber(recentChange)} מהסריקה היומית האחרונה`;
  }
}

async function ensureStatsReady() {
  if (state.statsReady) return;
  const summary = $("#chart-summary");
  summary.textContent = "טוען תרשימים…";
  try {
    await Promise.all([loadLatest(), loadTimeseries(), loadChartLibrary()]);
    state.statsReady = true;
    $("#stats").setAttribute("aria-busy", "false");
    updateRecentChange();
    renderOsChart();
    renderChart();
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
  renderChart();
}

async function ensureReleasesReady() {
  if (state.releasesReady) return;
  try {
    await loadLatest();
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
      title.textContent = "פתיחה ישירה מהקובץ לא תומכת בטעינת נתונים";
      detail.textContent =
        "הדפדפן חוסם בקשות fetch לקבצים מקומיים (file://) מסיבות אבטחה. כדי לבדוק את האתר במחשב, הריצו שרת מקומי מתוך תיקיית site, למשל: python3 -m http.server ואז פתחו http://localhost:8000. באתר החי, לאחר פרסום ל־GitHub Pages, הטעינה תעבוד כרגיל.";
    } else {
      title.textContent = "לא הצלחנו לטעון את הנתונים";
      detail.textContent = error.message;
    }
    message.append(title, detail);
    $("#main-content").prepend(message);
    $("#chart-summary").textContent = "הנתונים אינם זמינים";
    $("#download-grid").setAttribute("aria-busy", "false");
  }
}

document.addEventListener("DOMContentLoaded", init);
