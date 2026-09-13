import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

HEBREW = re.compile(r"[\u0590-\u05ff]")
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr"}
# data-i18n-<attr> markers understood by i18n.js applyStatic().
TRANSLATED_ATTRIBUTES = {"aria-label", "placeholder", "title", "content", "alt"}


class HardcodedHebrewFinder(HTMLParser):
    """Collect Hebrew text and Hebrew attribute values that no translation key
    covers. An element carrying an explicit lang attribute is deliberate
    foreign-language content (the language switch's own captions) and is
    skipped, together with its subtree."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.offenders = []

    def _push(self, tag, attrs):
        self.stack.append((tag, dict(attrs)))

    def handle_starttag(self, tag, attrs):
        self._check_attributes(tag, dict(attrs))
        if tag not in VOID_TAGS:
            self._push(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._check_attributes(tag, dict(attrs))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                return

    def _in_foreign_subtree(self):
        return any("lang" in attributes for _, attributes in self.stack[1:])

    def _check_attributes(self, tag, attributes):
        if "lang" in attributes or self._in_foreign_subtree():
            return
        for name, value in attributes.items():
            if not value or not HEBREW.search(value):
                continue
            if name in TRANSLATED_ATTRIBUTES and f"data-i18n-{name}" in attributes:
                continue
            self.offenders.append(f"<{tag} {name}=\"{value[:40]}\">")

    def handle_data(self, data):
        if not HEBREW.search(data) or not self.stack:
            return
        if self._in_foreign_subtree():
            return
        tag, attributes = self.stack[-1]
        if "data-i18n" not in attributes:
            self.offenders.append(f"<{tag}>{data.strip()[:40]}")


class SiteThemeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = (ROOT / "site" / "styles.css").read_text(encoding="utf-8").lower()
        cls.html = (ROOT / "site" / "index.html").read_text(encoding="utf-8").lower()
        cls.init_js = (ROOT / "site" / "theme-init.js").read_text(encoding="utf-8")
        cls.app_js = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        cls.raw_html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        cls.i18n_js = (ROOT / "site" / "i18n.js").read_text(encoding="utf-8")
        cls.raw_css = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        # LOCALES uses the same he/en keys, so slice the DICTIONARY literal first.
        dictionary = cls.i18n_js.split("const DICTIONARY = {", 1)[1]
        he_block = dictionary.split("\n    he: {", 1)[1].split("\n    en: {", 1)[0]
        en_block = dictionary.split("\n    en: {", 1)[1]
        cls.keys_he = set(re.findall(r'^\s{6}"([\w.]+)":', he_block, re.M))
        cls.keys_en = set(re.findall(r'^\s{6}"([\w.]+)":', en_block, re.M))

    def test_uses_otzaria_default_seed_schemes(self):
        self.assertIn("--seed: #2c1b02", self.css)
        self.assertIn("--primary: #805610", self.css)
        self.assertIn("--seed: #9c27b0", self.css)
        self.assertIn("--primary: #ebb5ed", self.css)

    def test_offers_all_three_theme_modes(self):
        for choice in ("light", "system", "dark"):
            self.assertIn(f'data-theme-choice="{choice}"', self.html)

    def test_system_mode_detects_operating_system_preference(self):
        self.assertIn('matchMedia("(prefers-color-scheme: dark)")', self.init_js)
        self.assertIn("themeMedia.addEventListener", self.app_js)

    def test_theme_choice_is_persisted(self):
        self.assertIn("window.localStorage.setItem(themeStorageKey", self.app_js)
        self.assertIn("window.localStorage.getItem(storageKey)", self.init_js)

    def test_chart_palette_comes_from_theme_tokens(self):
        self.assertIn('cssColor("--chart-sivan22")', self.app_js)
        self.assertIn('cssColor("--chart-otzaria")', self.app_js)
        self.assertIn('cssColor("--chart-delta")', self.app_js)

    def test_repository_sources_stay_separate_in_the_ui(self):
        self.assertIn('data-source="sivan22"', self.html)
        self.assertIn('data-source="otzaria"', self.html)
        self.assertIn('id="metric-sivan22"', self.html)
        self.assertIn('id="metric-otzaria"', self.html)

    def test_heavy_explorer_assets_are_loaded_lazily(self):
        self.assertNotIn('<script defer src="https://cdn.jsdelivr.net/npm/chart.js', self.html)
        self.assertIn('function lazyLoadSection', self.app_js)
        self.assertIn('fetchJson("data/overview.json")', self.app_js)
        self.assertIn('fetchJson("data/latest.json")', self.app_js)

    def test_full_mobile_bundle_is_classified_as_full_first(self):
        full_check = self.app_js.index('name.includes("full")')
        mobile_check = self.app_js.index('os === "android" || os === "ios"')
        self.assertLess(full_check, mobile_check)

    def test_uses_local_otzaria_favicon(self):
        self.assertIn('href="favicon.png"', self.html)
        self.assertTrue((ROOT / "site" / "favicon.png").exists())

    def test_language_is_resolved_before_the_first_paint(self):
        self.assertIn('<script src="i18n.js"></script>', self.raw_html)
        # i18n.js must run in <head>, before the stylesheet and before app.js,
        # exactly like theme-init.js does for the colour scheme.
        self.assertLess(self.raw_html.index('src="i18n.js"'), self.raw_html.index('href="styles.css"'))
        self.assertLess(self.raw_html.index('src="i18n.js"'), self.raw_html.index('src="app.js"'))
        self.assertIn("navigator.languages", self.i18n_js)
        self.assertIn("root.dir = LOCALES[language].dir", self.i18n_js)
        self.assertIn('new URLSearchParams(window.location.search).get("lang")', self.i18n_js)
        self.assertIn("html[data-i18n-pending] body", self.raw_css)

    def test_language_choice_is_offered_and_persisted(self):
        for choice in ("he", "en"):
            self.assertIn(f'data-lang-choice="{choice}"', self.raw_html)
            self.assertIn(f'hreflang="{choice}"', self.raw_html)
        self.assertIn('hreflang="x-default"', self.raw_html)
        self.assertIn("window.localStorage.setItem(STORAGE_KEY", self.i18n_js)
        self.assertIn("window.localStorage.getItem(STORAGE_KEY)", self.i18n_js)
        # The manual choice must win over detection, the way the theme does.
        self.assertIn("fromQuery() || fromStorage() || fromNavigator()", self.i18n_js)
        self.assertIn('[data-lang-choice]', self.app_js)

    def test_every_displayed_string_has_a_translation_key(self):
        finder = HardcodedHebrewFinder()
        finder.feed(self.raw_html)
        self.assertEqual([], finder.offenders, "Hebrew in index.html without a data-i18n key")
        # app.js renders text but never owns it: the dictionary does.
        self.assertIsNone(HEBREW.search(self.app_js), "Hebrew literal left in app.js")

    def test_dictionary_covers_both_languages(self):
        self.assertTrue(self.keys_he)
        self.assertEqual(self.keys_he, self.keys_en, "he/en dictionaries are out of sync")
        used = set(re.findall(r'data-i18n(?:-[a-z-]+)?="([\w.]+)"', self.raw_html))
        used |= set(re.findall(r'(?<![\w.])t\("([\w.]+)"', self.app_js))
        used |= set(re.findall(r'\.i18n = "([\w.]+)"', self.app_js))
        self.assertTrue(used)
        self.assertEqual(set(), used - self.keys_he, "keys used by the page are missing from the dictionary")

    def test_variable_strings_use_placeholders_instead_of_concatenation(self):
        for key in ("release.count", "download.versionLine", "ranking.summary.lead"):
            for keys, block in ((self.keys_he, "he"), (self.keys_en, "en")):
                self.assertIn(key, keys, f"{key} missing from {block}")
        self.assertIn('t("release.count", { count: formatNumber(releases.length) })', self.app_js)
        self.assertIn("{count}", self.i18n_js)

    def test_charts_follow_the_document_direction(self):
        # The ranking grew out of an RTL-only layout; both axes and every
        # tooltip must now flip with the language.
        self.assertIn("reverse: isRTL()", self.app_js)
        self.assertIn('position: isRTL() ? "right" : "left"', self.app_js)
        self.assertIn("rtl: isRTL()", self.app_js)
        self.assertIn("textDirection: I18n.dir", self.app_js)
        self.assertNotIn('textDirection: "rtl"', self.app_js)
        self.assertNotIn("rtl: true", self.app_js)
        self.assertIn("layout: { padding: isRTL()", self.app_js)

    def test_number_and_date_formats_follow_the_language(self):
        self.assertNotIn('"he-IL"', self.app_js)
        self.assertIn('I18n.locale("number")', self.app_js)
        self.assertIn('I18n.locale("date")', self.app_js)
        self.assertIn('I18n.locale("relative")', self.app_js)
        self.assertIn("buildFormatters()", self.app_js)

    def test_layout_uses_logical_properties(self):
        for physical in ("margin-left", "margin-right", "padding-left", "padding-right",
                         "text-align: left", "text-align: right"):
            self.assertNotIn(physical, self.css, f"{physical} hard-codes a direction")

    def test_language_switch_rerenders_in_place(self):
        self.assertIn("I18n.onChange(", self.app_js)
        self.assertIn("async function applyLanguageToUI()", self.app_js)
        for renderer in ("renderMetrics()", "renderDownloadGrid()", "renderChart()", "renderOsChart()", "renderReleases()"):
            self.assertIn(renderer, self.app_js)
        self.assertNotIn("location.reload", self.app_js)


if __name__ == "__main__":
    unittest.main()
