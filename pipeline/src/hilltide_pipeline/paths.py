"""Where the pipeline reads and writes.

Raw downloads are cached outside git. Only compact, web-ready assets are
written into the web app's public folder and committed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

#: Environment variable that overrides the repository root (used by tests).
ROOT_ENV = "HILLTIDE_ROOT"


def find_repo_root(start: Path | None = None) -> Path:
    """Return the repository root: the nearest parent holding site.config.json."""
    override = os.environ.get(ROOT_ENV)
    if override:
        return Path(override).resolve()
    here = (start or Path(__file__)).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "site.config.json").is_file():
            return candidate
    raise FileNotFoundError("Could not find the repository root (no site.config.json found)")


@dataclass(frozen=True)
class Paths:
    """The directories the pipeline uses, all derived from the repository root."""

    root: Path

    @property
    def raw(self) -> Path:
        """Downloaded source data. Git-ignored; safe to delete and re-download."""
        return self.root / "data" / "raw"

    @property
    def work(self) -> Path:
        """Intermediate files between steps. Git-ignored."""
        return self.root / "data" / "work"

    @property
    def web_data(self) -> Path:
        """Compact assets the site loads. Committed."""
        return self.root / "web" / "public" / "data"

    @property
    def manifest(self) -> Path:
        """Index of every web asset with its size, hash and source version."""
        return self.web_data / "manifest.json"

    def ensure(self) -> Paths:
        for directory in (self.raw, self.work, self.web_data):
            directory.mkdir(parents=True, exist_ok=True)
        return self


def default_paths() -> Paths:
    return Paths(find_repo_root())
