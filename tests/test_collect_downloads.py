import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.collect_downloads import (
    SOURCES,
    Source,
    asset_category,
    build_latest,
    build_overview,
    build_snapshot,
    calculate_changes,
    previous_snapshot,
    release_channel,
    update_timeseries,
    write_json,
)


def release(release_id, asset_id, name, downloads, published_at="2026-07-01T12:00:00Z"):
    return {
        "id": release_id,
        "name": f"Release {release_id}",
        "tag_name": f"v{release_id}",
        "published_at": published_at,
        "prerelease": False,
        "draft": False,
        "html_url": f"https://example.test/releases/{release_id}",
        "assets": [
            {
                "id": asset_id,
                "name": name,
                "download_count": downloads,
                "size": 1024,
                "content_type": "application/octet-stream",
                "browser_download_url": f"https://example.test/assets/{asset_id}",
            }
        ],
    }


class AssetCategoryTests(unittest.TestCase):
    def test_application_repositories_are_grouped_as_app(self):
        self.assertEqual(asset_category(SOURCES[0], "otzaria-windows.exe"), "app")

    def test_library_and_delta_are_distinct(self):
        seforim = Source("seforim", "Otzaria/SeforimLibrary", "ספרייה", "library")
        self.assertEqual(asset_category(seforim, "seforim.db.zst"), "library")
        self.assertEqual(asset_category(seforim, "patch-v4-v6.db.zst"), "delta")
        self.assertEqual(asset_category(seforim, "patch-v4-v6.db.zst.manifest.json"), "auxiliary")
        self.assertEqual(asset_category(seforim, "seforim.db.buildstate"), "auxiliary")


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.collected_at = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)

    def raw(self, app_downloads=10, library_downloads=5, delta_downloads=2):
        return {
            "sivan22": [release(1, 101, "app-release.apk", app_downloads)],
            "otzaria": [release(2, 201, "otzaria-windows.exe", app_downloads)],
            "seforim": [
                {
                    **release(3, 301, "seforim.db.zst", library_downloads),
                    "assets": [
                        release(3, 301, "seforim.db.zst", library_downloads)["assets"][0],
                        release(3, 302, "patch-v1-v3.db.zst", delta_downloads)["assets"][0],
                        release(3, 303, "build_provenance.json", 99)["assets"][0],
                    ],
                }
            ],
        }

    def test_auxiliary_assets_are_not_counted_in_headline_totals(self):
        latest = build_latest(self.raw(), self.collected_at)
        self.assertEqual(latest["summary"]["tracked_downloads"], 27)
        self.assertEqual(latest["summary"]["by_category"]["library"], 5)
        self.assertEqual(latest["summary"]["by_category"]["delta"], 2)

    def test_changes_are_asset_id_based_and_never_negative(self):
        previous = build_snapshot(build_latest(self.raw(10, 5, 2), self.collected_at), "2026-07-18")
        current = build_snapshot(build_latest(self.raw(13, 4, 7), self.collected_at), "2026-07-19")
        changes = calculate_changes(current, previous)

        # Two app assets each grew by 3; the library counter fell and is clamped;
        # the delta grew by 5.
        self.assertEqual(changes["tracked_downloads"], 11)
        self.assertEqual(changes["by_category"]["app"], 6)
        self.assertEqual(changes["by_category"]["library"], 0)
        self.assertEqual(changes["by_category"]["delta"], 5)

    def test_first_snapshot_has_no_invented_change(self):
        current = build_snapshot(build_latest(self.raw(), self.collected_at), "2026-07-19")
        self.assertIsNone(calculate_changes(current, None))

    def test_same_day_timeseries_point_is_replaced(self):
        first = build_snapshot(build_latest(self.raw(10), self.collected_at), "2026-07-19")
        second = build_snapshot(build_latest(self.raw(20), self.collected_at), "2026-07-19")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "timeseries.json"
            write_json(path, update_timeseries(path, first, None))
            result = update_timeseries(path, second, None)

        self.assertEqual(len(result["points"]), 1)
        self.assertEqual(result["points"][0]["totals"]["by_source"]["sivan22"], 20)

    def test_previous_snapshot_skips_current_day(self):
        with tempfile.TemporaryDirectory() as directory:
            history = Path(directory)
            write_json(history / "2026-07-17.json", {"date": "2026-07-17"})
            write_json(history / "2026-07-18.json", {"date": "2026-07-18"})
            write_json(history / "2026-07-19.json", {"date": "2026-07-19"})
            result = previous_snapshot(history, "2026-07-19")

        self.assertEqual(result["date"], "2026-07-18")


class SourceConfigurationTests(unittest.TestCase):
    def test_alias_repository_is_not_collected_twice(self):
        repositories = {source.repository.casefold() for source in SOURCES}
        self.assertIn("otzaria/otzaria", repositories)
        self.assertNotIn("y-ploni/otzaria", repositories)


class OverviewTests(unittest.TestCase):
    def test_preview_named_release_is_not_featured_even_when_flag_is_false(self):
        stable = release(2, 201, "otzaria-windows.exe", 20, "2026-06-01T12:00:00Z")
        preview = release(3, 301, "otzaria-windows.exe", 30, "2026-07-01T12:00:00Z")
        preview["name"] = "Otzaria 0.9.95 (Preview from dev)"
        raw = {"sivan22": [], "otzaria": [preview, stable], "seforim": []}
        latest = build_latest(raw, datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc))

        overview = build_overview(latest)

        self.assertEqual(release_channel(latest["releases"][0]), "dev")
        self.assertEqual(overview["featured_release"]["id"], 2)

    def test_overview_keeps_source_totals_but_not_the_full_release_history(self):
        raw = {
            "sivan22": [release(1, 101, "app-release.apk", 10)],
            "otzaria": [release(2, 201, "otzaria-windows.exe", 20)],
            "seforim": [],
        }
        latest = build_latest(raw, datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc))

        overview = build_overview(latest)

        self.assertEqual(overview["summary"]["by_source"]["sivan22"], 10)
        self.assertEqual(overview["summary"]["by_source"]["otzaria"], 20)
        self.assertNotIn("releases", overview)


if __name__ == "__main__":
    unittest.main()
