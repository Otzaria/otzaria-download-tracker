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

const themeStorageKey = "otzaria-download-tracker-theme";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function currentPalette() {
  return {
    all: cssColor("--chart-all"),
    otzaria: cssColor("--chart-otzaria"),
    sivan22: cssColor("--chart-sivan"),
    library: cssColor("--chart-library"),
    delta: cssColor("--chart-delta"),
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

const labels = {
  all: "כל המקורות",
  otzaria: "Otzaria",
  sivan22: "sivan22",
  library: "הספרייה המלאה",
  delta: "עדכוני דלתא",
};

const state = {
  latest: null,
  timeseries: null,
  chart: null,
  mode: "releases",
  source: "all",
  range: "all",
  releaseSource: "all",
  releaseSearch: "",
  releaseLimit: 8,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

function trackedAssets(release, category = null) {
  return release.assets.filter((asset) => {
    const tracked = ["app", "library", "delta"].includes(asset.category);
    return tracked && (!category || asset.category === category);
  });
}

function releaseDownloads(release, category = null) {
  return trackedAssets(release, category).reduce((sum, asset) => sum + asset.downloads, 0);
}

function valueFor(point, source, section) {
  const group = point[section];
  if (!group) return null;
  if (source === "all") return group.tracked_downloads;
  if (source === "otzaria" || source === "sivan22") return group.by_source[source];
  return group.by_category[source];
}

function setButtonState(buttons, activeValue, attribute) {
  buttons.forEach((button) => {
    const active = button.dataset[attribute] === activeValue;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function applyTheme(choice, persist = true) {
  const safeChoice = ["light", "dark", "system"].includes(choice) ? choice : "system";
  const resolved = safeChoice === "system" ? (themeMedia.matches ? "dark" : "light") : safeChoice;
  document.documentElement.dataset.themeChoice = safeChoice;
  document.documentElement.dataset.theme = resolved;
  $("#theme-color")?.setAttribute("content", resolved === "dark" ? "#2e282d" : "#f3e6da");

  if (persist) {
    try {
      window.localStorage.setItem(themeStorageKey, safeChoice);
    } catch (_) {
      // The selected theme still works for this page view when storage is blocked.
    }
  }

  $$('[data-theme-choice]').forEach((button) => {
    const active = button.dataset.themeChoice === safeChoice;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  palette = currentPalette();
  if (state.latest) {
    renderBreakdown();
    renderChart();
  }
}

function bindThemeControls() {
  const initial = document.documentElement.dataset.themeChoice || "system";
  applyTheme(initial, false);
  $$('[data-theme-choice]').forEach((button) => {
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

function renderMetrics() {
  const summary = state.latest.summary;
  $("#hero-total").textContent = formatNumber(summary.tracked_downloads);
  $("#hero-total").classList.remove("loading-value");
  $("#updated-at").textContent = dateTimeFormat.format(new Date(state.latest.collected_at));
  $("#updated-at").dateTime = state.latest.collected_at;
  $("#metric-otzaria").textContent = compactFormat.format(summary.by_source.otzaria);
  $("#metric-sivan").textContent = compactFormat.format(summary.by_source.sivan22);
  $("#metric-library").textContent = compactFormat.format(summary.by_category.library);
  $("#metric-delta").textContent = compactFormat.format(summary.by_category.delta);
}

function renderBreakdown() {
  const summary = state.latest.summary;
  const rows = [
    ["Otzaria", summary.by_source.otzaria, palette.otzaria],
    ["sivan22", summary.by_source.sivan22, palette.sivan22],
    ["ספרייה מלאה", summary.by_category.library, palette.library],
    ["עדכוני דלתא", summary.by_category.delta, palette.delta],
  ];
  const max = Math.max(...rows.map((row) => row[1]), 1);
  const container = $("#breakdown-bars");
  container.replaceChildren();
  $("#breakdown-total").textContent = `${formatNumber(summary.tracked_downloads)} הורדות בסך הכול`;

  rows.forEach(([label, value, color]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";

    const labelElement = document.createElement("span");
    labelElement.className = "breakdown-label";
    labelElement.textContent = label;

    const track = document.createElement("div");
    track.className = "breakdown-track";
    track.setAttribute("aria-label", `${label}: ${formatNumber(value)} הורדות`);
    const bar = document.createElement("span");
    bar.style.width = `${Math.max(1, (value / max) * 100)}%`;
    bar.style.backgroundColor = color;
    track.append(bar);

    const valueElement = document.createElement("span");
    valueElement.className = "breakdown-value";
    valueElement.textContent = compactFormat.format(value);
    row.append(labelElement, track, valueElement);
    container.append(row);
  });
}

function releaseDatasets() {
  const configurations = [
    { key: "otzaria", source: "otzaria", category: "app" },
    { key: "sivan22", source: "sivan22", category: "app" },
    { key: "library", source: "seforim", category: "library" },
    { key: "delta", source: "seforim", category: "delta" },
  ];

  return configurations
    .filter((config) => state.source === "all" || state.source === config.key)
    .map((config) => ({
      label: labels[config.key],
      data: state.latest.releases
        .filter((release) => release.source === config.source)
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
  return [{
    label: labels[state.source],
    data,
    borderColor: palette[state.source],
    backgroundColor: hexToRgba(palette[state.source], 0.10),
    pointBackgroundColor: cssColor("--card-background"),
    pointBorderColor: palette[state.source],
    pointBorderWidth: 2,
    pointRadius: data.length > 45 ? 0 : 4,
    pointHoverRadius: 6,
    borderWidth: 2.5,
    fill: true,
    tension: 0.22,
    spanGaps: false,
  }];
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
  const hasDailyData = state.mode !== "daily" || datasets.some((dataset) => dataset.data.some((point) => point.y !== null));
  empty.hidden = hasDailyData;
  canvas.hidden = !hasDailyData;

  $("#chart-summary").textContent = chartSummary(datasets);
  $("#chart-note").textContent = isReleaseMode
    ? "כל נקודה מייצגת גרסה בתאריך הפרסום שלה; גובה הנקודה הוא מונה ההורדות הנוכחי של קובצי הגרסה. המרווח האופקי משקף זמן אמיתי."
    : state.mode === "daily"
      ? "הערך היומי הוא ההפרש החיובי בין שני Snapshots עוקבים. ביום הראשון אין עדיין הפרש להצגה."
      : "המונה המצטבר הוא תמונת המצב שנשמרה בכל יום. מחיקת Release עלולה להקטין מונה נוכחי, אך אינה הופכת להורדות שליליות.";

  if (!hasDailyData) return;

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
          titleFont: { family: "system-ui", size: 12 },
          bodyFont: { family: "system-ui", size: 12 },
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

function sourceLabel(source) {
  if (source === "otzaria") return "Otzaria";
  if (source === "sivan22") return "sivan22";
  return "SeforimLibrary";
}

function renderReleaseItem(release) {
  const fragment = $("#release-template").content.cloneNode(true);
  const details = $(".release-item", fragment);
  details.dataset.source = release.source;
  $(".release-title", fragment).textContent = release.name;
  $(".release-subtitle", fragment).textContent = `${sourceLabel(release.source)} · ${release.prerelease ? "גרסת תצוגה מקדימה" : "גרסה רגילה"} · ${release.tag}`;
  $(".release-date", fragment).textContent = release.published_at ? dateFormat.format(new Date(release.published_at)) : "ללא תאריך";
  $(".release-downloads", fragment).textContent = formatNumber(release.downloads);

  const links = $(".release-links", fragment);
  const releaseLink = document.createElement("a");
  releaseLink.href = release.url;
  releaseLink.target = "_blank";
  releaseLink.rel = "noopener noreferrer";
  releaseLink.textContent = "עמוד הגרסה ב־GitHub ↗";
  links.append(releaseLink);

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
    const sourceMatches = state.releaseSource === "all" || release.source === state.releaseSource;
    if (!sourceMatches) return false;
    if (!query) return true;
    const haystack = [release.name, release.tag, ...release.assets.map((asset) => asset.name)].join(" ").toLocaleLowerCase("he");
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
    empty.textContent = "לא נמצאו גרסאות המתאימות לחיפוש.";
    list.append(empty);
  } else {
    visible.forEach((release) => list.append(renderReleaseItem(release)));
  }

  $("#release-count").textContent = `${formatNumber(releases.length)} גרסאות נמצאו`;
  const loadMore = $("#load-more");
  loadMore.hidden = releases.length <= state.releaseLimit;
  if (!loadMore.hidden) loadMore.textContent = `הצג עוד ${formatNumber(Math.min(8, releases.length - state.releaseLimit))} גרסאות`;
}

function bindControls() {
  $$('[data-mode]').forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    setButtonState($$('[data-mode]'), state.mode, "mode");
    renderChart();
  }));

  $$('[data-source]').forEach((button) => button.addEventListener("click", () => {
    state.source = button.dataset.source;
    setButtonState($$('[data-source]'), state.source, "source");
    renderChart();
  }));

  $$('[data-range]').forEach((button) => button.addEventListener("click", () => {
    state.range = button.dataset.range;
    setButtonState($$('[data-range]'), state.range, "range");
    renderChart();
  }));

  $("#release-search").addEventListener("input", (event) => {
    state.releaseSearch = event.target.value;
    state.releaseLimit = 8;
    renderReleases();
  });

  $("#release-source").addEventListener("change", (event) => {
    state.releaseSource = event.target.value;
    state.releaseLimit = 8;
    renderReleases();
  });

  $("#load-more").addEventListener("click", () => {
    state.releaseLimit += 8;
    renderReleases();
  });
}

async function loadData() {
  const [latestResponse, timeseriesResponse] = await Promise.all([
    fetch("data/latest.json", { cache: "no-store" }),
    fetch("data/timeseries.json", { cache: "no-store" }),
  ]);
  if (!latestResponse.ok || !timeseriesResponse.ok) {
    throw new Error("קובצי הנתונים עדיין לא נוצרו. יש להריץ את פעולת האיסוף הראשונה.");
  }
  return Promise.all([latestResponse.json(), timeseriesResponse.json()]);
}

async function init() {
  bindThemeControls();
  bindControls();
  try {
    [state.latest, state.timeseries] = await loadData();
    renderMetrics();
    renderBreakdown();
    renderChart();
    renderReleases();
  } catch (error) {
    const message = document.createElement("div");
    message.className = "error-state";
    const title = document.createElement("strong");
    title.textContent = "לא הצלחנו לטעון את הנתונים";
    const detail = document.createElement("p");
    detail.textContent = error.message;
    message.append(title, detail);
    $("#main-content").prepend(message);
    $("#chart-summary").textContent = "הנתונים אינם זמינים";
  }
}

document.addEventListener("DOMContentLoaded", init);
