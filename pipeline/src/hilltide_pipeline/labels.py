"""A short, curated list of place labels for the site, and the country mask.

Settlement positions come from OpenStreetMap by name. Natural features
(lakes, forests, the volcano range) are placed by hand at a point inside
the feature; each hand-placed point is checked against the land-cover data
when the pipeline runs, so a wrong coordinate fails the build instead of
putting "Lake Kivu" on dry land.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import shapely

from .container import Container
from .grid import Grid, lonlat_to_local
from .osm import Place

#: Labels shown from high altitude and when close to Kigali.
COUNTRY, KIGALI = "country", "kigali"


@dataclass(frozen=True)
class Feature:
    """A hand-placed natural feature. `expect` is the land-cover class required at the point."""

    name: str
    kind: str
    level: str
    lon: float
    lat: float
    expect: int | None = None


#: Land-cover class codes (see landcover.py).
TREES, WATER = 1, 8

FEATURES: tuple[Feature, ...] = (
    Feature("Lake Kivu", "lake", COUNTRY, 29.20, -2.00, WATER),
    # Interior points of the two lakes, measured from the land-cover water class.
    Feature("Lake Muhazi", "lake", COUNTRY, 30.401, -1.854, WATER),
    Feature("Lake Ihema", "lake", COUNTRY, 30.792, -1.854, WATER),
    Feature("Nyungwe Forest", "forest", COUNTRY, 29.25, -2.50, TREES),
)

#: Places taken from OpenStreetMap: (name in OSM, label text, level, kinds accepted).
OSM_PLACES: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    ("Kigali", "Kigali", COUNTRY, ("city",)),
    ("Huye", "Huye", COUNTRY, ("city", "town")),
    ("Mount Karisimbi", "Karisimbi", COUNTRY, ("peak",)),
    ("Kigali", "Kigali", KIGALI, ("city",)),
    ("Nyamirambo", "Nyamirambo", KIGALI, ("suburb", "quarter", "neighbourhood")),
    ("Kimironko", "Kimironko", KIGALI, ("suburb", "quarter", "neighbourhood")),
    ("Kacyiru", "Kacyiru", KIGALI, ("suburb", "quarter", "neighbourhood")),
    ("Kanombe", "Kanombe", KIGALI, ("suburb", "quarter", "neighbourhood")),
    ("Kabuga", "Kabuga", KIGALI, ("suburb", "quarter", "neighbourhood", "town")),
    ("Mount Jali", "Mount Jali", KIGALI, ("peak",)),
)


def class_at(classes: np.ndarray, grid: Grid, x: float, y: float) -> int:
    row, col = grid.cell_of(x, y)
    return int(classes[int(row), int(col)])


def build_labels(
    places: list[Place], country_grid: Grid, country_classes: np.ndarray
) -> list[dict]:
    """The label list. Raises if a settlement is missing or a feature point is misplaced."""
    labels = []
    for feature in FEATURES:
        x, y = lonlat_to_local(feature.lon, feature.lat)
        if feature.expect is not None:
            found = class_at(country_classes, country_grid, x, y)
            if found != feature.expect:
                raise ValueError(
                    f"Label '{feature.name}' at {feature.lon}, {feature.lat} sits on land-cover "
                    f"class {found}, expected {feature.expect}"
                )
        labels.append(
            {"name": feature.name, "kind": feature.kind, "level": feature.level,
             "x": round(x), "y": round(y)}
        )  # fmt: skip
    for osm_name, text, level, kinds in OSM_PLACES:
        matches = [place for place in places if place.name == osm_name and place.kind in kinds]
        if not matches:
            raise ValueError(f"OpenStreetMap extract has no {'/'.join(kinds)} named '{osm_name}'")
        place = matches[0]
        kind = place.kind if place.kind in ("city", "peak") else "place"
        label = {
            "name": text,
            "kind": kind,
            "level": level,
            "x": round(place.x),
            "y": round(place.y),
        }
        if place.kind == "peak" and place.elevation:
            label["elevation"] = round(place.elevation)
        labels.append(label)
    return labels


# --- Country mask -------------------------------------------------------------

MASK_KIND = "distance-mask"
MASK_VERSION = 1
#: Stored value = MASK_ZERO + distance in km * MASK_STEPS_PER_KM, clipped to 0..255.
MASK_ZERO, MASK_STEPS_PER_KM = 128, 2


def country_mask(country: shapely.Geometry, grid: Grid) -> np.ndarray:
    """Signed distance to the national border in km at each cell centre: positive inside."""
    rows, cols = np.mgrid[0 : grid.height, 0 : grid.width]
    x, y = grid.centre_of(rows.ravel(), cols.ravel())
    distance = shapely.distance(shapely.points(x, y), country.boundary) / 1000.0
    inside = shapely.contains_xy(country, x, y)
    return np.where(inside, distance, -distance).reshape(grid.shape)


def pack_mask(distance_km: np.ndarray, grid: Grid) -> Container:
    stored = np.clip(np.rint(MASK_ZERO + distance_km * MASK_STEPS_PER_KM), 0, 255).astype(np.uint8)
    meta = {
        "grid": grid.describe(),
        "zero": MASK_ZERO,
        "stepsPerKm": MASK_STEPS_PER_KM,
        "what": "signed distance to the Rwanda border, positive inside",
    }
    return Container(MASK_KIND, MASK_VERSION, meta).add("distance", stored.ravel())


def unpack_mask(container: Container) -> tuple[np.ndarray, dict]:
    meta = container.meta
    stored = container.section("distance").data.astype(np.float64)
    shape = (meta["grid"]["height"], meta["grid"]["width"])
    return ((stored - meta["zero"]) / meta["stepsPerKm"]).reshape(shape), meta
