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
3. Small buildings are blurred in the Sentinel-2 based rasters: a 40 m2 house
   never reaches the presence of a warehouse. So each footprint is judged
   against its own final level (`relative_presence`): it counts as present
   in a year when its presence is at least half of what it is at the end of
   the record. Comparing 2016 with 2023 this way splits Kigali's footprints
   into two clear groups, one near 0 (built since) and one near 1 (already
   there), with few in between.
4. A footprint's first year is the earliest year from which it is present
   and stays present in at least three quarters of the years that follow
   (`first_year_index`).
5. Footprints the rasters barely see at the end of the record cannot be
   dated. They are left out and counted.
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

#: A footprint counts as present in a year when its presence reaches this share
#: of its own final level.
PRESENCE_THRESHOLD = 0.5
#: From its first year on, a building must be present in at least this share of years.
MIN_PRESENT_SHARE = 0.75
#: Final presence below this is too close to the rasters' year-to-year noise
#: (standard deviation about 0.12) to date a building from.
MIN_FINAL_PRESENCE = 0.2
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


def relative_presence(
    presence: np.ndarray, min_final: float = MIN_FINAL_PRESENCE
) -> tuple[np.ndarray, np.ndarray]:
    """Presence of each building as a share of its own final level.

    `presence` is (n, years). The final level is the larger of the last two
    years, so a building finished in the last year is measured against that
    year, and one noisy final year does not lower the bar for the rest.

    Returns (relative presence, datable). Where the final level is below
    `min_final` the building cannot be dated: its row is all zeros and
    `datable` is False.
    """
    final = presence[:, -2:].max(axis=1)
    datable = final >= min_final
    relative = np.zeros_like(presence, dtype=np.float64)
    relative[datable] = presence[datable] / final[datable, None]
    return relative, datable


def first_year_index(
    presence: np.ndarray,
    threshold: float = PRESENCE_THRESHOLD,
    min_share: float = MIN_PRESENT_SHARE,
) -> np.ndarray:
    """Index of the first year each building is there to stay; -1 if never.

    `presence` is (n, years), normally the output of `relative_presence`. A
    building's first year is the earliest year in which it is present
    (presence >= threshold) and it is also present in at
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


def threshold_sensitivity(
    relative: np.ndarray, selected: np.ndarray, thresholds: tuple[float, ...]
) -> list[dict]:
    """How the first-year and last-year counts move with the presence threshold.

    `relative` is the output of `relative_presence`; `selected` marks the
    buildings to count (for example those inside the city boundary). The
    dating rule uses one threshold; this shows how much the result depends
    on that choice.
    """
    rows = []
    for threshold in thresholds:
        first = first_year_index(relative, threshold)
        dated = (first >= 0) & selected
        at_start = int(((first == 0) & selected).sum())
        at_end = int(dated.sum())
        rows.append(
            {
                "threshold": threshold,
                "firstYearCount": at_start,
                "lastYearCount": at_end,
                "growthPercent": round(100 * (at_end / at_start - 1), 1) if at_start else None,
            }
        )
    return rows


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


# --- Packing ------------------------------------------------------------------

KIND = "buildings"
VERSION = 1
#: Side of one building tile in metres.
TILE_SIZE = 3840.0
#: Positions and sizes are stored in units of this many metres.
LENGTH_UNIT = 0.1
#: Heights are stored in units of this many metres.
HEIGHT_UNIT = 0.5


@dataclass
class BuildingTable:
    """One row per building, ready to pack."""

    x: np.ndarray  # centre, local metres
    y: np.ndarray
    length: np.ndarray  # long side, m
    width: np.ndarray  # short side, m
    angle: np.ndarray  # radians in [0, pi)
    first: np.ndarray  # index of the first year (0 = first year of the record)
    height: np.ndarray  # (n, years), metres, zero before the first year
    area: np.ndarray  # footprint area, m2

    def __len__(self) -> int:
        return len(self.x)

    def rows(self, keep: np.ndarray) -> BuildingTable:
        return BuildingTable(
            self.x[keep],
            self.y[keep],
            self.length[keep],
            self.width[keep],
            self.angle[keep],
            self.first[keep],
            self.height[keep],
            self.area[keep],
        )


def tile_index(table: BuildingTable, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Tile (column, row) of each building. Row 0 is the southern row."""
    col = np.floor((table.x - grid.x_min) / TILE_SIZE).astype(int)
    row = np.floor((table.y - grid.y_min) / TILE_SIZE).astype(int)
    return col, row


def pack_tile(table: BuildingTable, origin: tuple[float, float], years: list[int]):
    """Pack the buildings of one tile, largest footprint first.

    Sorting by area lets the site draw only the first N buildings of a tile
    as a cheap level of detail: the biggest ones are always included.
    """
    from .container import Container

    order = np.argsort(-table.area, kind="stable")
    part = table.rows(order)

    def units(values: np.ndarray, unit: float, limit: int) -> np.ndarray:
        return np.clip(np.rint(values / unit), 0, limit)

    container = Container(
        KIND,
        VERSION,
        {
            "origin": [origin[0], origin[1]],
            "tileSize": TILE_SIZE,
            "count": len(part),
            "years": years,
            "lengthUnit": LENGTH_UNIT,
            "heightUnit": HEIGHT_UNIT,
            "angleSteps": 256,
            "order": "footprint area, largest first",
        },
    )
    container.add("x", units(part.x - origin[0], LENGTH_UNIT, 65535).astype(np.uint16))
    container.add("y", units(part.y - origin[1], LENGTH_UNIT, 65535).astype(np.uint16))
    container.add("length", units(part.length, LENGTH_UNIT, 65535).astype(np.uint16))
    container.add("width", units(part.width, LENGTH_UNIT, 65535).astype(np.uint16))
    container.add("angle", (np.rint(part.angle / np.pi * 256) % 256).astype(np.uint8))
    container.add("first", part.first.astype(np.uint8))
    # One row of year heights per building, rows back to back.
    container.add("height", units(part.height, HEIGHT_UNIT, 255).astype(np.uint8).ravel())
    return container


def unpack_tile(container) -> BuildingTable:
    meta = container.meta
    count, years = meta["count"], len(meta["years"])

    def metres(name: str) -> np.ndarray:
        return container.section(name).data.astype(np.float64) * meta["lengthUnit"]

    length, width = metres("length"), metres("width")
    return BuildingTable(
        x=metres("x") + meta["origin"][0],
        y=metres("y") + meta["origin"][1],
        length=length,
        width=width,
        angle=container.section("angle").data.astype(np.float64) / meta["angleSteps"] * np.pi,
        first=container.section("first").data.astype(np.int64),
        height=container.section("height").data.reshape(count, years) * meta["heightUnit"],
        area=length * width,
    )


def yearly_totals(first: np.ndarray, area: np.ndarray, years: list[int]) -> list[dict]:
    """Buildings standing and their total footprint area, for each year."""
    totals = []
    for index, year in enumerate(years):
        standing = (first >= 0) & (first <= index)
        totals.append(
            {
                "year": year,
                "buildings": int(standing.sum()),
                "footprintKm2": round(float(area[standing].sum()) / 1e6, 3),
            }
        )
    return totals
