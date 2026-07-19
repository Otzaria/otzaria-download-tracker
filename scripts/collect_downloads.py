#!/usr/bin/env python3
"""Collect GitHub release download counters and maintain a real time series.

GitHub exposes a current cumulative counter per release asset. This collector
stores one compact snapshot per UTC day and calculates positive differences
between consecutive days. It deliberately treats Y-PLONI/otzaria as an alias,
not as a separate source, because GitHub redirects it to Otzaria/otzaria.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


API_ROOT = "https://api.github.com"
SCHEMA_VERSION = 1
TRACKED_CATEGORIES = ("app", "library", "delta")


@dataclass(frozen=True)
class Source:
    id: str
    repository: str
    label_he: str
    kind: str


SOURCES = (
    Source("sivan22", "Sivan22/otzaria", "גרסאות sivan22", "app"),
    Source("otzaria", "Otzaria/otzaria", "גרסאות Otzaria", "app"),
    Source("seforim", "Otzaria/SeforimLibrary", "ספריית הספרים", "library"),
)


def utc_now() -> datetime:
    forced = os.getenv("COLLECTED_AT")
    if forced:
        return datetime.fromisoformat(forced.replace("Z", "+00:00")).astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def asset_category(source: Source, filename: str) -> str:
    """Return the UI/aggregation category for a release asset."""
    if source.kind == "app":
        return "app"

    normalized = filename.casefold()
    if normalized == "seforim.db.zst":
        return "library"
    if re.fullmatch(r"patch-.+\.db\.zst", normalized):
        return "delta"
    return "auxiliary"


def github_headers(token: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "otzaria-download-tracker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_json(url: str, token: str | None = None, attempts: int = 3) -> Any:
    """Fetch JSON with short retries for transient GitHub/API failures."""
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=github_headers(token))
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            retryable = error.code in {429, 500, 502, 503, 504}
            if not retryable or attempt == attempts:
                detail = error.read().decode("utf-8", errors="replace")[:400]
                raise RuntimeError(f"GitHub API returned {error.code} for {url}: {detail}") from error
            retry_after = error.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else 2 ** (attempt - 1)
            time.sleep(min(delay, 10))
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == attempts:
                raise RuntimeError(f"Could not reach GitHub API for {url}: {error}") from error
            time.sleep(2 ** (attempt - 1))
    raise AssertionError("unreachable")


def fetch_all_releases(source: Source, token: str | None = None) -> list[dict[str, Any]]:
    releases: list[dict[str, Any]] = []
    page = 1
    while True:
        url = f"{API_ROOT}/repos/{source.repository}/releases?per_page=100&page={page}"
        payload = fetch_json(url, token)
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected releases response for {source.repository}")
        releases.extend(payload)
        if len(payload) < 100:
            return releases
        page += 1


def safe_number(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def compact_release(source: Source, release: dict[str, Any]) -> dict[str, Any]:
    assets = []
    for asset in release.get("assets") or []:
        filename = str(asset.get("name") or "")
        assets.append(
            {
                "id": safe_number(asset.get("id")),
                "name": filename,
                "category": asset_category(source, filename),
                "downloads": safe_number(asset.get("download_count")),
                "size": safe_number(asset.get("size")),
                "content_type": str(asset.get("content_type") or ""),
                "download_url": str(asset.get("browser_download_url") or ""),
            }
        )

    assets.sort(key=lambda item: (-item["downloads"], item["name"].casefold()))
    return {
        "id": safe_number(release.get("id")),
        "source": source.id,
        "tag": str(release.get("tag_name") or ""),
        "name": str(release.get("name") or release.get("tag_name") or "ללא שם"),
        "published_at": release.get("published_at") or release.get("created_at"),
        "prerelease": bool(release.get("prerelease")),
        "url": str(release.get("html_url") or ""),
        "assets": assets,
        "downloads": sum(asset["downloads"] for asset in assets if asset["category"] in TRACKED_CATEGORIES),
    }


def build_latest(raw_releases: dict[str, list[dict[str, Any]]], collected_at: datetime) -> dict[str, Any]:
    releases = []
    source_metadata = []
    for source in SOURCES:
        compacted = [
            compact_release(source, release)
            for release in raw_releases[source.id]
            if not release.get("draft")
        ]
        compacted.sort(key=lambda item: item.get("published_at") or "", reverse=True)
        releases.extend(compacted)
        source_metadata.append(
            {
                "id": source.id,
                "repository": source.repository,
                "label_he": source.label_he,
                "url": f"https://github.com/{source.repository}/releases",
                "release_count": len(compacted),
            }
        )

    releases.sort(key=lambda item: item.get("published_at") or "", reverse=True)
    totals = calculate_totals(releases)
    return {
        "schema_version": SCHEMA_VERSION,
        "collected_at": collected_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "notice_he": "Y-PLONI/otzaria הועבר אל Otzaria/otzaria ואינו נספר כמקור נפרד.",
        "sources": source_metadata,
        "summary": totals,
        "releases": releases,
    }


def calculate_totals(releases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    by_source = {source.id: 0 for source in SOURCES}
    by_category = {category: 0 for category in TRACKED_CATEGORIES}
    asset_count = 0
    for release in releases:
        for asset in release.get("assets") or []:
            category = asset.get("category")
            if category not in TRACKED_CATEGORIES:
                continue
            count = safe_number(asset.get("downloads"))
            by_source[release["source"]] += count
            by_category[category] += count
            asset_count += 1
    return {
        "tracked_downloads": sum(by_category.values()),
        "by_source": by_source,
        "by_category": by_category,
        "release_count": sum(1 for _ in releases),
        "asset_count": asset_count,
    }


def build_snapshot(latest: dict[str, Any], date: str) -> dict[str, Any]:
    # Compact tuple layout: [download_count, category]. The source is encoded in
    # the key. Daily snapshots are retained indefinitely, so avoiding repeated
    # names/URLs keeps long-term repository growth modest.
    assets: dict[str, list[Any]] = {}
    for release in latest["releases"]:
        for asset in release["assets"]:
            if asset["category"] not in TRACKED_CATEGORIES:
                continue
            key = f"{release['source']}:{asset['id']}"
            assets[key] = [asset["downloads"], asset["category"]]
    return {
        "schema_version": SCHEMA_VERSION,
        "date": date,
        "collected_at": latest["collected_at"],
        "totals": latest["summary"],
        "assets": assets,
    }


def previous_snapshot(history_dir: Path, current_date: str) -> dict[str, Any] | None:
    candidates = sorted(path for path in history_dir.glob("????-??-??.json") if path.stem < current_date)
    if not candidates:
        return None
    return read_json(candidates[-1])


def calculate_changes(
    current: dict[str, Any], previous: dict[str, Any] | None
) -> dict[str, Any] | None:
    if previous is None:
        return None

    by_source = {source.id: 0 for source in SOURCES}
    by_category = {category: 0 for category in TRACKED_CATEGORIES}
    previous_assets = previous.get("assets") or {}

    for key, asset in current["assets"].items():
        previous_asset = previous_assets.get(key)
        before = safe_number(previous_asset[0]) if isinstance(previous_asset, list) else 0
        downloads = safe_number(asset[0])
        category = asset[1]
        source = key.split(":", 1)[0]
        increase = max(0, downloads - before)
        by_source[source] += increase
        by_category[category] += increase

    return {
        "tracked_downloads": sum(by_category.values()),
        "by_source": by_source,
        "by_category": by_category,
    }


def update_timeseries(
    path: Path, snapshot: dict[str, Any], changes: dict[str, Any] | None
) -> dict[str, Any]:
    existing = read_json(path) if path.exists() else {"schema_version": SCHEMA_VERSION, "points": []}
    points = [point for point in existing.get("points", []) if point.get("date") != snapshot["date"]]
    points.append(
        {
            "date": snapshot["date"],
            "collected_at": snapshot["collected_at"],
            "totals": {
                "tracked_downloads": snapshot["totals"]["tracked_downloads"],
                "by_source": snapshot["totals"]["by_source"],
                "by_category": snapshot["totals"]["by_category"],
            },
            "changes": changes,
        }
    )
    points.sort(key=lambda point: point["date"])
    return {"schema_version": SCHEMA_VERSION, "points": points}


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        if compact:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
        else:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.write("\n")
    temporary.replace(path)


def format_number(value: int) -> str:
    return f"{value:,}"


def update_readme(path: Path, latest: dict[str, Any], timeseries: dict[str, Any]) -> None:
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    start_marker = "<!-- stats:start -->"
    end_marker = "<!-- stats:end -->"
    if start_marker not in text or end_marker not in text:
        return

    summary = latest["summary"]
    points = timeseries.get("points") or []
    observed = sum(
        safe_number((point.get("changes") or {}).get("tracked_downloads"))
        for point in points
    )
    collected = latest["collected_at"].replace("T", " ").replace("Z", " UTC")
    block = f"""{start_marker}
