"""Buildings: when each footprint first appears, and how tall it is each year.

Shapes come from Open Buildings v3 footprints (high-resolution imagery, one
snapshot). Time comes from Open Buildings 2.5D Temporal (annual rasters from
Sentinel-2, 2016 to 2023). This module joins the two:

1. Every footprint is burned onto the Kigali 4 m grid.
2. For each year, the building-presence raster is averaged over the
   footprint's cells, and the height raster is averaged with presence as the
   weight (the publisher says height is only meaningful where presence is
   high). Footprints too small to cover a cell centre are sampled at their
   centroid instead.
3. A footprint's first year is the earliest year from which it is present
   and stays present in at least three quarters of the years that follow
   (see `first_year_index`). Footprints that never qualify are left out
   and counted.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
import shapely
from rasterio.features import rasterize
from rasterio.transform import Affine
from scipy import ndimage

from .grid import Grid

#: A footprint counts as present in a year when its mean presence reaches this.
PRESENCE_THRESHOLD = 0.5
#: From its first year on, a building must be present in at least this share of years.
MIN_PRESENT_SHARE = 0.75
#: Heights are clamped to this range in metres. The publisher caps heights at 100 m.
MIN_HEIGHT, MAX_HEIGHT = 2.5, 100.0


def burn_labels(polygons: np.ndarray, grid: Grid) -> np.ndarray:
    """Raster of footprint numbers (index + 1; 0 where there is no footprint).

    A cell belongs to a footprint when the cell centre is inside it. Where
    footprints overlap, the smaller one keeps the cell.
    """
    order = np.argsort(-shapely.area(polygons), kind="stable")
    shapes = ((polygons[index], int(index) + 1) for index in order)
    return rasterize(
        shapes,
        out_shape=grid.shape,
        transform=Affine(*grid.affine),
        fill=0,
        dtype="int32",
        all_touched=False,
    )


def zonal_sums(labels: np.ndarray, count: int, values: np.ndarray) -> np.ndarray:
    """Sum of `values` over each footprint's cells. NaN cells count as zero."""
    flat = np.nan_to_num(values, nan=0.0).ravel().astype(np.float64)
    return np.bincount(labels.ravel(), weights=flat, minlength=count + 1)[1:]


def sample_at(values: np.ndarray, grid: Grid, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Bilinear sample of a raster at local coordinates."""
    row, col = grid.cell_of(x, y)
    return ndimage.map_coordinates(
        np.nan_to_num(values, nan=0.0), [row - 0.5, col - 0.5], order=1, mode="nearest"
    )


@dataclass
class YearSeries:
    """Per footprint and year: mean presence, and presence-weighted mean height."""

    presence: np.ndarray  # (n, years), 0..1
    height: np.ndarray  # (n, years), metres
    cells: np.ndarray  # (n,), number of 4 m cells the footprint covers


def measure_year(
    labels: np.ndarray,
    cells: np.ndarray,
    grid: Grid,
    x: np.ndarray,
    y: np.ndarray,
    presence: np.ndarray,
    height: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Presence and height of every footprint for one year's rasters."""
    count = len(cells)
    presence_sum = zonal_sums(labels, count, presence)
    weighted_height = zonal_sums(labels, count, height * presence)
    covered = cells > 0
    mean_presence = np.zeros(count)
    mean_height = np.zeros(count)
    mean_presence[covered] = presence_sum[covered] / cells[covered]
    has_weight = presence_sum > 1e-6
    mean_height[has_weight] = weighted_height[has_weight] / presence_sum[has_weight]
    # Footprints smaller than a cell: sample the rasters at the centroid.
    tiny = ~covered
    if tiny.any():
        mean_presence[tiny] = sample_at(presence, grid, x[tiny], y[tiny])
        mean_height[tiny] = sample_at(height, grid, x[tiny], y[tiny])
    return mean_presence, mean_height


def first_year_index(
    presence: np.ndarray,
    threshold: float = PRESENCE_THRESHOLD,
    min_share: float = MIN_PRESENT_SHARE,
) -> np.ndarray:
    """Index of the first year each building is there to stay; -1 if never.

    `presence` is (n, years). A building's first year is the earliest year in
    which it is present (presence >= threshold) and it is also present in at
    least `min_share` of the years from then to the end of the record. The
    share rule ignores a single-year dropout (cloud, misalignment) in a long
    run, and rejects an isolated early detection followed by years of absence.
    """
    present = presence >= threshold
    years = present.shape[1]
    # share[:, y] = fraction of years y..end in which the building is present
    remaining = np.cumsum(present[:, ::-1], axis=1)[:, ::-1]
    share = remaining / (years - np.arange(years))
    qualifies = present & (share >= min_share)
    first = np.argmax(qualifies, axis=1)
    first[~qualifies.any(axis=1)] = -1
    return first


def settle_heights(height: np.ndarray, first: np.ndarray) -> np.ndarray:
    """Per-year heights with year-to-year noise removed; zero before the first year.

    Each year takes the median of itself and its neighbours among the years
    the building exists, so one odd year does not make a building twitch as
    the slider moves, while real growth over several years is kept.
    """
    count, years = height.shape
    index = np.arange(years)[None, :]
    exists = (first[:, None] >= 0) & (index >= first[:, None])
    padded = np.where(exists, height, np.nan)
    stack = np.stack(
        [
            np.concatenate([np.full((count, 1), np.nan), padded[:, :-1]], axis=1),
            padded,
            np.concatenate([padded[:, 1:], np.full((count, 1), np.nan)], axis=1),
        ]
    )
    with warnings.catch_warnings():
        # Years before a building exists are all-NaN on purpose.
        warnings.simplefilter("ignore", RuntimeWarning)
        smooth = np.nanmedian(stack, axis=0)
    smooth = np.clip(np.nan_to_num(smooth, nan=0.0), MIN_HEIGHT, MAX_HEIGHT)
    return np.where(exists, smooth, 0.0)
