"""Packing lines (rivers, borders) into the web asset format.

All points of all lines are stored back to back as integer decimetres
relative to an origin, delta-coded. `starts` holds the index of each line's
first point, plus one final entry equal to the total point count.
"""

from __future__ import annotations

import itertools

import numpy as np
import shapely

from .codecs import decode_delta32, encode_delta32
from .container import Container

KIND = "lines"
VERSION = 1
#: Coordinates are stored in units of this many metres.
UNIT = 0.1


def pack_lines(
    lines: list,
    origin: tuple[float, float],
    kinds: list[int] | None = None,
    names: list[str] | None = None,
    meta: dict | None = None,
) -> Container:
    """Pack shapely LineStrings (local metres). `kinds` and `names` are per line."""
    counts = [len(line.coords) for line in lines]
    starts = np.concatenate([[0], np.cumsum(counts)]).astype(np.int32)
    coords = (
        np.concatenate([np.asarray(line.coords)[:, :2] for line in lines])
        if lines
        else np.zeros((0, 2))
    )
    x = np.rint((coords[:, 0] - origin[0]) / UNIT).astype(np.int32)
    y = np.rint((coords[:, 1] - origin[1]) / UNIT).astype(np.int32)

    name_table = sorted({name for name in (names or []) if name})
    name_index = {name: index + 1 for index, name in enumerate(name_table)}
    container = Container(
        KIND,
        VERSION,
        {
            "origin": list(origin),
            "unit": UNIT,
            "lineCount": len(lines),
            "pointCount": int(starts[-1]),
            "lengthKm": round(float(sum(line.length for line in lines)) / 1000, 2),
            "names": name_table,
            **(meta or {}),
        },
    )

    def add32(name: str, values: np.ndarray) -> None:
        container.add(
            name,
            encode_delta32(values),
            encoding="delta32",
            decoded_dtype="i32",
            decoded_count=values.size,
        )

    add32("x", x)
    add32("y", y)
    add32("starts", starts)
    container.add("kind", np.asarray(kinds or [0] * len(lines), dtype=np.uint8))
    container.add(
        "name",
        np.asarray([name_index.get(n, 0) for n in (names or [""] * len(lines))], dtype=np.uint16),
    )
    return container


def unpack_lines(container: Container) -> tuple[list, np.ndarray, list[str]]:
    """Returns (LineStrings in local metres, kind per line, name per line)."""
    meta = container.meta
    x = decode_delta32(container.section("x").data) * meta["unit"] + meta["origin"][0]
    y = decode_delta32(container.section("y").data) * meta["unit"] + meta["origin"][1]
    starts = decode_delta32(container.section("starts").data)
    lines = [
        shapely.LineString(np.column_stack([x[a:b], y[a:b]])) for a, b in itertools.pairwise(starts)
    ]
    table = ["", *meta["names"]]
    names = [table[index] for index in container.section("name").data]
    return lines, container.section("kind").data, names


def rings_of(shape) -> list:
    """Exterior rings of a polygon or multipolygon, as closed LineStrings."""
    if shape is None or shape.is_empty:
        return []
    return [shapely.LineString(part.exterior.coords) for part in shapely.get_parts(shape)]