## תמונת מצב

| מדד | ערך |
|---|---:|
| כלל ההורדות המצטברות המוצגות | **{format_number(summary['tracked_downloads'])}** |
| גרסאות `Sivan22/otzaria` | {format_number(summary['by_source']['sivan22'])} |
| גרסאות `Otzaria/otzaria` | {format_number(summary['by_source']['otzaria'])} |
| הספרייה המלאה | {format_number(summary['by_category']['library'])} |
| עדכוני דלתא | {format_number(summary['by_category']['delta'])} |
| הורדות חדשות שנצפו מאז תחילת המעקב | {format_number(observed)} |

עדכון אחרון: `{collected}`. לתצוגה האינטראקטיבית המלאה יש להפעיל GitHub Pages.
{end_marker}"""
    before = text.split(start_marker, 1)[0]
    after = text.split(end_marker, 1)[1]
    path.write_text(before + block + after, encoding="utf-8")


def collect(output_dir: Path, readme_path: Path) -> dict[str, Any]:
    token = os.getenv("GITHUB_TOKEN")
    collected_at = utc_now()
    raw = {source.id: fetch_all_releases(source, token) for source in SOURCES}
    latest = build_latest(raw, collected_at)

    history_dir = output_dir / "history"
    date = collected_at.date().isoformat()
    snapshot = build_snapshot(latest, date)
    previous = previous_snapshot(history_dir, date)
    changes = calculate_changes(snapshot, previous)

    timeseries_path = output_dir / "timeseries.json"
    timeseries = update_timeseries(timeseries_path, snapshot, changes)
    write_json(output_dir / "latest.json", latest)
    write_json(history_dir / f"{date}.json", snapshot, compact=True)
    write_json(timeseries_path, timeseries)
    update_readme(readme_path, latest, timeseries)
    return latest


def parse_args(argv: list[str]) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=root / "site" / "data")
    parser.add_argument("--readme", type=Path, default=root / "README.md")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    latest = collect(args.output_dir, args.readme)
    print(
        f"Collected {latest['summary']['release_count']} releases and "
        f"{latest['summary']['tracked_downloads']:,} tracked downloads."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
