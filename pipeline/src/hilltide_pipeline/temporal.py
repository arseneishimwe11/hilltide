"""Open Buildings 2.5D Temporal: annual building rasters, 2016 to 2023.

The published rasters are 0.5 m GeoTIFFs of about 800 MB each, in UTM, with
three bands: fractional building count, height above ground, and building
presence (an uncalibrated confidence from 0 to 1). Their effective
resolution is about 4 m, so this module reads the 4 m overview level of
each file over HTTP (a few megabytes per tile instead of 800), caches those
reads in the raw data folder, and mosaics them onto the Kigali 4 m grid.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject
from rasterio.windows import Window

from .download import SourceLog, fetch
from .grid import LOCAL_PROJ, Grid, local_crs

BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data/v1"
YEARS = tuple(range(2016, 2024))
#: (S2 cell token, UTM EPSG code) of the published mosaics that cover Kigali.
#: The city sits on the 30 degree east line, the border of UTM zones 35 and 36.
KIGALI_MOSAICS = (("19", 32735), ("19", 32736))
#: Read every 8th pixel block: 0.5 m files at their 4 m effective resolution.
FACTOR = 8
NODATA = -99.0
BANDS = ("building_fractional_count", "building_height", "building_presence")


@dataclass(frozen=True)
class TileRef:
    """One published GeoTIFF: where it is and what ground it covers."""

    url: str
    epsg: int
    x_min: float
    y_max: float
    pixel: float
    width: int
    height: int

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return (
            self.x_min,
            self.y_max - self.height * self.pixel,
            self.x_min + self.width * self.pixel,
            self.y_max,
        )

    @property
    def name(self) -> str:
        folder, file = self.url.rsplit("/", 2)[-2:]
        return f"{folder}__{file}"


def manifest_url(token: str, epsg: int, year: int) -> str:
    return f"{BUCKET}/manifests/{token}_EPSG_{epsg}_{year}_06_30.json"


def parse_manifest(manifest: dict) -> list[TileRef]:
    """Tile list from one published mosaic manifest (Earth Engine upload format)."""
    prefix = manifest["uriPrefix"].replace("gs://open-buildings-temporal-data/v1", BUCKET)
    tileset = manifest["tilesets"][0]
    epsg = int(tileset["crs"].split(":")[1])
    tiles = []
    for source in tileset["sources"]:
        affine = source["affineTransform"]
        if affine["scaleX"] != -affine["scaleY"]:
            raise ValueError("Expected square, north-up pixels")
        tiles.append(
            TileRef(
                url=prefix + source["uris"][0],
                epsg=epsg,
                x_min=affine["translateX"],
                y_max=affine["translateY"],
                pixel=affine["scaleX"],
                width=source["dimensions"]["width"],
                height=source["dimensions"]["height"],
            )
        )
    return tiles


def grid_bounds_in(grid: Grid, epsg: int, margin: float = 0.0) -> tuple[float, float, float, float]:
    """The grid's bounding box in another projected CRS (x_min, y_min, x_max, y_max)."""
    transformer = Transformer.from_crs(LOCAL_PROJ, f"EPSG:{epsg}", always_xy=True)
    xs = np.linspace(grid.x_min, grid.x_max, 33)
    ys = np.linspace(grid.y_min, grid.y_max, 33)
    edge_x = np.concatenate([xs, xs, np.full(33, grid.x_min), np.full(33, grid.x_max)])
    edge_y = np.concatenate([np.full(33, grid.y_min), np.full(33, grid.y_max), ys, ys])
    x, y = transformer.transform(edge_x, edge_y)
    return (x.min() - margin, y.min() - margin, x.max() + margin, y.max() + margin)


def overlap_window(tile: TileRef, bounds: tuple[float, float, float, float]) -> Window | None:
    """The part of a tile inside `bounds`, as a pixel window aligned to FACTOR pixels."""
    x_min, y_min, x_max, y_max = bounds
    tx_min, ty_min, tx_max, ty_max = tile.bounds
    if x_max <= tx_min or x_min >= tx_max or y_max <= ty_min or y_min >= ty_max:
        return None
    col0 = int(np.floor((max(x_min, tx_min) - tile.x_min) / tile.pixel / FACTOR)) * FACTOR
    col1 = int(np.ceil((min(x_max, tx_max) - tile.x_min) / tile.pixel / FACTOR)) * FACTOR
    row0 = int(np.floor((tile.y_max - min(y_max, ty_max)) / tile.pixel / FACTOR)) * FACTOR
    row1 = int(np.ceil((tile.y_max - max(y_min, ty_min)) / tile.pixel / FACTOR)) * FACTOR
    col1, row1 = min(col1, tile.width), min(row1, tile.height)
    if col1 - col0 < FACTOR or row1 - row0 < FACTOR:
        return None
    return Window(col0, row0, col1 - col0, row1 - row0)


