import numpy as np
import pytest
import shapely

from hilltide_pipeline.buildings import (
    HEIGHT_UNIT,
    LENGTH_UNIT,
    MAX_HEIGHT,
    MIN_HEIGHT,
    TILE_SIZE,
    BuildingTable,
    burn_labels,
    first_year_index,
    measure_year,
    pack_tile,
    relative_presence,
    settle_heights,
    tile_index,
    unpack_tile,
    yearly_totals,
)
from hilltide_pipeline.container import Container
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


def test_relative_presence_judges_each_building_against_its_own_final_level() -> None:
    presence = np.array(
        [
            [0.02, 0.03, 0.05, 0.30, 0.32, 0.30, 0.31, 0.30],  # small house, built in year 4
            [0.80, 0.82, 0.79, 0.81, 0.80, 0.83, 0.80, 0.81],  # large building, always there
            [0.05, 0.04, 0.06, 0.05, 0.04, 0.05, 0.06, 0.90],  # finished in the last year
            [0.60, 0.60, 0.60, 0.10, 0.05, 0.05, 0.04, 0.05],  # gone by the end
            [0.05, 0.08, 0.10, 0.12, 0.10, 0.15, 0.18, 0.19],  # too faint to date
        ]
    )
    relative, datable = relative_presence(presence)
    assert datable.tolist() == [True, True, True, False, False]
    assert not relative[3].any() and not relative[4].any()
    first = first_year_index(relative)
    assert first.tolist() == [3, 0, 7, -1, -1]
    # A fixed threshold of 0.5 on raw presence would have missed the small house entirely.
    assert first_year_index(presence)[0] == -1


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


def sample_table(count: int, seed: int = 0) -> BuildingTable:
    rng = np.random.default_rng(seed)
    length = rng.uniform(4, 60, count)
    width = length * rng.uniform(0.3, 1.0, count)
    first = rng.integers(0, 8, count)
    height = rng.uniform(3, 40, (count, 8)) * (np.arange(8)[None, :] >= first[:, None])
    return BuildingTable(
        x=rng.uniform(7680, 7680 + 3840, count),
        y=rng.uniform(3840, 3840 + 3840, count),
        length=length,
        width=width,
        angle=rng.uniform(0, np.pi, count),
        first=first,
        height=height,
        area=length * width,
    )


def test_building_tile_round_trip_within_its_units() -> None:
    table = sample_table(500)
    years = list(range(2016, 2024))
    packed = pack_tile(table, (7680.0, 3840.0), years)
    restored = unpack_tile(Container.from_bytes(packed.to_bytes()))

    order = np.argsort(-table.area, kind="stable")  # stored largest first
    # Areas fall from first to last, up to rounding of the two sides to 0.1 m.
    assert np.all(np.diff(restored.area) <= 8.0)
    assert np.abs(restored.x - table.x[order]).max() <= LENGTH_UNIT / 2 + 1e-9
    assert np.abs(restored.y - table.y[order]).max() <= LENGTH_UNIT / 2 + 1e-9
    assert np.abs(restored.length - table.length[order]).max() <= LENGTH_UNIT / 2 + 1e-9
    assert np.abs(restored.width - table.width[order]).max() <= LENGTH_UNIT / 2 + 1e-9
    assert np.abs(restored.height - table.height[order]).max() <= HEIGHT_UNIT / 2 + 1e-9
    assert np.array_equal(restored.first, table.first[order])
    # Angles wrap at 180 degrees: compare as directions.
    turn = np.abs(restored.angle - table.angle[order])
    assert np.minimum(turn, np.pi - turn).max() <= np.pi / 256 / 2 + 1e-9
    assert packed.meta["count"] == 500 and packed.meta["years"] == years


def test_empty_building_tile_packs() -> None:
    empty = sample_table(0)
    restored = unpack_tile(Container.from_bytes(pack_tile(empty, (0.0, 0.0), [2016]).to_bytes()))
    assert len(restored) == 0


def test_tile_index_counts_rows_from_the_south() -> None:
    grid = Grid("t", 0.0, 2 * TILE_SIZE, 30.0, 256, 256)
    table = sample_table(4)
    table.x[:] = [10.0, TILE_SIZE + 10, 10.0, 2 * TILE_SIZE - 1]
    table.y[:] = [10.0, 10.0, TILE_SIZE + 10, 2 * TILE_SIZE - 1]
    col, row = tile_index(table, grid)
    assert col.tolist() == [0, 1, 0, 1] and row.tolist() == [0, 0, 1, 1]


def test_yearly_totals_accumulate() -> None:
    first = np.array([0, 0, 2, 7, -1])
    area = np.array([100.0, 50.0, 200.0, 1000.0, 9999.0])
    totals = yearly_totals(first, area, list(range(2016, 2024)))
    assert [t["buildings"] for t in totals] == [2, 2, 3, 3, 3, 3, 3, 4]
    assert totals[0]["footprintKm2"] == 0.0 and totals[-1]["footprintKm2"] == 0.001
    assert totals[-1]["year"] == 2023
