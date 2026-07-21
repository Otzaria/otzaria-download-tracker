"use strict";

(() => {
  const storageKey = "otzaria-download-tracker-theme";
  const allowed = new Set(["light", "dark", "system"]);
  let choice = "system";

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (allowed.has(stored)) choice = stored;
  } catch (_) {
    // Storage can be unavailable in hardened/private browser contexts.
  }

  const systemIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = choice === "system" ? (systemIsDark ? "dark" : "light") : choice;
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelector("#theme-color")?.setAttribute(
    "content",
    resolved === "dark" ? "#2c2731" : "#f3e6da",
  );
})();
