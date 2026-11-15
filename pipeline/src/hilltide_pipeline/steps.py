"""Pipeline steps: each turns raw source data into web assets and manifest records."""

from __future__ import annotations

import json
from collections.abc import Callable

from rasterio.enums import Resampling

from . import landcover, osm, terrain
from .download import SourceLog, fetch
from .grid import COUNTRY, KIGALI, REGION
from .heights import KIND as HEIGHTS_KIND
from .heights import VERSION as HEIGHTS_VERSION
from .heights import pack_heights
from .lines import KIND as LINES_KIND
from .lines import VERSION as LINES_VERSION
from .lines import pack_lines, rings_of
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


OSM_EXTRACT_URL = "https://download.openstreetmap.fr/extracts/africa/rwanda-latest.osm.pbf"
#: Place names offered to the site, per level. The site shows a restrained subset.
COUNTRY_PLACE_KINDS = {"city", "town", "peak"}
KIGALI_PLACE_KINDS = {"city", "suburb", "quarter", "neighbourhood", "peak"}


def _lines_record(
    paths: Paths, key: str, relative: str, container, sources: list[str]
) -> AssetRecord:
    container.write(paths.web_data / relative)
    return AssetRecord(
        key=key,
        path=relative,
        kind=LINES_KIND,
        version=LINES_VERSION,
        sources=sources,
        info={k: v for k, v in container.meta.items() if k != "names"},
    )


def build_osm(paths: Paths, say: Log = print) -> list[AssetRecord]:
    """Rivers and streams, the national border, the city boundary and place names."""
    log = SourceLog(paths.raw)
    extract_path = fetch(OSM_EXTRACT_URL, "osm/rwanda-latest.osm.pbf", paths.raw, log)
    extract = osm.read_extract(extract_path)
    if extract.country is None or extract.city is None:
        raise RuntimeError("The OSM extract has no Rwanda or City of Kigali boundary")
    records = []

    # Country level: named rivers only, generalised to about half a terrain cell.
    rivers = osm.clip_and_simplify(extract.waterways, COUNTRY.bounds, 120.0, {1}, 2000.0)
    container = pack_lines(
        rivers.lines, (COUNTRY.x_min, COUNTRY.y_min), rivers.kind, rivers.name,
        {"level": "country", "kinds": {"1": "river"}},
    )  # fmt: skip
    records.append(
        _lines_record(paths, "water.country", "water/country.hlt", container, ["openstreetmap"])
    )
    say(f"osm: country rivers {container.meta['lineCount']} lines, {container.meta['lengthKm']} km")

    # Kigali level: every mapped watercourse, simplified to a sixth of a terrain cell.
    streams = osm.clip_and_simplify(extract.waterways, KIGALI.bounds, 5.0, {1, 2, 3, 4}, 60.0)
    container = pack_lines(
        streams.lines, (KIGALI.x_min, KIGALI.y_min), streams.kind, streams.name,
        {"level": "kigali", "kinds": {"1": "river", "2": "stream", "3": "canal", "4": "drain"}},
    )  # fmt: skip
    records.append(
        _lines_record(paths, "water.kigali", "water/kigali.hlt", container, ["openstreetmap"])
    )
    meta = container.meta
    say(f"osm: Kigali waterways {meta['lineCount']} lines, {meta['lengthKm']} km")

    border = [ring.simplify(100.0) for ring in rings_of(extract.country)]
    container = pack_lines(
        border, (COUNTRY.x_min, COUNTRY.y_min), meta={"level": "country", "what": "Rwanda border"}
    )
    records.append(
        _lines_record(paths, "border.country", "border/rwanda.hlt", container, ["openstreetmap"])
    )
    city = [ring.simplify(15.0) for ring in rings_of(extract.city)]
    container = pack_lines(
        city, (KIGALI.x_min, KIGALI.y_min),
        meta={"level": "kigali", "what": "City of Kigali boundary",
              "areaKm2": round(extract.city.area / 1e6, 1)},
    )  # fmt: skip
    records.append(
        _lines_record(paths, "border.kigali", "border/kigali.hlt", container, ["openstreetmap"])
    )
    say(f"osm: border {len(border)} rings, city boundary {extract.city.area / 1e6:.0f} km2")

    def place_list(grid, kinds):
        chosen = [
            {
                "name": place.name,
                "kind": place.kind,
                "x": round(place.x),
                "y": round(place.y),
                **({"population": place.population} if place.population else {}),
                **({"elevation": round(place.elevation)} if place.elevation else {}),
            }
            for place in extract.places
            if place.kind in kinds and grid.contains(place.x, place.y)
        ]
        return sorted(chosen, key=lambda p: (osm.PLACE_RANK.get(p["kind"], 9), p["name"]))

    places = {
        "country": place_list(COUNTRY, COUNTRY_PLACE_KINDS),
        "kigali": place_list(KIGALI, KIGALI_PLACE_KINDS),
    }
    relative = "labels/places.json"
    target = paths.web_data / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")) + "\n")
    records.append(
        AssetRecord(
            key="labels.places",
            path=relative,
            kind="places",
            version=1,
            sources=["openstreetmap"],
            info={level: len(items) for level, items in places.items()},
        )
    )
    say(f"osm: places {len(places['country'])} country, {len(places['kigali'])} Kigali")

    for prefix in ("water.", "border.", "labels."):
        update_manifest(
            paths.manifest,
            [r for r in records if r.key.startswith(prefix)],
            {"openstreetmap": SOURCES["openstreetmap"]},
            remove_prefix=prefix,
        )
    return records


def build_landcover(paths: Paths, say: Log = print) -> list[AssetRecord]:
    records = []
    for grid in (COUNTRY, REGION, KIGALI):
        classes = landcover.resample_to_grid(grid)
        container = landcover.pack_landcover(classes, grid)
        relative = f"landcover/{grid.name}.hlt"
        size = container.write(paths.web_data / relative)
        water = container.meta["share"][str(landcover.WATER)]
        say(f"landcover {grid.name}: {size / 1e6:.2f} MB, water {water:.1%}")
        records.append(
            AssetRecord(
                key=f"landcover.{grid.name}",
                path=relative,
                kind=landcover.KIND,
                version=landcover.VERSION,
                sources=["esa-worldcover"],
                info=container.meta,
            )
        )
    update_manifest(
        paths.manifest,
        records,
        {"esa-worldcover": SOURCES["esa-worldcover"]},
        remove_prefix="landcover.",
    )
    return records


STEPS: dict[str, Callable[[Paths, Log], list[AssetRecord]]] = {
    "terrain": build_terrain,
    "osm": build_osm,
    "landcover": build_landcover,
}
