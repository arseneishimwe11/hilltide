"""Where water would run on a terrain grid: depression filling and flow accumulation.

Written here rather than taken from a library because the usual choices
(pysheds, richdem) are GPL. Two classic steps:

1. Priority-flood filling (Barnes, Lehman and Mulla, 2014). Every pit is
   raised just enough to drain to the grid edge, with a tiny added slope so
   that filled flats still have a downhill direction.
2. D8 flow accumulation (O'Callaghan and Mark, 1984). Each cell passes its
   water to its steepest downhill neighbour; a cell's accumulation is the
   number of cells that drain through it, itself included.

This is a geometric reference for the validation, independent of the
shallow-water simulation.
"""

from __future__ import annotations

import heapq

import numpy as np

#: Neighbour offsets (row, col) and their distances in cells, D8 order.
NEIGHBOURS = ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))
DISTANCES = (1.0, 2**0.5, 1.0, 2**0.5, 1.0, 2**0.5, 1.0, 2**0.5)
#: Direction code of a cell that drains off the grid or has nowhere to go.
NO_FLOW = -1


def fill_depressions(heights: np.ndarray, epsilon: float = 1e-3) -> np.ndarray:
    """Raise pits so every cell can drain to the edge of the grid.

    Cells are visited from the edge inward, lowest first. A cell lower than
    the cell it is reached from is raised to that cell's level plus
    `epsilon` metres, so water on the filled surface always has a way down.
    """
    rows, cols = heights.shape
    filled = heights.astype(np.float64).copy()
    done = np.zeros((rows, cols), dtype=bool)
    queue: list[tuple[float, int, int]] = []
    for row in range(rows):
        for col in (0, cols - 1) if 0 < row < rows - 1 else range(cols):
            queue.append((filled[row, col], row, col))
            done[row, col] = True
    heapq.heapify(queue)
    while queue:
        level, row, col = heapq.heappop(queue)
        for d_row, d_col in NEIGHBOURS:
            n_row, n_col = row + d_row, col + d_col
            if 0 <= n_row < rows and 0 <= n_col < cols and not done[n_row, n_col]:
                done[n_row, n_col] = True
                if filled[n_row, n_col] <= level:
                    filled[n_row, n_col] = level + epsilon
                heapq.heappush(queue, (filled[n_row, n_col], n_row, n_col))
    return filled


def flow_directions(filled: np.ndarray) -> np.ndarray:
    """Index into NEIGHBOURS of each cell's steepest downhill neighbour, or NO_FLOW.

    Edge cells with no lower neighbour inside the grid drain off it.
    """
    rows, cols = filled.shape
    padded = np.pad(filled, 1, mode="constant", constant_values=np.inf)
    best_drop = np.zeros((rows, cols))
    direction = np.full((rows, cols), NO_FLOW, dtype=np.int8)
    for index, ((d_row, d_col), distance) in enumerate(zip(NEIGHBOURS, DISTANCES, strict=True)):
        neighbour = padded[1 + d_row : 1 + d_row + rows, 1 + d_col : 1 + d_col + cols]
        drop = (filled - neighbour) / distance
        better = drop > best_drop
        best_drop[better] = drop[better]
        direction[better] = index
    return direction


def flow_accumulation(filled: np.ndarray, direction: np.ndarray) -> np.ndarray:
    """Number of cells draining through each cell, itself included."""
    rows, cols = filled.shape
    accumulation = np.ones(rows * cols, dtype=np.float64)
    flat_direction = direction.ravel()
    offsets = np.array([d_row * cols + d_col for d_row, d_col in NEIGHBOURS])
    # From the highest cell to the lowest, every cell's total is final before it is passed on.
    order = np.argsort(-filled.ravel(), kind="stable")
    targets = np.where(flat_direction >= 0, np.arange(rows * cols) + offsets[flat_direction], -1)
    for cell in order.tolist():
        target = targets[cell]
        if target >= 0:
            accumulation[target] += accumulation[cell]
    return accumulation.reshape(rows, cols)


def accumulate(heights: np.ndarray, epsilon: float = 1e-3) -> np.ndarray:
    """Flow accumulation in cells for a terrain grid (fill, direct, accumulate)."""
    filled = fill_depressions(heights, epsilon)
    return flow_accumulation(filled, flow_directions(filled))
