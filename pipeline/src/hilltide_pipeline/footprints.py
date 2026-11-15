"""Open Buildings v3 footprints: filter the published file to Kigali and load it."""

from __future__ import annotations

import csv
import gzip
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely

from .grid import Grid, lonlat_to_local

#: The published file for the S2 level-4 cell that contains Rwanda.
FOOTPRINTS_URL = (
    "https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/"
    "19d_buildings.csv.gz"
)
#: Confidence thresholds Google publishes for this cell (score_thresholds_s2_level_4.csv),
#: by the precision they are estimated to give.
PUBLISHED_THRESHOLDS = {"80%": 0.650, "85%": 0.683, "90%": 0.738}
#: Footprints below this confidence are not used.
MIN_CONFIDENCE = PUBLISHED_THRESHOLDS["85%"]


def filter_to_box(
    source: Path, target: Path, box: tuple[float, float, float, float]
) -> tuple[int, int]:
    """Copy the rows whose centroid is inside a lon/lat box. Returns (rows read, rows kept).

    The source has tens of millions of rows; only the first two columns
    (latitude, longitude) are parsed here.
    """
    west, south, east, north = box
    read = kept = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    with gzip.open(source, "rb") as src, gzip.open(partial, "wb", compresslevel=6) as dst:
        header = src.readline()
        if not header.startswith(b"latitude,longitude,area_in_meters,confidence,geometry"):
            raise ValueError(f"Unexpected columns in {source.name}: {header[:80]!r}")
        dst.write(header)
        for line in src:
            read += 1
            first = line.find(b",")
            lat = float(line[:first])
            if lat < south or lat > north:
                continue
            lon = float(line[first + 1 : line.find(b",", first + 1)])
            if lon < west or lon > east:
                continue
            dst.write(line)
            kept += 1
    partial.replace(target)
    return read, kept


@dataclass
class Footprints:
    """Building footprints in local metres."""

    polygons: np.ndarray  # shapely Polygons
    area: np.ndarray  # m2, as published
    confidence: np.ndarray

    def __len__(self) -> int:
        return len(self.polygons)

    def subset(self, keep: np.ndarray) -> Footprints:
        return Footprints(self.polygons[keep], self.area[keep], self.confidence[keep])


def to_local(geometries: np.ndarray) -> np.ndarray:
    """Reproject lon/lat geometries to local metres."""

    def project(coords: np.ndarray) -> np.ndarray:
        x, y = lonlat_to_local(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])

    return shapely.transform(geometries, project)


def load_footprints(path: Path, grid: Grid, min_confidence: float = 0.0) -> Footprints:
    """Load a filtered footprint file; keep valid polygons whose centroid is on the grid."""
    areas, confidences, wkts = [], [], []
    with gzip.open(path, "rt", newline="") as handle:
        for row in csv.DictReader(handle):
            confidence = float(row["confidence"])
            if confidence < min_confidence:
                continue
            areas.append(float(row["area_in_meters"]))
            confidences.append(confidence)
            wkts.append(row["geometry"])
    polygons = to_local(shapely.from_wkt(np.array(wkts, dtype=object)))
    # A few published shapes are multi-part; keep the largest part.
    multi = shapely.get_type_id(polygons) != shapely.GeometryType.POLYGON
    for index in np.flatnonzero(multi):
        parts = shapely.get_parts(polygons[index])
        polygons[index] = parts[np.argmax(shapely.area(parts))] if len(parts) else None
    centroid = shapely.centroid(polygons)
    keep = (
        ~shapely.is_missing(polygons)
        & shapely.is_valid(polygons)
        & (shapely.area(polygons) > 1.0)
        & grid.contains(shapely.get_x(centroid), shapely.get_y(centroid))
    )
    return Footprints(polygons[keep], np.array(areas)[keep], np.array(confidences)[keep])


@dataclass
class Rectangles:
    """Each footprint as a rectangle with the same area and orientation."""

    x: np.ndarray  # centre, local metres
    y: np.ndarray
    length: np.ndarray  # long side, m
    width: np.ndarray  # short side, m
    angle: np.ndarray  # direction of the long side, radians in [0, pi), from east, anticlockwise


def oriented_rectangles(polygons: np.ndarray) -> Rectangles:
    """Minimum-area bounding rectangle of each polygon, shrunk to the polygon's area.

    The bounding rectangle of an L-shaped or irregular building is larger
    than the building. Scaling both sides by the same factor so the areas
    match keeps the drawn footprint area equal to the mapped one.
    """
    boxes = shapely.oriented_envelope(polygons)
    corners = shapely.get_coordinates(shapely.get_exterior_ring(boxes)).reshape(-1, 5, 2)
    side_a = corners[:, 1] - corners[:, 0]
    side_b = corners[:, 2] - corners[:, 1]
    len_a = np.hypot(side_a[:, 0], side_a[:, 1])
    len_b = np.hypot(side_b[:, 0], side_b[:, 1])
    a_is_long = len_a >= len_b
    long_side = np.where(a_is_long[:, None], side_a, side_b)
    length = np.where(a_is_long, len_a, len_b)
    width = np.where(a_is_long, len_b, len_a)
    shrink = np.sqrt(shapely.area(polygons) / np.maximum(length * width, 1e-9))
    centre = corners[:, :4].mean(axis=1)
    angle = np.mod(np.arctan2(long_side[:, 1], long_side[:, 0]), np.pi)
    # arctan2 can return exactly pi after the modulo because of rounding.
    angle[angle >= np.pi] = 0.0
    return Rectangles(centre[:, 0], centre[:, 1], length * shrink, width * shrink, angle)
