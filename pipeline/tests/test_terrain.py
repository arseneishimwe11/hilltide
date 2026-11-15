from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from hilltide_pipeline.grid import Grid, local_to_lonlat, lonlat_to_local
from hilltide_pipeline.terrain import fill_voids, resample_to_grid, tile_name, tiles_for


def test_tile_names_follow_the_copernicus_scheme() -> None:
    assert tile_name(30, -2, 30) == "Copernicus_DSM_COG_10_S02_00_E030_00_DEM"
    assert tile_name(90, -3, 29) == "Copernicus_DSM_COG_30_S03_00_E029_00_DEM"
    assert tile_name(90, 1, -4) == "Copernicus_DSM_COG_30_N01_00_W004_00_DEM"


def test_tiles_cover_a_box_that_crosses_degree_lines() -> None:
    assert tiles_for((29.9, -2.1, 30.3, -1.8)) == [(-3, 29), (-3, 30), (-2, 29), (-2, 30)]
    assert tiles_for((30.1, -1.9, 30.2, -1.8)) == [(-2, 30)]


def write_dem(path: Path, west: float, north: float, size: int, fn) -> None:
    """A synthetic one-degree DEM tile in lon/lat whose height is fn(lon, lat)."""
    step = 1.0 / size
    lon = west + (np.arange(size) + 0.5) * step
    lat = north - (np.arange(size) + 0.5) * step
    data = fn(*np.meshgrid(lon, lat)).astype(np.float32)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(west, north, step, step),
    ) as dst:
        dst.write(data, 1)


def test_resampling_puts_heights_in_the_right_place(tmp_path: Path) -> None:
    """A plane tilted in lon and lat lands on the grid where the projection says."""

    def plane(lon, lat):
        return 1000 + 400 * (lon - 30.0) + 250 * (lat + 2.0)

    # Two tiles, split at the 30 degree line, so the mosaic seam is tested too.
    write_dem(tmp_path / "west.tif", 29.0, -1.0, 1200, plane)
    write_dem(tmp_path / "east.tif", 30.0, -1.0, 1200, plane)
    x0, y0 = lonlat_to_local(29.98, -1.9)
    grid = Grid("t", float(round(x0)), float(round(y0)), 100.0, 60, 50)

    heights, voids = resample_to_grid([tmp_path / "west.tif", tmp_path / "east.tif"], grid)

    assert voids == 0 and heights.shape == (50, 60)
    rows, cols = np.mgrid[0:50, 0:60]
    lon, lat = local_to_lonlat(*grid.centre_of(rows, cols))
    assert np.abs(heights - plane(lon, lat)).max() < 0.05


def test_missing_cells_are_counted_and_filled(tmp_path: Path) -> None:
    write_dem(tmp_path / "east.tif", 30.0, -1.0, 600, lambda lon, lat: 1500 + 0 * lon)
    x0, y0 = lonlat_to_local(29.99, -1.9)  # the grid's west edge has no tile
    grid = Grid("t", float(round(x0)), float(round(y0)), 100.0, 40, 20)
    heights, voids = resample_to_grid([tmp_path / "east.tif"], grid)
    assert voids > 0
    assert np.isfinite(heights).all() and np.allclose(heights, 1500, atol=0.01)


def test_fill_voids_uses_the_nearest_value() -> None:
    grid = np.array([[1.0, np.nan, np.nan, 9.0]], dtype=np.float32)
    assert fill_voids(grid).tolist() == [[1.0, 1.0, 9.0, 9.0]]
