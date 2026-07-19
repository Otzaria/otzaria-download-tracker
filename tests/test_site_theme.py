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
        self.assertIn('cssColor("--chart-otzaria")', self.app_js)
        self.assertIn('cssColor("--chart-delta")', self.app_js)


if __name__ == "__main__":
    unittest.main()

