import numpy as np
import pytest

from hilltide_pipeline.container import Container
from hilltide_pipeline.grid import Grid
from hilltide_pipeline.landcover import (
    WATER,
    overview_for,
    pack_landcover,
    simplify_classes,
    tile_url,
    tiles_for,
    unpack_landcover,
)


def test_worldcover_tiles_are_three_degree_blocks() -> None:
    assert tiles_for((29.9, -2.1, 30.3, -1.8)) == [(-3, 27), (-3, 30)]
    assert tiles_for((28.6, -3.1, 31.1, -0.8)) == [(-6, 27), (-6, 30), (-3, 27), (-3, 30)]
    assert tile_url(-3, 30).endswith("ESA_WorldCover_10m_2021_v200_S03E030_Map.tif")
    assert tile_url(3, -9).endswith("_N03W009_Map.tif")


def test_overview_level_never_reads_coarser_than_the_target() -> None:
    assert overview_for(10) is None and overview_for(19) is None
    assert overview_for(30) == 0  # 20 m pixels for 30 m cells
    assert overview_for(90) == 2  # 80 m pixels for 90 m cells
    assert overview_for(250) == 3  # 160 m pixels for 250 m cells


def test_class_codes_are_simplified() -> None:
    codes = np.array([[0, 10, 20, 30, 40, 50], [60, 70, 80, 90, 95, 100]], dtype=np.uint8)
    assert simplify_classes(codes).tolist() == [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 10]]


def test_landcover_round_trip_and_shares() -> None:
    grid = Grid("t", 0.0, 300.0, 30.0, 20, 10)
    classes = np.full(grid.shape, 4, dtype=np.uint8)
    classes[:, :5] = WATER
    container = Container.from_bytes(pack_landcover(classes, grid).to_bytes())
    restored, meta = unpack_landcover(container)
    assert np.array_equal(restored, classes)
    assert meta["share"][str(WATER)] == 0.25 and meta["share"]["4"] == 0.75
    with pytest.raises(ValueError):
        pack_landcover(classes[:5], grid)
