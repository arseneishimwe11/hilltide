"""OpenStreetMap: waterways, the national border, the city boundary and place names.

Read from a Rwanda extract (.osm.pbf). Lakes are not taken from here: the
extract stops at the border, which cuts Lake Kivu in half, so lakes come
from the land-cover raster instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import osmium
import shapely

from .footprints import to_local

#: Waterway types kept, and the small integer class stored for each.
WATERWAY_CLASSES = {"river": 1, "stream": 2, "canal": 3, "drain": 4, "ditch": 4}
#: Place types kept for labels, most important first.
PLACE_RANK = {"city": 0, "town": 1, "suburb": 2, "quarter": 3, "neighbourhood": 4, "village": 5}


@dataclass
class Waterways:
    lines: list  # shapely LineStrings in local metres
    kind: list[int]
    name: list[str]


@dataclass
class Place:
    name: str
    kind: str
    x: float
    y: float
    population: int | None = None
    elevation: float | None = None


@dataclass
class OsmExtract:
    waterways: Waterways
    places: list[Place] = field(default_factory=list)
    country: object | None = None  # shapely (Multi)Polygon, local metres
    city: object | None = None


def _number(text: str | None) -> float | None:
    try:
        return float(str(text).replace(",", "").split()[0]) if text else None
    except ValueError:
        return None


def read_extract(path: Path) -> OsmExtract:
    """Single pass over the extract for lines and points, one more for boundaries."""
    lon_lat_lines, kinds, names = [], [], []
    places: list[tuple[str, str, float, float, float | None, float | None]] = []

    for obj in (
        osmium.FileProcessor(str(path))
        .with_locations()
        .with_filter(osmium.filter.KeyFilter("waterway", "place", "natural"))
    ):
        tags = obj.tags
        if obj.is_way():
            kind = WATERWAY_CLASSES.get(tags.get("waterway", ""))
            if kind is None or tags.get("tunnel") in ("yes", "culvert"):
                continue
            coords = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            if len(coords) >= 2:
                lon_lat_lines.append(shapely.LineString(coords))
                kinds.append(kind)
                names.append(tags.get("name", ""))
        elif obj.is_node() and "name" in tags:
            place = tags.get("place")
            natural = tags.get("natural")
            if place in PLACE_RANK:
                kind = place
            elif natural in ("peak", "volcano"):
                kind = "peak"
            else:
                continue
            places.append(
                (
                    tags.get("name:en") or tags["name"],
                    kind,
                    obj.lon,
                    obj.lat,
                    _number(tags.get("population")),
                    _number(tags.get("ele")),
                )
            )

    lines = to_local(np.array(lon_lat_lines, dtype=object)) if lon_lat_lines else np.array([])
    extract = OsmExtract(Waterways(list(lines), kinds, names))
    if places:
        xy = to_local(shapely.points([(p[2], p[3]) for p in places]))
        extract.places = [
            Place(p[0], p[1], float(shapely.get_x(pt)), float(shapely.get_y(pt)),
                  int(p[4]) if p[4] else None, p[5])
            for p, pt in zip(places, xy, strict=True)
        ]  # fmt: skip

    wkb = osmium.geom.WKBFactory()
    for obj in (
        osmium.FileProcessor(str(path))
        .with_areas()
        .with_filter(osmium.filter.TagFilter(("boundary", "administrative")))
    ):
        if not obj.is_area():
            continue
        tags = obj.tags
        level = tags.get("admin_level")
        name = tags.get("name:en") or tags.get("name", "")
        is_country = level == "2" and tags.get("ISO3166-1") == "RW"
        is_city = level == "4" and "Kigali" in name
        if not (is_country or is_city):
            continue
        shape = to_local(
            np.array(
                [
                    shapely.from_wkb(
                        wkb.create_multipolygon(obj),
                    )
                ]
            )
        )[0]
        if is_country:
            extract.country = shape
        else:
            extract.city = shape
    return extract


def clip_and_simplify(
    waterways: Waterways,
    bounds: tuple[float, float, float, float],
    tolerance: float,
    kinds: set[int],
    min_length: float,
) -> Waterways:
    """Waterways of the chosen classes cut to a box, simplified, short pieces dropped."""
    box = shapely.box(*bounds)
    lines, out_kinds, out_names = [], [], []
    for line, kind, name in zip(waterways.lines, waterways.kind, waterways.name, strict=True):
        if kind not in kinds or not line.intersects(box):
            continue
        clipped = shapely.intersection(line, box)
        for part in shapely.get_parts(clipped):
            if part.geom_type != "LineString":
                continue
            simple = shapely.simplify(part, tolerance, preserve_topology=False)
            if simple.is_empty or simple.length < min_length:
                continue
            lines.append(simple)
            out_kinds.append(kind)
            out_names.append(name)
    return Waterways(lines, out_kinds, out_names)
