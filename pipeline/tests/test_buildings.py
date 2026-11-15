import numpy as np
import pytest
import shapely

from hilltide_pipeline.buildings import (
    MAX_HEIGHT,
    MIN_HEIGHT,
    burn_labels,
    first_year_index,
    measure_year,
    settle_heights,
)
from hilltide_pipeline.footprints import oriented_rectangles
from hilltide_pipeline.grid import Grid


def series(*rows: str) -> np.ndarray:
    """'0011 1111' -> presence of 0.1 for '0' and 0.9 for '1', one row per building."""
    return np.array([[0.9 if c == "1" else 0.1 for c in row.replace(" ", "")] for row in rows])


@pytest.mark.parametrize(
    ("pattern", "expected"),
    [
        ("11111111", 0),  # there from the start
        ("00011111", 3),  # appears in the fourth year
        ("00000001", 7),  # appears in the last year
        ("00000000", -1),  # never present
        ("00110111", 2),  # one dropout after appearing: 5 of 6 years present
        ("10001111", 4),  # isolated early detection is ignored
        ("11100000", -1),  # gone for good: not shown as a building that exists
        ("01010101", 7),  # flicker qualifies only at the very end
        ("00011011", 3),  # 4 of 5 years present
        ("00010011", 6),  # 3 of 5 from the fourth year is too few
    ],
)
def test_first_year_rule(pattern: str, expected: int) -> None:
    assert first_year_index(series(pattern)).tolist() == [expected]


def test_first_year_threshold_is_inclusive_and_vectorised() -> None:
    presence = np.array([[0.49, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], [0.0, 0.0, 0.0, 0.49]])
    assert first_year_index(presence).tolist() == [1, 0, -1]


def test_settled_heights_ignore_one_odd_year_and_keep_growth() -> None:
    height = np.array(
        [
            [0.0, 0.0, 6.0, 6.2, 30.0, 6.1, 6.0, 6.3],  # one spike
            [4.0, 4.0, 4.0, 12.0, 12.0, 12.0, 12.0, 12.0],  # real extension
            [9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0],  # never present
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 500.0],  # out of range values
        ]
    )
    first = np.array([2, 0, -1, 0])
    settled = settle_heights(height, first)
    assert settled[0, :2].tolist() == [0.0, 0.0]  # nothing before the first year
    assert settled[0, 2:].max() < 7.0  # the spike is gone
    assert settled[1].tolist() == [4.0, 4.0, 4.0, 12.0, 12.0, 12.0, 12.0, 12.0]
    assert not settled[2].any()
    assert settled[3].min() == MIN_HEIGHT and settled[3].max() <= MAX_HEIGHT


def test_labels_and_zonal_measurement() -> None:
    grid = Grid("t", 0.0, 40.0, 4.0, 10, 10)
    big = shapely.box(0, 20, 16, 40)  # 4 x 5 cells, top-left
    small = shapely.box(4, 28, 12, 36)  # 2 x 2 cells inside the big one
    tiny = shapely.box(30.2, 5.2, 31.2, 6.2)  # 1 m2: covers no cell centre
    polygons = np.array([big, small, tiny])
    labels = burn_labels(polygons, grid)
    cells = np.bincount(labels.ravel(), minlength=4)[1:]
    assert cells.tolist() == [16, 4, 0]  # the small one keeps its cells

    presence = np.zeros(grid.shape, np.float32)
    presence[:5, :4] = 1.0  # the big footprint's area is fully built
    presence[8, 7] = 0.8  # the cell holding the tiny footprint
    height = np.where(presence > 0, 10.0, 0.0).astype(np.float32)
    height[1:3, 1:3] = 20.0  # the small footprint is taller

    centroid = shapely.centroid(polygons)
    x, y = shapely.get_x(centroid), shapely.get_y(centroid)
    mean_presence, mean_height = measure_year(labels, cells, grid, x, y, presence, height)
    assert mean_presence[:2].tolist() == [1.0, 1.0]
    assert mean_height[:2].tolist() == [10.0, 20.0]
    assert 0.0 < mean_presence[2] <= 0.8  # sampled at the centroid, between cells


def test_oriented_rectangles_match_area_and_direction() -> None:
    rect = shapely.box(0, 0, 20, 10)
    turned = shapely.affinity.rotate(rect, 30, origin=(0, 0))
    ell = shapely.Polygon([(0, 0), (20, 0), (20, 6), (6, 6), (6, 14), (0, 14)])
    result = oriented_rectangles(np.array([rect, turned, ell]))
    assert result.length[:2] == pytest.approx([20, 20]) and result.width[:2] == pytest.approx(
        [10, 10]
    )
    assert result.angle[0] == pytest.approx(0.0, abs=1e-9)
    assert result.angle[1] == pytest.approx(np.radians(30))
    assert (result.x[0], result.y[0]) == pytest.approx((10, 5))
    # The L shape's rectangle is shrunk to the L's own area.
    assert result.length[2] * result.width[2] == pytest.approx(ell.area)
    assert np.all((result.angle >= 0) & (result.angle < np.pi))