def _remote_env() -> rasterio.Env:
    return rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_MAX_RETRY="6",
        GDAL_HTTP_RETRY_DELAY="3",
        GDAL_HTTP_MULTIPLEX="YES",
        VSI_CACHE="TRUE",
        CURL_CA_BUNDLE=os.environ.get("CURL_CA_BUNDLE", ""),
    )


def cache_tile(tile: TileRef, window: Window, target: Path) -> None:
    """Read one tile window at 4 m over HTTP and store it as a small local GeoTIFF."""
    out_shape = (len(BANDS), window.height // FACTOR, window.width // FACTOR)
    with _remote_env(), rasterio.open(f"/vsicurl/{tile.url}") as source:
        if source.descriptions != BANDS:
            raise ValueError(f"Unexpected bands in {tile.url}: {source.descriptions}")
        data = source.read(window=window, out_shape=out_shape, resampling=Resampling.nearest)
    transform = Affine(
        tile.pixel * FACTOR,
        0.0,
        tile.x_min + window.col_off * tile.pixel,
        0.0,
        -tile.pixel * FACTOR,
        tile.y_max - window.row_off * tile.pixel,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    with rasterio.open(
        partial,
        "w",
        driver="GTiff",
        width=out_shape[2],
        height=out_shape[1],
        count=len(BANDS),
        dtype="float32",
        crs=f"EPSG:{tile.epsg}",
        transform=transform,
        nodata=NODATA,
        compress="deflate",
        predictor=3,
        tiled=True,
    ) as dst:
        dst.write(data)
        dst.descriptions = BANDS
    partial.replace(target)


def cache_year(year: int, grid: Grid, raw_dir: Path, log: SourceLog) -> list[Path]:
    """Make sure every tile window covering the grid for one year is in the cache."""
    cached = []
    for token, epsg in KIGALI_MOSAICS:
        manifest_name = f"temporal/manifests/{token}_EPSG_{epsg}_{year}.json"
        manifest_path = fetch(manifest_url(token, epsg, year), manifest_name, raw_dir, log)
        tiles = parse_manifest(json.loads(manifest_path.read_text()))
        bounds = grid_bounds_in(grid, epsg, margin=64.0)
        for tile in tiles:
            window = overlap_window(tile, bounds)
            if window is None:
                continue
            # The window is part of the name, so a changed grid is fetched afresh.
            span = f"{window.col_off}_{window.row_off}_{window.width}_{window.height}"
            relative = f"temporal/{year}/{tile.name.removesuffix('.tif')}__{span}.tif"
            target = raw_dir / relative
            if not (target.is_file() and log.get(relative)):
                cache_tile(tile, window, target)
                log.record(
                    relative, tile.url, target, note="4 m overview window, not the full file"
                )
            cached.append(target)
    return cached


@dataclass
class YearRasters:
    """One year on the Kigali 4 m grid. NaN marks cells with no data."""

    presence: np.ndarray
    height: np.ndarray
    count: np.ndarray


def mosaic_year(tiles: list[Path], grid: Grid) -> YearRasters:
    """Reproject cached tile windows onto the grid; the first tile with data wins."""
    layers = {band: np.full(grid.shape, np.nan, dtype=np.float32) for band in BANDS}
    for path in sorted(tiles):
        with rasterio.open(path) as source:
            for index, band in enumerate(BANDS, start=1):
                layer = np.full(grid.shape, np.nan, dtype=np.float32)
                reproject(
                    source=rasterio.band(source, index),
                    destination=layer,
                    dst_transform=Affine(*grid.affine),
                    dst_crs=local_crs(),
                    dst_nodata=np.nan,
                    resampling=Resampling.bilinear,
                )
                missing = np.isnan(layers[band])
                layers[band][missing] = layer[missing]
    return YearRasters(
        presence=layers["building_presence"],
        height=layers["building_height"],
        count=layers["building_fractional_count"],
    )


def load_year(year: int, grid: Grid, raw_dir: Path, work_dir: Path, log: SourceLog) -> YearRasters:
    """One year's rasters on the grid, built once and kept in the work folder."""
    extent = f"{grid.x_min:.0f}_{grid.y_max:.0f}_{grid.width}x{grid.height}"
    saved = work_dir / "temporal" / f"{grid.name}_{extent}_{year}.npz"
    if saved.is_file():
        with np.load(saved) as data:
            return YearRasters(data["presence"], data["height"], data["count"])
    rasters = mosaic_year(cache_year(year, grid, raw_dir, log), grid)
    saved.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        saved, presence=rasters.presence, height=rasters.height, count=rasters.count
    )
    return rasters
