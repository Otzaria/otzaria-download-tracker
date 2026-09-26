import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.collect_downloads import (
    EXTRA_SOURCES,
    SOURCES,
    Source,
    archive_category,
    archive_records,
    asset_category,
    build_archive_daily,
    build_latest,
    build_overview,
    build_snapshot,
    calculate_changes,
    merge_traffic,
    previous_snapshot,
    release_channel,
    update_registry,
    update_timeseries,
    write_json,
    write_registry,
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


class ArchiveTests(unittest.TestCase):
    seforim = SOURCES[2]
    catalog = EXTRA_SOURCES[0]

    def test_only_user_facing_files_are_archived(self):
        self.assertEqual(archive_category(self.seforim, "seforim.db.zst"), "library")
        self.assertEqual(archive_category(self.seforim, "patch-v4-v6.db.zst.manifest.json"), "update_check")
        self.assertIsNone(archive_category(self.seforim, "seforim.db.buildstate.zst"))
        self.assertIsNone(archive_category(self.seforim, "lines_snapshot.db.zst"))
        self.assertEqual(archive_category(self.catalog, "version.txt"), "update_check")
        self.assertEqual(archive_category(self.catalog, "otzar-HB_catalog.db.zst"), "catalog")
        self.assertIsNone(archive_category(self.catalog, "biographies.sha256"))

    def records(self, *assets):
        raw = release(3, assets[0][0], assets[0][1], assets[0][2])
        raw["assets"] = [release(3, *asset)["assets"][0] for asset in assets]
        return archive_records(self.seforim, [raw])

    def test_registry_keeps_removed_files_and_marks_the_day(self):
        first = self.records((301, "seforim.db.zst", 5), (302, "patch-v1-v3.db.zst.manifest.json", 9))
        registry = update_registry({}, first, ["seforim"], "2026-07-18")
        registry = update_registry(registry, self.records((302, "patch-v1-v3.db.zst.manifest.json", 9)), ["seforim"], "2026-07-19")

        removed = registry["assets"]["seforim:301"]
        self.assertEqual(removed["name"], "seforim.db.zst")
        self.assertEqual(removed["first_seen"], "2026-07-18")
        self.assertEqual(removed["removed_on"], "2026-07-19")
        self.assertIsNone(registry["assets"]["seforim:302"]["removed_on"])

    def test_a_source_that_failed_to_fetch_marks_nothing_removed(self):
        registry = update_registry({}, self.records((301, "seforim.db.zst", 5)), ["seforim"], "2026-07-18")
        registry = update_registry(registry, {}, [], "2026-07-19")
        self.assertIsNone(registry["assets"]["seforim:301"]["removed_on"])
        self.assertIsNone(registry["releases"]["seforim:3"]["removed_on"])

    def test_registry_round_trips_through_its_line_format(self):
        registry = update_registry({}, self.records((301, "seforim.db.zst", 5)), ["seforim"], "2026-07-18")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.json"
            write_registry(path, registry)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), registry)

    def test_daily_archive_skips_site_counters_and_records_decreases(self):
        records = self.records((301, "seforim.db.zst", 4), (302, "patch-v1-v3.db.zst.manifest.json", 9))
        daily = build_archive_daily("2026-07-19", "2026-07-19T00:17:00Z", records, {"seforim:301": 5})

        self.assertEqual(daily["assets"], {"seforim:302": 9})
        self.assertEqual(daily["decreases"], {"seforim:301": [5, 4]})

    def test_traffic_days_are_replaced_and_windows_kept_per_date(self):
        existing = {"views": {"2026-07-10": [1, 1], "2026-07-01": [7, 3]}, "referrers": {"2026-07-18": []}}
        fetched = {
            "views": {"views": [{"timestamp": "2026-07-10T00:00:00Z", "count": 9, "uniques": 4}]},
            "clones": {"clones": []},
            "referrers": [{"referrer": "google.com", "count": 3, "uniques": 2}],
            "paths": [],
        }
        merged = merge_traffic(existing, fetched, "Otzaria/otzaria", "2026-07-19")

        self.assertEqual(merged["views"], {"2026-07-01": [7, 3], "2026-07-10": [9, 4]})
        self.assertEqual(merged["referrers"]["2026-07-19"], [["google.com", 3, 2]])
        self.assertIn("2026-07-18", merged["referrers"])


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
