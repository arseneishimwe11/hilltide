"""Command line entry point: `hilltide-pipeline [step ...]` (default: all steps)."""

from __future__ import annotations

import argparse
import sys
import time

from .manifest import load_manifest, verify_manifest
from .paths import default_paths
from .steps import STEPS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="hilltide-pipeline",
        description="Build Hilltide's web assets from open source data.",
    )
    parser.add_argument(
        "steps",
        nargs="*",
        metavar="step",
        help=f"steps to run, in order (default: all). One of: {', '.join(STEPS)}, verify",
    )
    args = parser.parse_args(argv)
    names = args.steps or [*STEPS, "verify"]
    unknown = [name for name in names if name not in STEPS and name != "verify"]
    if unknown:
        parser.error(f"unknown step: {', '.join(unknown)}")

    paths = default_paths().ensure()
    for name in names:
        started = time.monotonic()
        if name == "verify":
            problems = verify_manifest(paths.manifest)
            for problem in problems:
                print(f"manifest problem: {problem}", file=sys.stderr)
            if problems:
                return 1
            manifest = load_manifest(paths.manifest)
            total = manifest.get("totalBytes", 0) / 1e6
            print(f"manifest ok: {len(manifest['assets'])} assets, {total:.2f} MB")
            continue
        STEPS[name](paths, print)
        print(f"{name}: done in {time.monotonic() - started:.0f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
