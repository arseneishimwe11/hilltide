"""Resumable downloads into the raw data cache, with a record of every file.

The cache (data/raw/) is outside git. `sources.json` in it records where each
file came from, its size, hash and download date, so the manifest can state
exactly which source files an asset was built from.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import requests

CHUNK = 1 << 20
USER_AGENT = "hilltide-pipeline (open data build)"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(CHUNK):
            digest.update(block)
    return digest.hexdigest()


class SourceLog:
    """The record of downloaded files, kept as data/raw/sources.json."""

    def __init__(self, raw_dir: Path) -> None:
        self.raw_dir = raw_dir
        self.path = raw_dir / "sources.json"
        self.entries: dict[str, dict] = (
            json.loads(self.path.read_text()) if self.path.is_file() else {}
        )

    def get(self, relative: str) -> dict | None:
        return self.entries.get(relative)

    def record(self, relative: str, url: str, path: Path, **extra) -> dict:
        entry = {
            "url": url,
            "bytes": path.stat().st_size,
            "sha256": sha256_of(path),
            "fetched": datetime.now(UTC).strftime("%Y-%m-%d"),
            **extra,
        }
        self.entries[relative] = entry
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.entries, indent=2, sort_keys=True) + "\n")
        return entry


def fetch(
    url: str,
    relative: str,
    raw_dir: Path,
    log: SourceLog | None = None,
    attempts: int = 5,
    session: requests.Session | None = None,
) -> Path:
    """Download `url` to raw_dir/relative unless it is already there.

    Interrupted downloads resume from the partial file. Network errors are
    retried with a growing pause.
    """
    log = log or SourceLog(raw_dir)
    target = raw_dir / relative
    known = log.get(relative)
    if target.is_file() and known and known["bytes"] == target.stat().st_size:
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    http = session or requests.Session()
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            start = partial.stat().st_size if partial.is_file() else 0
            headers = {"User-Agent": USER_AGENT}
            if start:
                headers["Range"] = f"bytes={start}-"
            with http.get(url, headers=headers, stream=True, timeout=(30, 120)) as response:
                if response.status_code == 416:  # the partial file is already complete
                    break
                response.raise_for_status()
                mode = "ab" if start and response.status_code == 206 else "wb"
                with partial.open(mode) as handle:
                    for block in response.iter_content(CHUNK):
                        handle.write(block)
            break
        except (requests.RequestException, OSError) as error:
            last_error = error
            time.sleep(min(60, 2 ** (attempt + 1)))
    else:
        raise RuntimeError(f"Could not download {url}: {last_error}")

    partial.replace(target)
    log.record(relative, url, target)
    return target
