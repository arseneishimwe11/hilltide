"""Land cover: ESA WorldCover resampled onto the Hilltide grids.

Used for three things: where the lakes are (the OSM extract stops at the
border and cuts Lake Kivu), a gentle tint for the terrain, and which cells
are built-up or wetland for the water simulation's infiltration.

Class codes are WorldCover's own, divided by ten:
1 tree cover, 2 shrubland, 3 grassland, 4 cropland, 5 built-up,
6 bare or sparse, 7 snow and ice, 8 permanent water, 9 herbaceous wetland,
10 moss and lichen (WorldCover 95 mangroves and 100 are both mapped to 10).
"""

from __future__ import annotations

import math
import os

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject

from .container import Container
from .grid import Grid, local_crs

BUCKET = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
KIND = "landcover"
VERSION = 1
CLASS_NAMES = {
    1: "tree cover",
    2: "shrubland",
    3: "grassland",
    4: "cropland",
    5: "built-up",
    6: "bare or sparse vegetation",
    7: "snow and ice",
    8: "permanent water",
    9: "herbaceous wetland",
    10: "moss, lichen or mangrove",
}
WATER = 8


def tile_url(lat: int, lon: int) -> str:
    """URL of the 3 x 3 degree tile whose south-west corner is (lat, lon)."""
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{BUCKET}/ESA_WorldCover_10m_2021_v200_{ns}{abs(lat):02d}{ew}{abs(lon):03d}_Map.tif"


def tiles_for(bounds: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    west, south, east, north = bounds
    return [
        (lat, lon)
        for lat in range(3 * math.floor(south / 3), math.ceil(north), 3)
        for lon in range(3 * math.floor(west / 3), math.ceil(east), 3)
    ]


def overview_for(cell: float, source_pixel: float = 10.0) -> int | None:
    """Overview level (0 = half resolution) to read for a target cell size, or None for full."""
    level = math.floor(math.log2(max(cell / source_pixel, 1.0))) - 1
    return level if level >= 0 else None


def resample_to_grid(grid: Grid) -> np.ndarray:
    """Most common land-cover class in each grid cell, read straight from the public bucket."""
    out = np.zeros(grid.shape, dtype=np.uint8)
    env = rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_MAX_RETRY="6",
        GDAL_HTTP_RETRY_DELAY="3",
        AWS_NO_SIGN_REQUEST="YES",
        CURL_CA_BUNDLE=os.environ.get("CURL_CA_BUNDLE", ""),
    )
    level = overview_for(grid.cell)
    options = {} if level is None else {"overview_level": level}
    with env:
        for lat, lon in tiles_for(grid.lonlat_bounds(margin_deg=0.01)):
            with rasterio.open(f"/vsicurl/{tile_url(lat, lon)}", **options) as source:
                layer = np.zeros(grid.shape, dtype=np.uint8)
                reproject(
                    source=rasterio.band(source, 1),
                    destination=layer,
                    dst_transform=Affine(*grid.affine),
                    dst_crs=local_crs(),
                    src_nodata=0,
                    dst_nodata=0,
                    resampling=Resampling.mode,
                )
            out[out == 0] = layer[out == 0]
    return simplify_classes(out)


def simplify_classes(worldcover: np.ndarray) -> np.ndarray:
    """WorldCover codes (10, 20, ... 100, 95) to 1..10; 0 stays 'no data'."""
    classes = (worldcover // 10).astype(np.uint8)
    classes[worldcover == 95] = 10
    return classes


def pack_landcover(classes: np.ndarray, grid: Grid) -> Container:
    if classes.shape != grid.shape:
        raise ValueError(f"Land cover is {classes.shape}, grid {grid.name} is {grid.shape}")
    counts = np.bincount(classes.ravel(), minlength=11)
    meta = {
        "grid": grid.describe(),
        "classes": {str(code): name for code, name in CLASS_NAMES.items()},
        "share": {str(code): round(float(counts[code]) / classes.size, 5) for code in range(11)},
        "source": "ESA WorldCover 10 m 2021 v200",
    }
    return Container(KIND, VERSION, meta).add("classes", classes.astype(np.uint8).ravel())


def unpack_landcover(container: Container) -> tuple[np.ndarray, dict]:
    grid = container.meta["grid"]
    return container.section("classes").data.reshape(grid["height"], grid["width"]), container.meta
