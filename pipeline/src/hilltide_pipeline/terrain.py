"""Terrain: Copernicus DEM tiles resampled onto the Hilltide grids."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.transform import Affine
from rasterio.warp import reproject

from .download import SourceLog, fetch
from .grid import Grid, local_crs

#: Public Copernicus DEM buckets (Cloud-Optimized GeoTIFF, one-degree tiles).
BUCKETS = {
    30: ("https://copernicus-dem-30m.s3.amazonaws.com", 10),
    90: ("https://copernicus-dem-90m.s3.amazonaws.com", 30),
}


def tile_name(resolution: int, lat: int, lon: int) -> str:
    """Name of the tile whose south-west corner is at (lat, lon) whole degrees."""
    arcsec = BUCKETS[resolution][1]
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"Copernicus_DSM_COG_{arcsec}_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"


def tiles_for(bounds: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """South-west corners (lat, lon) of the one-degree tiles covering a lon/lat box."""
    west, south, east, north = bounds
    return [
        (lat, lon)
        for lat in range(math.floor(south), math.ceil(north))
        for lon in range(math.floor(west), math.ceil(east))
    ]


def download_tiles(grid: Grid, resolution: int, raw_dir: Path, log: SourceLog) -> list[Path]:
    base = BUCKETS[resolution][0]
    paths = []
    for lat, lon in tiles_for(grid.lonlat_bounds(margin_deg=0.02)):
        name = tile_name(resolution, lat, lon)
        paths.append(
            fetch(f"{base}/{name}/{name}.tif", f"dem{resolution}/{name}.tif", raw_dir, log)
        )
    return paths


def resample_to_grid(
    tiles: list[Path], grid: Grid, resampling: Resampling = Resampling.bilinear
) -> tuple[np.ndarray, int]:
    """Mosaic and reproject DEM tiles onto a grid.

    The tiles are first joined into one raster and then resampled once, so
    interpolation works across tile edges and leaves no seam. (The 30 degree
    east tile edge runs straight through Kigali.)

    Returns heights in metres (float32) and the number of cells that had no
    data in any tile and were filled from their neighbours.
    """
    sources = [rasterio.open(path) for path in tiles]
    try:
        west, south, east, north = grid.lonlat_bounds(margin_deg=0.02)
        covered = (
            max(west, min(s.bounds.left for s in sources)),
            max(south, min(s.bounds.bottom for s in sources)),
            min(east, max(s.bounds.right for s in sources)),
            min(north, max(s.bounds.top for s in sources)),
        )
        mosaic, transform = merge(sources, bounds=covered, nodata=np.nan, dtype="float32")
        crs = sources[0].crs
    finally:
        for source in sources:
            source.close()

    out = np.full(grid.shape, np.nan, dtype=np.float32)
    reproject(
        source=mosaic[0],
        destination=out,
        src_transform=transform,
        src_crs=crs,
        src_nodata=np.nan,
        dst_transform=Affine(*grid.affine),
        dst_crs=local_crs(),
        dst_nodata=np.nan,
        resampling=resampling,
    )
    voids = int(np.isnan(out).sum())
    if voids:
        out = fill_voids(out)
    return out, voids


def fill_voids(heights: np.ndarray) -> np.ndarray:
    """Fill missing cells with the value of the nearest valid cell."""
    from scipy import ndimage

    missing = np.isnan(heights)
    if missing.all():
        raise ValueError("No terrain data at all for this grid")
    nearest = ndimage.distance_transform_edt(missing, return_distances=False, return_indices=True)
    return heights[tuple(nearest)]
