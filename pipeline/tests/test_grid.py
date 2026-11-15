import numpy as np
import pytest

from hilltide_pipeline.grid import (
    CITY_OF_KIGALI_BOUNDS,
    COUNTRY,
    KIGALI,
    KIGALI_4M,
    REGION,
    Grid,
    local_to_lonlat,
    lonlat_to_local,
)


def test_projection_origin_and_axes() -> None:
    x, y = lonlat_to_local(30.0, -2.0)
    assert abs(x) < 1e-6 and abs(y) < 1e-6
    east, _ = lonlat_to_local(30.1, -2.0)
    _, north = lonlat_to_local(30.0, -1.9)
    # A tenth of a degree is about 11.1 km near the equator.
    assert east == pytest.approx(11_130, rel=0.01)
    assert north == pytest.approx(11_057, rel=0.01)


def test_projection_round_trip_within_a_millimetre() -> None:
    rng = np.random.default_rng(1)
    lon = rng.uniform(28.6, 31.1, 500)
    lat = rng.uniform(-3.1, -0.8, 500)
    x, y = lonlat_to_local(lon, lat)
    lon2, lat2 = local_to_lonlat(x, y)
    back_x, back_y = lonlat_to_local(lon2, lat2)
    assert np.abs(back_x - x).max() < 1e-3
    assert np.abs(back_y - y).max() < 1e-3


def test_projection_matches_true_distance_across_the_country() -> None:
    """Grid distances stay within 0.05% of distances on the ellipsoid."""
    from pyproj import Geod

    geod = Geod(ellps="WGS84")
    kigali = (30.0619, -1.9441)
    for lon, lat in [(28.9, -2.5), (30.8, -1.1), (29.3, -1.5), (30.5, -2.8)]:
        _, _, true = geod.inv(kigali[0], kigali[1], lon, lat)
        ax, ay = lonlat_to_local(*kigali)
        bx, by = lonlat_to_local(lon, lat)
        assert np.hypot(bx - ax, by - ay) == pytest.approx(true, rel=5e-4)


def test_cell_indexing_convention() -> None:
    grid = Grid("t", x_min=100.0, y_max=500.0, cell=10.0, width=4, height=3)
    assert grid.bounds == (100.0, 470.0, 140.0, 500.0)
    assert grid.shape == (3, 4)
    row, col = grid.cell_of(105.0, 495.0)  # centre of the north-west cell
    assert (row, col) == (0.5, 0.5)
    x, y = grid.centre_of(2, 3)  # south-east cell
    assert (x, y) == (135.0, 475.0)
    assert grid.contains(100.0, 500.0) and not grid.contains(140.0, 500.0)


def test_coarsen_and_refine_keep_the_same_area() -> None:
    half = KIGALI.coarsened(2)
    assert half.bounds == KIGALI.bounds and half.cell == 60.0 and half.shape == (640, 640)
    assert KIGALI.refined(2).coarsened(2, "kigali") == KIGALI
    with pytest.raises(ValueError):
        Grid("odd", 0, 0, 1, 3, 3).coarsened(2)


def test_kigali_grid_holds_the_whole_city_with_margin() -> None:
    assert KIGALI.shape == (1280, 1280) and KIGALI.cell == 30.0
    assert KIGALI_4M.bounds == KIGALI.bounds and KIGALI_4M.shape == (9600, 9600)
    west, south, east, north = CITY_OF_KIGALI_BOUNDS
    margins = (
        west - KIGALI.x_min,
        south - KIGALI.y_min,
        KIGALI.x_max - east,
        KIGALI.y_max - north,
    )
    assert min(margins) >= 2400.0
    # Corners on the 960 m lattice: divides into 60 m and 120 m cells and 3.84 km tiles.
    assert all(value % 960 == 0 for value in KIGALI.bounds)
    # City centre, the airport and the Nyabugogo wetland are inside.
    for lon, lat in [(30.0619, -1.9441), (30.1395, -1.9686), (30.044, -1.939)]:
        assert KIGALI.contains(*lonlat_to_local(lon, lat))


def test_levels_nest() -> None:
    def inside(inner: Grid, outer: Grid) -> bool:
        return (
            inner.x_min >= outer.x_min
            and inner.x_max <= outer.x_max
            and inner.y_min >= outer.y_min
            and inner.y_max <= outer.y_max
        )

    assert inside(KIGALI, REGION) and inside(REGION, COUNTRY)


def test_country_grid_holds_all_of_rwanda() -> None:
    west, south, east, north = COUNTRY.lonlat_bounds()
    assert west < 28.86 and east > 30.90 and south < -2.84 and north > -1.05
