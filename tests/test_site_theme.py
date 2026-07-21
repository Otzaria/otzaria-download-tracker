import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SiteThemeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = (ROOT / "site" / "styles.css").read_text(encoding="utf-8").lower()
        cls.html = (ROOT / "site" / "index.html").read_text(encoding="utf-8").lower()
        cls.init_js = (ROOT / "site" / "theme-init.js").read_text(encoding="utf-8")
        cls.app_js = (ROOT / "site" / "app.js").read_text(encoding="utf-8")

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


if __name__ == "__main__":
    unittest.main()
