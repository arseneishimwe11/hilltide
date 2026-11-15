import numpy as np

from hilltide_pipeline.flow import (
    NO_FLOW,
    accumulate,
    fill_depressions,
    flow_accumulation,
    flow_directions,
)


def test_filling_removes_a_pit_and_keeps_everything_else() -> None:
    heights = np.full((7, 7), 10.0)
    heights[3, 3] = 2.0  # a pit in a plateau
    heights[0, :] = 5.0  # a lower northern edge to drain to
    filled = fill_depressions(heights)
    assert filled[3, 3] > 10.0  # raised to spill level, plus the tiny slope
    assert filled[3, 3] < 10.01
    assert np.array_equal(filled[0], heights[0])
    assert (filled >= heights).all()


def test_filled_surface_always_drains_to_the_edge() -> None:
    rng = np.random.default_rng(7)
    heights = rng.uniform(0, 100, (40, 50))  # rough terrain full of pits
    filled = fill_depressions(heights)
    direction = flow_directions(filled)
    interior = direction[1:-1, 1:-1]
    assert (interior != NO_FLOW).all()  # no interior cell is stuck
    # Total water arriving at cells that leave the grid equals the number of cells.
    accumulation = flow_accumulation(filled, direction)
    assert accumulation[direction == NO_FLOW].sum() == heights.size


def test_tilted_plane_flows_straight_downhill() -> None:
    rows, cols = 6, 5
    heights = np.repeat(np.arange(rows, 0, -1.0)[:, None], cols, axis=1)  # falls to the south
    accumulation = accumulate(heights)
    # Each column is its own flow line: 1 at the top, growing by one per row.
    assert accumulation[:, 2].tolist() == [1, 2, 3, 4, 5, 6]


def test_valley_collects_both_slopes() -> None:
    cols = 9
    profile = np.abs(np.arange(cols) - 4.0)  # V shape, lowest in the middle column
    heights = profile[None, :] + np.arange(12, 0, -1.0)[:, None] * 0.1  # gently down to the south
    accumulation = accumulate(heights)
    valley = accumulation[:, 4]
    assert np.all(np.diff(valley) > 0)  # the stream grows downstream
    assert valley[-1] > 0.7 * heights.size  # most of the grid drains through the outlet
    assert accumulation[:, 0].max() <= 2  # ridge-side cells collect almost nothing


def test_accumulation_counts_every_cell_once() -> None:
    rng = np.random.default_rng(11)
    y, x = np.mgrid[0:30, 0:30]
    heights = 50 + 10 * np.sin(x / 4.0) * np.cos(y / 5.0) + rng.normal(0, 0.2, (30, 30))
    filled = fill_depressions(heights)
    direction = flow_directions(filled)
    accumulation = flow_accumulation(filled, direction)
    assert accumulation.min() == 1
    assert accumulation[direction == NO_FLOW].sum() == heights.size
