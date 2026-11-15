"""Pipeline steps: each turns raw source data into web assets and manifest records."""

from __future__ import annotations

from collections.abc import Callable

from rasterio.enums import Resampling

from . import terrain
from .download import SourceLog
from .grid import COUNTRY, KIGALI, REGION
from .heights import KIND as HEIGHTS_KIND
from .heights import VERSION as HEIGHTS_VERSION
from .heights import pack_heights
from .manifest import AssetRecord, update_manifest
from .paths import Paths
from .sources import SOURCES

Log = Callable[[str], None]

#: (grid, DEM resolution in metres, height step in metres)
TERRAIN_LEVELS = [(COUNTRY, 90, 0.5), (REGION, 90, 0.25), (KIGALI, 30, 0.05)]


def build_terrain(paths: Paths, say: Log = print) -> list[AssetRecord]:
    log = SourceLog(paths.raw)
    records = []
    for grid, resolution, step in TERRAIN_LEVELS:
        say(f"terrain {grid.name}: fetching GLO-{resolution} tiles")
        tiles = terrain.download_tiles(grid, resolution, paths.raw, log)
        # Average when shrinking (country level), so peaks and valleys are not aliased.
        method = Resampling.average if grid.cell > 1.5 * resolution else Resampling.bilinear
        heights, voids = terrain.resample_to_grid(tiles, grid, method)
        container = pack_heights(heights, grid, step, source=f"Copernicus DEM GLO-{resolution}")
        relative = f"terrain/{grid.name}.hlt"
        size = container.write(paths.web_data / relative)
        say(
            f"terrain {grid.name}: {grid.width}x{grid.height} at {grid.cell:g} m, "
            f"{heights.min():.0f} to {heights.max():.0f} m, {voids} voids filled, "
            f"{size / 1e6:.2f} MB"
        )
        records.append(
            AssetRecord(
                key=f"terrain.{grid.name}",
                path=relative,
                kind=HEIGHTS_KIND,
                version=HEIGHTS_VERSION,
                sources=["copernicus-dem"],
                info={**container.meta, "demResolution": resolution, "voidsFilled": voids},
            )
        )
    update_manifest(
        paths.manifest,
        records,
        {"copernicus-dem": SOURCES["copernicus-dem"]},
        remove_prefix="terrain.",
    )
    return records


STEPS: dict[str, Callable[[Paths, Log], list[AssetRecord]]] = {
    "terrain": build_terrain,
}
