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
APP_SOURCES = ("otzaria", "sivan22")
ARCHIVE_SCHEMA_VERSION = 1
# Build/CI by-products and checksums are downloaded by pipelines, not people.
CHECKSUM_PATTERN = re.compile(r"\.(sha256|sig)$")
DELTA_MANIFEST_PATTERN = re.compile(r"patch-.+\.db\.zst\.manifest\.json")


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

# Repositories whose release files the app downloads at runtime. They are kept in
# the archive only and never enter the site's headline totals.
EXTRA_SOURCES = (
    Source("hb_catalog", "Otzaria/otzar-HB_catalog", "קטלוג חיצוני", "catalog"),
    Source("magic_dictionary", "Otzaria/SeforimMagicIndexer", "מילון מורפולוגי", "dictionary"),
    Source("biographies", "Otzaria/ta-shma-to-otzaria", "ביוגרפיות", "biographies"),
    Source("offline_updater", "Otzaria/Otzaria_Offline_update", "עדכון אופליין", "offline_updater"),
)

# GitHub keeps traffic numbers for 14 days only, so they are archived daily.
# Reading them needs push access, hence a dedicated TRAFFIC_TOKEN secret.
TRAFFIC_REPOSITORIES = (
    "Otzaria/otzaria",
    "Sivan22/otzaria",
    "Otzaria/otzaria-library",
    "Otzaria/Otzaria_Offline_update",
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


def release_channel(release: dict[str, Any]) -> str:
    """Classify a release using the naming convention, not only GitHub's flag."""
    text = f"{release.get('tag', '')} {release.get('name', '')}".casefold()
    if re.search(r"\balpha\b|\bbeta\b", text):
        return "early"
    if re.search(r"\bpr[\s#-]*\d+\b", text):
        return "pr"
    if re.search(r"preview from|\bdev\b|development build", text):
        return "dev"
    return "stable"


def build_overview(latest: dict[str, Any]) -> dict[str, Any]:
    """Build the small, above-the-fold payload used before the explorer loads."""
    app_releases = [
        release
        for release in latest.get("releases", [])
        if release.get("source") in APP_SOURCES
    ]
    stable_releases = [
        release
        for release in app_releases
        if not release.get("prerelease") and release_channel(release) == "stable"
    ]
    preferred = [release for release in stable_releases if release.get("source") == "otzaria"]
    featured_release = (preferred or stable_releases or [None])[0]

    return {
        "schema_version": SCHEMA_VERSION,
        "collected_at": latest["collected_at"],
        "notice_he": latest.get("notice_he", ""),
        "sources": latest.get("sources", []),
        "summary": latest["summary"],
        "featured_release": featured_release,
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


def archive_category(source: Source, filename: str) -> str | None:
    """Category of a release file worth archiving, or None for pipeline by-products."""
    normalized = filename.casefold()
    if source.kind in ("app", "library"):
        category = asset_category(source, filename)
        if category in TRACKED_CATEGORIES:
            return category
        # The updater fetches one manifest per installed base version before it
        # decides whether to patch, so these count update checks per version.
        if DELTA_MANIFEST_PATTERN.fullmatch(normalized):
            return "update_check"
        return None
    if CHECKSUM_PATTERN.search(normalized):
        return None
    if normalized == "version.txt":
        return "update_check"
    return source.kind


def archive_records(source: Source, releases: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Normalize raw API releases (or compacted latest.json releases) per asset key."""
    records: dict[str, dict[str, Any]] = {}
    for release in releases:
        if release.get("draft"):
            continue
        release_key = f"{source.id}:{safe_number(release.get('id'))}"
        release_meta = {
            "repository": source.repository,
            "tag": str(release.get("tag_name") or release.get("tag") or ""),
            "name": str(release.get("name") or ""),
            "prerelease": bool(release.get("prerelease")),
            "published_at": release.get("published_at") or release.get("created_at"),
        }
        for asset in release.get("assets") or []:
            name = str(asset.get("name") or "")
            category = archive_category(source, name)
            if category is None:
                continue
            downloads = asset.get("download_count", asset.get("downloads"))
            records[f"{source.id}:{safe_number(asset.get('id'))}"] = {
                "downloads": safe_number(downloads),
                "release_key": release_key,
                "release": release_meta,
                "asset": {
                    "release": release_key,
                    "name": name,
                    "category": category,
                    "size": safe_number(asset.get("size")),
                    "created_at": asset.get("created_at"),
                    "updated_at": asset.get("updated_at"),
                },
            }
    return records


def update_registry(
    registry: dict[str, Any],
    records: dict[str, dict[str, Any]],
    fetched_sources: Iterable[str],
    date: str,
) -> dict[str, Any]:
    """Keep every release/file ever seen, so deleted ones keep their names.

    Only a source fetched successfully in this run can mark its entries removed.
    """
    releases = dict(registry.get("releases") or {})
    assets = dict(registry.get("assets") or {})
    seen_releases: set[str] = set()

    for key, record in records.items():
        release_key = record["release_key"]
        seen_releases.add(release_key)
        known_release = releases.get(release_key) or {}
        releases[release_key] = {
            **record["release"],
            "first_seen": known_release.get("first_seen") or date,
            "removed_on": None,
        }
        known_asset = assets.get(key) or {}
        asset = dict(record["asset"])
        # Backfilled entries have no timestamps; never erase ones already known.
        for field in ("created_at", "updated_at"):
            asset[field] = asset[field] or known_asset.get(field)
        assets[key] = {**asset, "first_seen": known_asset.get("first_seen") or date, "removed_on": None}

    fetched = set(fetched_sources)
    for collection, seen in ((releases, seen_releases), (assets, set(records))):
        for key, entry in collection.items():
            if key.split(":", 1)[0] in fetched and key not in seen and not entry.get("removed_on"):
                entry["removed_on"] = date

    return {"schema_version": ARCHIVE_SCHEMA_VERSION, "releases": releases, "assets": assets}


def build_archive_daily(
    date: str,
    collected_at: str,
    records: dict[str, dict[str, Any]],
    previous_counts: dict[str, int],
    repositories: dict[str, dict[str, int]] | None = None,
) -> dict[str, Any]:
    """Counters the site history does not keep, plus signals that are lost later.

    Tracked (app/library/delta) counters already live in site/data/history and
    are not duplicated here; they are still checked for counter decreases.
    """
    assets = {
        key: record["downloads"]
        for key, record in records.items()
        if record["asset"]["category"] not in TRACKED_CATEGORIES
    }
    decreases = {
        key: [previous_counts[key], record["downloads"]]
        for key, record in records.items()
        if key in previous_counts and record["downloads"] < previous_counts[key]
    }
    daily: dict[str, Any] = {
        "schema_version": ARCHIVE_SCHEMA_VERSION,
        "date": date,
        "collected_at": collected_at,
        "assets": dict(sorted(assets.items())),
    }
    if repositories:
        daily["repositories"] = repositories
    if decreases:
        daily["decreases"] = decreases
    return daily


def previous_archive_counts(
    archive_dir: Path, previous_site_snapshot: dict[str, Any] | None, current_date: str
) -> dict[str, int]:
    counts: dict[str, int] = {}
    daily = previous_snapshot(archive_dir / "daily", current_date) if (archive_dir / "daily").exists() else None
    if daily:
        counts.update({key: safe_number(value) for key, value in (daily.get("assets") or {}).items()})
    for key, entry in ((previous_site_snapshot or {}).get("assets") or {}).items():
        if isinstance(entry, list) and entry:
            counts[key] = safe_number(entry[0])
    return counts


def fetch_repository_stats(repositories: Iterable[str], token: str | None) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = {}
    for repository in repositories:
        try:
            payload = fetch_json(f"{API_ROOT}/repos/{repository}", token)
        except RuntimeError as error:
            print(f"::warning::Skipping repository stats for {repository}: {error}", file=sys.stderr)
            continue
        stats[repository] = {
            "stars": safe_number(payload.get("stargazers_count")),
            "forks": safe_number(payload.get("forks_count")),
            "watchers": safe_number(payload.get("subscribers_count")),
        }
    return stats


def fetch_traffic(repository: str, token: str) -> dict[str, Any]:
    base = f"{API_ROOT}/repos/{repository}/traffic"
    return {
        "views": fetch_json(f"{base}/views", token),
        "clones": fetch_json(f"{base}/clones", token),
        "referrers": fetch_json(f"{base}/popular/referrers", token),
        "paths": fetch_json(f"{base}/popular/paths", token),
    }


def merge_traffic(existing: dict[str, Any], fetched: dict[str, Any], repository: str, date: str) -> dict[str, Any]:
    """Merge one 14-day traffic window into the permanent per-repository record.

    Daily views/clones are keyed by their own day: a later fetch always holds the
    final value, so it replaces an earlier (possibly partial) one. Referrers and
    paths are only offered as a 14-day aggregate, stored per collection date.
    """
    merged: dict[str, Any] = {"schema_version": ARCHIVE_SCHEMA_VERSION, "repository": repository}
    for kind in ("views", "clones"):
        days = dict(existing.get(kind) or {})
        for item in (fetched.get(kind) or {}).get(kind) or []:
            day = str(item.get("timestamp") or "")[:10]
            if day:
                days[day] = [safe_number(item.get("count")), safe_number(item.get("uniques"))]
        merged[kind] = dict(sorted(days.items()))
    for kind, field in (("referrers", "referrer"), ("paths", "path")):
        windows = dict(existing.get(kind) or {})
        windows[date] = [
            [str(item.get(field) or ""), safe_number(item.get("count")), safe_number(item.get("uniques"))]
            for item in fetched.get(kind) or []
        ]
        merged[kind] = dict(sorted(windows.items()))
    return merged


def archive_traffic(archive_dir: Path, date: str, token: str | None) -> None:
    if not token:
        print("::notice::TRAFFIC_TOKEN is not set; traffic (kept by GitHub for 14 days only) was not archived.")
        return
    for repository in TRAFFIC_REPOSITORIES:
        try:
            fetched = fetch_traffic(repository, token)
        except RuntimeError as error:
            print(f"::warning::Skipping traffic for {repository}: {error}", file=sys.stderr)
            continue
        path = archive_dir / "traffic" / f"{repository.replace('/', '__')}.json"
        existing = read_json(path) if path.exists() else {}
        write_json(path, merge_traffic(existing, fetched, repository, date))


def registry_sort_key(key: str) -> tuple[str, int]:
    source, _, identifier = key.partition(":")
    return source, safe_number(identifier)


def write_registry(path: Path, registry: dict[str, Any]) -> None:
    """One entry per line: the daily diff then shows only what really changed."""
    lines = ["{", f'  "schema_version": {registry["schema_version"]},']
    sections = ("releases", "assets")
    for index, section in enumerate(sections):
        entries = sorted(registry[section].items(), key=lambda item: registry_sort_key(item[0]))
        lines.append(f'  "{section}": {{')
        for position, (key, value) in enumerate(entries):
            comma = "," if position < len(entries) - 1 else ""
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            lines.append(f"    {json.dumps(key)}: {encoded}{comma}")
        lines.append("  }" + ("," if index < len(sections) - 1 else ""))
    lines.append("}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text("\n".join(lines) + "\n", encoding="utf-8")
    temporary.replace(path)


def fetch_extra_sources(token: str | None) -> dict[str, list[dict[str, Any]]]:
    """Extra repositories never block the site's collection; a failed one is skipped."""
    raw: dict[str, list[dict[str, Any]]] = {}
    for source in EXTRA_SOURCES:
        try:
            raw[source.id] = fetch_all_releases(source, token)
        except RuntimeError as error:
            print(f"::warning::Skipping {source.repository}: {error}", file=sys.stderr)
    return raw


def update_archive(
    archive_dir: Path,
    raw: dict[str, list[dict[str, Any]]],
    extra_raw: dict[str, list[dict[str, Any]]],
    previous_site_snapshot: dict[str, Any] | None,
    date: str,
    collected_at: str,
    token: str | None,
) -> None:
    sources = {source.id: source for source in SOURCES + EXTRA_SOURCES}
    records: dict[str, dict[str, Any]] = {}
    for source_id, releases in {**raw, **extra_raw}.items():
        records.update(archive_records(sources[source_id], releases))

    registry_path = archive_dir / "registry.json"
    registry = read_json(registry_path) if registry_path.exists() else {}
    write_registry(registry_path, update_registry(registry, records, [*raw, *extra_raw], date))

    previous_counts = previous_archive_counts(archive_dir, previous_site_snapshot, date)
    repositories = fetch_repository_stats([source.repository for source in sources.values()], token)
    daily = build_archive_daily(date, collected_at, records, previous_counts, repositories)
    write_json(archive_dir / "daily" / f"{date}.json", daily, compact=True)

    archive_traffic(archive_dir, date, os.getenv("TRAFFIC_TOKEN"))


def backfill_archive_from_git(repository_root: Path, archive_dir: Path) -> int:
    """One-off recovery: rebuild the registry and past update-check counters from
    the committed history of latest.json, which held every release file daily."""
    import subprocess

    def git(*arguments: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repository_root), *arguments], check=True, capture_output=True, text=True
        ).stdout

    commits = git("log", "--reverse", "--format=%H", "--", "site/data/latest.json").split()
    by_date: dict[str, dict[str, Any]] = {}
    for commit in commits:
        latest = json.loads(git("show", f"{commit}:site/data/latest.json"))
        by_date[str(latest["collected_at"])[:10]] = latest  # the last commit of a day wins

    sources = {source.id: source for source in SOURCES}
    registry: dict[str, Any] = {}
    previous_counts: dict[str, int] = {}
    written = 0
    for date, latest in sorted(by_date.items()):
        records: dict[str, dict[str, Any]] = {}
        for source in SOURCES:
            releases = [release for release in latest.get("releases", []) if release.get("source") == source.id]
            records.update(archive_records(sources[source.id], releases))
        registry = update_registry(registry, records, sources, date)
        daily_path = archive_dir / "daily" / f"{date}.json"
        if not daily_path.exists():
            write_json(
                daily_path,
                build_archive_daily(date, latest["collected_at"], records, previous_counts),
                compact=True,
            )
            written += 1
        previous_counts = {key: record["downloads"] for key, record in records.items()}

    registry_path = archive_dir / "registry.json"
    if registry_path.exists():
        # Keep what live runs already learned (timestamps, extra sources).
        current = read_json(registry_path)
        for section in ("releases", "assets"):
            for key, entry in registry[section].items():
                known = current[section].get(key)
                if known:
                    known["first_seen"] = min(known.get("first_seen") or date, entry["first_seen"])
                else:
                    current[section][key] = entry
        registry = current
    write_registry(registry_path, registry)
    return written


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

שלוש משפחות מדידה נפרדות — מתקיני התוכנה, קובץ הספרייה המלא ועדכוני הדלתא. אלה יחידות מדידה שונות ואין לסכם אותן למספר אחד.

| משפחת מדידה | ערך |
|---|---:|
| **הורדות התוכנה** (שני המאגרים יחד) | **{format_number(summary['by_category']['app'])}** |
| ↳ מתוכן במאגר הקודם `Sivan22/otzaria` | {format_number(summary['by_source']['sivan22'])} |
| ↳ מתוכן במאגר הנוכחי `Otzaria/otzaria` | {format_number(summary['by_source']['otzaria'])} |
| הספרייה המלאה (קובץ הספרים) | {format_number(summary['by_category']['library'])} |
| עדכוני ספרייה (דלתא) | {format_number(summary['by_category']['delta'])} |
| סך כל הקבצים שנמדדו (שלוש המשפחות יחד) | {format_number(summary['tracked_downloads'])} |
| הורדות חדשות שנצפו מאז תחילת המעקב | {format_number(observed)} |

עדכון אחרון: `{collected}`. לתצוגה האינטראקטיבית המלאה יש להפעיל GitHub Pages.
{end_marker}"""
    before = text.split(start_marker, 1)[0]
    after = text.split(end_marker, 1)[1]
    path.write_text(before + block + after, encoding="utf-8")


def collect(output_dir: Path, readme_path: Path, archive_dir: Path) -> dict[str, Any]:
    token = os.getenv("GITHUB_TOKEN")
    collected_at = utc_now()
    raw = {source.id: fetch_all_releases(source, token) for source in SOURCES}
    extra_raw = fetch_extra_sources(token)
    latest = build_latest(raw, collected_at)

    history_dir = output_dir / "history"
    date = collected_at.date().isoformat()
    snapshot = build_snapshot(latest, date)
    previous = previous_snapshot(history_dir, date)
    changes = calculate_changes(snapshot, previous)

    timeseries_path = output_dir / "timeseries.json"
    timeseries = update_timeseries(timeseries_path, snapshot, changes)
    write_json(output_dir / "latest.json", latest)
    write_json(output_dir / "overview.json", build_overview(latest))
    write_json(history_dir / f"{date}.json", snapshot, compact=True)
    write_json(timeseries_path, timeseries)
    update_readme(readme_path, latest, timeseries)
    update_archive(archive_dir, raw, extra_raw, previous, date, latest["collected_at"], token)
    return latest


def parse_args(argv: list[str]) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=root / "site" / "data")
    parser.add_argument("--readme", type=Path, default=root / "README.md")
    parser.add_argument("--archive-dir", type=Path, default=root / "archive")
    parser.add_argument(
        "--backfill-archive",
        action="store_true",
        help="rebuild the archive from the git history of latest.json and exit",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.backfill_archive:
        written = backfill_archive_from_git(Path(__file__).resolve().parents[1], args.archive_dir)
        print(f"Backfilled {written} archive days from git history.")
        return 0
    latest = collect(args.output_dir, args.readme, args.archive_dir)
    print(
        f"Collected {latest['summary']['release_count']} releases and "
        f"{latest['summary']['tracked_downloads']:,} tracked downloads."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
