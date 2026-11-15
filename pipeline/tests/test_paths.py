from pathlib import Path

import pytest

from hilltide_pipeline.paths import ROOT_ENV, Paths, default_paths, find_repo_root


def test_finds_the_real_repository_root(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ROOT_ENV, raising=False)
    root = find_repo_root()
    assert (root / "site.config.json").is_file()
    assert (root / "pipeline" / "pyproject.toml").is_file()


def test_root_can_be_overridden(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(ROOT_ENV, str(tmp_path))
    assert default_paths().root == tmp_path.resolve()


def test_missing_root_is_an_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv(ROOT_ENV, raising=False)
    with pytest.raises(FileNotFoundError):
        find_repo_root(tmp_path)


def test_raw_data_stays_outside_the_site(tmp_path: Path) -> None:
    paths = Paths(tmp_path).ensure()
    assert paths.raw.is_dir() and paths.work.is_dir() and paths.web_data.is_dir()
    assert paths.web_data == tmp_path / "web" / "public" / "data"
    assert paths.manifest.parent == paths.web_data
    assert not paths.raw.is_relative_to(tmp_path / "web")
    assert not paths.work.is_relative_to(tmp_path / "web")
