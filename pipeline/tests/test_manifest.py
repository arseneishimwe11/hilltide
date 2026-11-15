from pathlib import Path

import numpy as np

from hilltide_pipeline.container import Container
from hilltide_pipeline.manifest import AssetRecord, load_manifest, update_manifest, verify_manifest


def write_asset(data_dir: Path, relative: str, value: int) -> None:
    Container("test", 1).add("a", np.full(50, value, np.uint16)).write(data_dir / relative)


def record(key: str, relative: str) -> AssetRecord:
    return AssetRecord(key=key, path=relative, kind="test", version=1, sources=["src"])


def test_manifest_records_sizes_hashes_and_sources(tmp_path: Path) -> None:
    write_asset(tmp_path, "a/one.hlt", 1)
    write_asset(tmp_path, "a/two.hlt", 2)
    path = tmp_path / "manifest.json"
    manifest = update_manifest(
        path,
        [record("a.one", "a/one.hlt"), record("a.two", "a/two.hlt")],
        {"src": {"name": "Source", "attribution": "Credit line"}},
    )
    assert set(manifest["assets"]) == {"a.one", "a.two"}
    one = manifest["assets"]["a.one"]
    assert one["bytes"] == (tmp_path / "a/one.hlt").stat().st_size and len(one["sha256"]) == 64
    assert manifest["totalBytes"] == sum(e["bytes"] for e in manifest["assets"].values())
    assert manifest["sources"]["src"]["attribution"] == "Credit line"
    assert verify_manifest(path) == []


def test_rerunning_a_step_replaces_its_assets_only(tmp_path: Path) -> None:
    for relative in ("a/one.hlt", "a/old.hlt", "b/keep.hlt"):
        write_asset(tmp_path, relative, 1)
    path = tmp_path / "manifest.json"
    update_manifest(path, [record("a.one", "a/one.hlt"), record("a.old", "a/old.hlt")], {"src": {}})
    update_manifest(path, [record("b.keep", "b/keep.hlt")], {"src": {}})
    update_manifest(path, [record("a.one", "a/one.hlt")], {"src": {}}, remove_prefix="a.")
    assert set(load_manifest(path)["assets"]) == {"a.one", "b.keep"}


def test_verify_reports_changed_missing_and_unsourced_files(tmp_path: Path) -> None:
    for relative in ("one.hlt", "two.hlt", "three.hlt"):
        write_asset(tmp_path, relative, 1)
    path = tmp_path / "manifest.json"
    orphan = AssetRecord(key="three", path="three.hlt", kind="test", version=1, sources=["nope"])
    update_manifest(path, [record("one", "one.hlt"), record("two", "two.hlt"), orphan], {"src": {}})
    write_asset(tmp_path, "one.hlt", 7)  # same size, different content
    (tmp_path / "two.hlt").unlink()
    problems = verify_manifest(path)
    assert any("one: hash differs" in p for p in problems)
    assert any("two: missing file" in p for p in problems)
    assert any("three: unknown source nope" in p for p in problems)
