"""Pipeline steps: each turns raw source data into web assets and manifest records."""

from __future__ import annotations

import json
from collections.abc import Callable

import numpy as np
import shapely
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import Affine

from . import buildings, footprints, landcover, osm, temporal, terrain
from .download import SourceLog, fetch
from .grid import COUNTRY, KIGALI, KIGALI_4M, REGION
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


def _kigali_footprints(paths: Paths, log: SourceLog, say: Log) -> footprints.Footprints:
    """Footprints on the Kigali grid, filtered once from the published file."""
    extent = f"{KIGALI.x_min:.0f}_{KIGALI.y_max:.0f}_{KIGALI.width}x{KIGALI.height}"
    filtered = paths.work / "footprints" / f"kigali_{extent}.csv.gz"
    if not filtered.is_file():
        say("buildings: fetching the published footprint file (2.1 GB) and filtering it")
        published = fetch(
            footprints.FOOTPRINTS_URL, "footprints/19d_buildings.csv.gz", paths.raw, log
        )
        read, kept = footprints.filter_to_box(
            published, filtered, KIGALI.lonlat_bounds(margin_deg=0.001)
        )
        say(f"buildings: {read} published footprints read, {kept} near Kigali")
    return footprints.load_footprints(filtered, KIGALI)


def build_buildings(paths: Paths, say: Log = print) -> list[AssetRecord]:
    """Building tiles and yearly statistics. See buildings.py for the method."""
    log = SourceLog(paths.raw)
    years = list(temporal.YEARS)
    everything = _kigali_footprints(paths, log, say)
    by_confidence = {
        name: int((everything.confidence >= threshold).sum())
        for name, threshold in footprints.PUBLISHED_THRESHOLDS.items()
    }
    prints = everything.subset(everything.confidence >= footprints.MIN_CONFIDENCE)
    count = len(prints)
    say(f"buildings: {len(everything)} footprints on the grid, {count} at confidence >= "
        f"{footprints.MIN_CONFIDENCE}")  # fmt: skip

    labels = buildings.burn_labels(prints.polygons, KIGALI_4M)
    cells = np.bincount(labels.ravel(), minlength=count + 1)[1:]
    centroid = shapely.centroid(prints.polygons)
    x, y = shapely.get_x(centroid), shapely.get_y(centroid)

    extract = osm.read_extract(fetch(OSM_EXTRACT_URL, "osm/rwanda-latest.osm.pbf", paths.raw, log))
    if extract.city is None:
        raise RuntimeError("The OSM extract has no City of Kigali boundary")
    in_city = shapely.contains_xy(extract.city, x, y)
    city_cells = rasterize(
        [(extract.city, 1)],
        out_shape=KIGALI_4M.shape,
        transform=Affine(*KIGALI_4M.affine),
        fill=0,
        dtype="uint8",
    ).astype(bool)
    cell_km2 = KIGALI_4M.cell**2 / 1e6
    # The published rasters are 0.5 m; the 4 m overview averages 64 of those pixels.
    count_scale = (KIGALI_4M.cell / 0.5) ** 2

    presence = np.zeros((count, len(years)))
    height = np.zeros((count, len(years)))
    raster_rows = []
    for index, year in enumerate(years):
        rasters = temporal.load_year(year, KIGALI_4M, paths.raw, paths.work, log)
        presence[:, index], height[:, index] = buildings.measure_year(
            labels, cells, KIGALI_4M, x, y, rasters.presence, rasters.height
        )
        built = rasters.presence >= 0.5
        raster_rows.append(
            {
                "year": year,
                "builtKm2": round(float(built.sum()) * cell_km2, 3),
                "builtKm2City": round(float((built & city_cells).sum()) * cell_km2, 3),
                "countEstimate": round(float(np.nansum(rasters.count)) * count_scale),
                "countEstimateCity": round(
                    float(np.nansum(rasters.count[city_cells])) * count_scale
                ),
            }
        )
        say(f"buildings: measured {year}")
        del rasters, built

    relative, datable = buildings.relative_presence(presence)
    first = buildings.first_year_index(relative)
    kept = first >= 0
    settled = buildings.settle_heights(height, first)
    rectangles = footprints.oriented_rectangles(prints.polygons)
    table = buildings.BuildingTable(
        rectangles.x, rectangles.y, rectangles.length, rectangles.width, rectangles.angle,
        first, settled, shapely.area(prints.polygons),
    ).rows(kept)  # fmt: skip
    say(f"buildings: {int(kept.sum())} dated, {int((~datable).sum())} too faint to date, "
        f"{int((datable & ~kept).sum())} not steadily present")  # fmt: skip

    records = []
    col, row = buildings.tile_index(table, KIGALI)
    tiles_across = round(KIGALI.width * KIGALI.cell / buildings.TILE_SIZE)
    tile_list = []
    for tile_row in range(tiles_across):
        for tile_col in range(tiles_across):
            members = (col == tile_col) & (row == tile_row)
            if not members.any():
                continue
            origin = (
                KIGALI.x_min + tile_col * buildings.TILE_SIZE,
                KIGALI.y_min + tile_row * buildings.TILE_SIZE,
            )
            part = table.rows(members)
            container = buildings.pack_tile(part, origin, years)
            relative_path = f"buildings/tile_{tile_col}_{tile_row}.hlt"
            container.write(paths.web_data / relative_path)
            info = {
                "col": tile_col,
                "row": tile_row,
                "origin": list(origin),
                "count": len(part),
                "countByFirstYear": np.bincount(part.first, minlength=len(years)).tolist(),
                "maxHeight": round(float(part.height.max()), 1),
            }
            tile_list.append(info)
            records.append(
                AssetRecord(
                    key=f"buildings.tile.{tile_col}.{tile_row}",
                    path=relative_path,
                    kind=buildings.KIND,
                    version=buildings.VERSION,
                    sources=["open-buildings", "open-buildings-temporal"],
                    info=info,
                )
            )

    city_table_first = first[kept & in_city]
    city_table_area = table.area[in_city[kept]]
    stats = {
        "years": years,
        "method": {
            "footprints": "Open Buildings v3",
            "minConfidence": footprints.MIN_CONFIDENCE,
            "presenceThreshold": buildings.PRESENCE_THRESHOLD,
            "presenceRelativeTo": "the larger of the footprint's presence in the last two years",
            "minFinalPresence": buildings.MIN_FINAL_PRESENCE,
            "minPresentShare": buildings.MIN_PRESENT_SHARE,
            "heights": "presence-weighted mean inside the footprint, median of 3 years",
        },
        "footprints": {
            "onGrid": len(everything),
            "byPublishedPrecision": by_confidence,
            "used": count,
            "dated": int(kept.sum()),
            "tooFaintToDate": int((~datable).sum()),
            "notSteadilyPresent": int((datable & ~kept).sum()),
        },
        "grid": {
            "areaKm2": round(KIGALI.width * KIGALI.height * KIGALI.cell**2 / 1e6, 1),
            "byYear": buildings.yearly_totals(table.first, table.area, years),
        },
        "city": {
            "name": "City of Kigali",
            "areaKm2": round(extract.city.area / 1e6, 1),
            "byYear": buildings.yearly_totals(city_table_first, city_table_area, years),
        },
        "rasters": {
            "note": (
                "Computed from the 2.5D Temporal rasters alone, without footprints: area "
                "with presence of at least 0.5, and the sum of fractional building counts."
            ),
            "byYear": raster_rows,
        },
        "tiles": {"size": buildings.TILE_SIZE, "across": tiles_across, "list": tile_list},
    }
    stats_path = paths.web_data / "buildings" / "stats.json"
    stats_path.write_text(json.dumps(stats, separators=(",", ":")) + "\n")
    records.append(
        AssetRecord(
            key="buildings.stats",
            path="buildings/stats.json",
            kind="building-stats",
            version=1,
            sources=["open-buildings", "open-buildings-temporal", "openstreetmap"],
            info={"buildings": int(kept.sum()), "tiles": len(tile_list)},
        )
    )
    for stale in (paths.web_data / "buildings").glob("tile_*.hlt"):
        if f"buildings/{stale.name}" not in {record.path for record in records}:
            stale.unlink()
    update_manifest(
        paths.manifest,
        records,
        {key: SOURCES[key] for key in ("open-buildings", "open-buildings-temporal")},
        remove_prefix="buildings.",
    )
    grid_rows = stats["grid"]["byYear"]
    say(f"buildings: {len(tile_list)} tiles; {grid_rows[0]['buildings']} standing in "
        f"{years[0]}, {grid_rows[-1]['buildings']} in {years[-1]}")  # fmt: skip
    return records


STEPS: dict[str, Callable[[Paths, Log], list[AssetRecord]]] = {
    "terrain": build_terrain,
    "osm": build_osm,
    "landcover": build_landcover,
    "buildings": build_buildings,
}
