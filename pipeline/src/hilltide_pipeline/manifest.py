"""The asset manifest: the single index the web app loads its data through.

Each pipeline step returns records for the assets it wrote. The manifest
lists every asset with its size and hash, the format version, the source
files it was built from, and the attribution each source requires.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .download import sha256_of

MANIFEST_VERSION = 1


@dataclass
class AssetRecord:
    """One file under web/public/data/."""

    #: Stable name the web app asks for, for example "terrain.kigali".
    key: str
    #: Path relative to the data directory.
    path: str
    kind: str
    version: int
    #: Keys into the manifest's "sources" table.
    sources: list[str] = field(default_factory=list)
    #: Small facts the app needs before loading the file (grid, counts, ...).
    info: dict = field(default_factory=dict)
    bytes: int = 0
    sha256: str = ""

    def measure(self, data_dir: Path) -> AssetRecord:
        file = data_dir / self.path
        self.bytes = file.stat().st_size
        self.sha256 = sha256_of(file)
        return self


def load_manifest(path: Path) -> dict:
    if path.is_file():
        return json.loads(path.read_text())
    return {"version": MANIFEST_VERSION, "assets": {}, "sources": {}}


def update_manifest(
    path: Path, records: list[AssetRecord], sources: dict[str, dict], remove_prefix: str = ""
) -> dict:
    """Merge one step's assets and sources into the manifest and write it.

    `remove_prefix` drops existing assets whose key starts with it first, so a
    re-run step never leaves stale entries behind.
    """
    manifest = load_manifest(path)
    assets: dict[str, dict] = manifest["assets"]
    if remove_prefix:
        for key in [key for key in assets if key.startswith(remove_prefix)]:
            del assets[key]
    data_dir = path.parent
    for record in records:
        entry = asdict(record.measure(data_dir))
        del entry["key"]
        assets[record.key] = entry
    manifest["sources"].update(sources)
    manifest["version"] = MANIFEST_VERSION
    manifest["totalBytes"] = sum(entry["bytes"] for entry in assets.values())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def verify_manifest(path: Path) -> list[str]:
    """Return a list of problems: missing files, wrong sizes or hashes, unknown sources."""
    manifest = load_manifest(path)
    problems = []
    for key, entry in manifest["assets"].items():
        file = path.parent / entry["path"]
        if not file.is_file():
            problems.append(f"{key}: missing file {entry['path']}")
            continue
        if file.stat().st_size != entry["bytes"]:
            problems.append(f"{key}: size differs from manifest")
        elif sha256_of(file) != entry["sha256"]:
            problems.append(f"{key}: hash differs from manifest")
        for source in entry["sources"]:
            if source not in manifest["sources"]:
                problems.append(f"{key}: unknown source {source}")
    return problems
