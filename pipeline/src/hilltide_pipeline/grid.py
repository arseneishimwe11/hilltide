"""The local coordinate system and the grids every asset is built on.

Everything Hilltide draws lives on one flat grid in metres: a transverse
Mercator projection centred on 30 degrees east. Rwanda straddles two UTM
zones, so a single custom projection avoids a seam through the country.
Scale error stays below about 0.03% everywhere in the country domain.

Grid convention: x grows east, y grows north. Row 0 is the northern edge,
column 0 the western edge. Cell (row, col) covers
x in [x_min + col*cell, x_min + (col+1)*cell) and
y in (y_max - (row+1)*cell, y_max - row*cell].
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from pyproj import CRS, Transformer

#: PROJ definition of the Hilltide local grid.
LOCAL_PROJ = (
    "+proj=tmerc +lat_0=-2 +lon_0=30 +k=0.9999 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
)
WGS84 = "EPSG:4326"


def local_crs() -> CRS:
    return CRS.from_proj4(LOCAL_PROJ)


@lru_cache(maxsize=8)
def _transformer(source: str, target: str) -> Transformer:
    return Transformer.from_crs(source, target, always_xy=True)


def lonlat_to_local(lon, lat):
    """Longitude and latitude in degrees to local metres. Accepts scalars or arrays."""
    return _transformer(WGS84, LOCAL_PROJ).transform(lon, lat)


def local_to_lonlat(x, y):
    """Local metres to longitude and latitude in degrees. Accepts scalars or arrays."""
    return _transformer(LOCAL_PROJ, WGS84).transform(x, y)


@dataclass(frozen=True)
class Grid:
    """A north-up raster grid in local metres."""

    name: str
    x_min: float
    y_max: float
    cell: float
    width: int
    height: int

    @property
    def x_max(self) -> float:
        return self.x_min + self.width * self.cell

    @property
    def y_min(self) -> float:
        return self.y_max - self.height * self.cell

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """(x_min, y_min, x_max, y_max) in local metres."""
        return (self.x_min, self.y_min, self.x_max, self.y_max)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.height, self.width)

    @property
    def affine(self) -> tuple[float, float, float, float, float, float]:
        """Affine coefficients (a, b, c, d, e, f) as rasterio expects them."""
        return (self.cell, 0.0, self.x_min, 0.0, -self.cell, self.y_max)

    def lonlat_bounds(self, margin_deg: float = 0.0) -> tuple[float, float, float, float]:
        """Geographic box (west, south, east, north) that contains the whole grid."""
        xs = np.linspace(self.x_min, self.x_max, 33)
        ys = np.linspace(self.y_min, self.y_max, 33)
        edge_x = np.concatenate([xs, xs, np.full(33, self.x_min), np.full(33, self.x_max)])
        edge_y = np.concatenate([np.full(33, self.y_min), np.full(33, self.y_max), ys, ys])
        lon, lat = local_to_lonlat(edge_x, edge_y)
        return (
            float(lon.min()) - margin_deg,
            float(lat.min()) - margin_deg,
            float(lon.max()) + margin_deg,
            float(lat.max()) + margin_deg,
        )

    def cell_of(self, x, y):
        """Fractional (row, col) of local coordinates; cell centres are at .5."""
        col = (np.asarray(x, dtype=np.float64) - self.x_min) / self.cell
        row = (self.y_max - np.asarray(y, dtype=np.float64)) / self.cell
        return row, col

    def centre_of(self, row, col):
        """Local (x, y) of the centre of cell (row, col)."""
        x = self.x_min + (np.asarray(col, dtype=np.float64) + 0.5) * self.cell
        y = self.y_max - (np.asarray(row, dtype=np.float64) + 0.5) * self.cell
        return x, y

    def contains(self, x, y):
        x = np.asarray(x)
        y = np.asarray(y)
        return (x >= self.x_min) & (x < self.x_max) & (y > self.y_min) & (y <= self.y_max)

    def coarsened(self, factor: int, name: str | None = None) -> Grid:
        """The same area with cells `factor` times larger."""
        if self.width % factor or self.height % factor:
            raise ValueError(f"{self.name}: size is not divisible by {factor}")
        return Grid(
            name or f"{self.name}_{round(self.cell * factor)}m",
            self.x_min,
            self.y_max,
            self.cell * factor,
            self.width // factor,
            self.height // factor,
        )

    def refined(self, factor: int, name: str | None = None) -> Grid:
        """The same area with cells `factor` times smaller."""
        return Grid(
            name or f"{self.name}_{self.cell / factor:g}m",
            self.x_min,
            self.y_max,
            self.cell / factor,
            self.width * factor,
            self.height * factor,
        )

    def describe(self) -> dict:
        """Plain description for asset headers and the manifest."""
        return {
            "name": self.name,
            "xMin": self.x_min,
            "yMax": self.y_max,
            "cell": self.cell,
            "width": self.width,
            "height": self.height,
        }


# --- The three terrain levels -------------------------------------------------
#
# country: Rwanda with a margin of its neighbours, so the country does not
#          float in empty space when seen from high altitude.
# region:  the hills around Kigali that the camera flies across.
# kigali:  the city at full terrain resolution. This is also the water
#          simulation grid.

#: Bounding box of the City of Kigali (OpenStreetMap administrative boundary,
#: admin level 4) in local metres: (x_min, y_min, x_max, y_max). Measured from
#: the Rwanda extract; the Kigali grid below is placed around it.
CITY_OF_KIGALI_BOUNDS = (-2278.0, -8827.0, 31134.0, 24370.0)

COUNTRY = Grid("country", x_min=-156_000.0, y_max=133_000.0, cell=250.0, width=1120, height=1024)

#: 38.4 km square holding the whole City of Kigali with at least 2.5 km of
#: margin on every side, so the Nyabarongo valley along the city's western
#: and southern edge is inside. Corners are multiples of 960 m, so the grid
#: divides evenly into 60 m and 120 m cells and into 3.84 km building tiles.
KIGALI = Grid("kigali", x_min=-4_800.0, y_max=26_880.0, cell=30.0, width=1280, height=1280)

#: 92 km square of surrounding hills, centred on the Kigali grid.
REGION = Grid("region", x_min=-31_680.0, y_max=53_730.0, cell=90.0, width=1024, height=1024)

#: Grid the building rasters are resampled to: Kigali at their effective 4 m resolution.
KIGALI_4M = Grid("kigali_4m", KIGALI.x_min, KIGALI.y_max, cell=4.0, width=9600, height=9600)

GRIDS: dict[str, Grid] = {grid.name: grid for grid in (COUNTRY, REGION, KIGALI)}
