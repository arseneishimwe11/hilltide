from pathlib import Path

import numpy as np
import pytest
import shapely

from hilltide_pipeline import osm
from hilltide_pipeline.container import Container
from hilltide_pipeline.grid import local_to_lonlat
from hilltide_pipeline.lines import UNIT, pack_lines, rings_of, unpack_lines


def test_lines_round_trip_within_the_storage_unit() -> None:
    rng = np.random.default_rng(5)
    start = np.array([5000.0, 9000.0])
    lines = [
        shapely.LineString(np.cumsum(rng.normal(0, 40, (n, 2)), axis=0) + start)
        for n in (2, 17, 300)
    ]
    packed = pack_lines(lines, (1000.0, 2000.0), [1, 2, 4], ["Nyabarongo", "", "Mpazi"])
    back, kinds, names = unpack_lines(Container.from_bytes(packed.to_bytes()))
    assert kinds.tolist() == [1, 2, 4] and names == ["Nyabarongo", "", "Mpazi"]
    assert packed.meta["lineCount"] == 3 and packed.meta["pointCount"] == 319
    for original, restored in zip(lines, back, strict=True):
        difference = np.abs(np.asarray(original.coords) - np.asarray(restored.coords))
        assert difference.max() <= UNIT / 2 + 1e-9


def test_empty_line_set_packs() -> None:
    back, kinds, names = unpack_lines(Container.from_bytes(pack_lines([], (0.0, 0.0)).to_bytes()))
    assert back == [] and kinds.size == 0 and names == []


def test_rings_of_handles_single_and_multi_polygons() -> None:
    a, b = shapely.box(0, 0, 10, 10), shapely.box(20, 0, 30, 10)
    assert len(rings_of(a)) == 1 and len(rings_of(shapely.MultiPolygon([a, b]))) == 2
    assert rings_of(None) == []
    assert rings_of(a)[0].is_closed


def waterways(*lines: shapely.LineString, kinds: list[int] | None = None) -> osm.Waterways:
    return osm.Waterways(list(lines), kinds or [1] * len(lines), [""] * len(lines))


def test_clipping_cuts_lines_at_the_domain_edge() -> None:
    crossing = shapely.LineString([(-50, 50), (150, 50)])  # enters and leaves the box
    outside = shapely.LineString([(200, 0), (300, 0)])
    weaving = shapely.LineString([(10, -20), (10, 20), (30, 20), (30, -20), (50, -20), (50, 20)])
    result = osm.clip_and_simplify(
        waterways(crossing, outside, weaving), (0, 0, 100, 100), 0.1, {1}, 1.0
    )
    lengths = sorted(round(line.length) for line in result.lines)
    # crossing: 100 m inside. weaving: three inside pieces of 20+20+20, 20 and 20 m... split
    # where it dips below y = 0, giving pieces of 60 and 20 m.
    assert lengths == [20, 60, 100]
    box = shapely.box(0, 0, 100, 100).buffer(1e-6)
    assert all(box.contains(line) for line in result.lines)


def test_clipping_filters_by_kind_and_length_and_simplifies() -> None:
    river = shapely.LineString([(0, 50), (25, 50.2), (50, 50), (75, 49.9), (100, 50)])
    stream = shapely.LineString([(0, 10), (100, 10)])
    stub = shapely.LineString([(5, 5), (8, 5)])
    all_kinds = waterways(river, stream, stub, kinds=[1, 2, 1])
    rivers_only = osm.clip_and_simplify(all_kinds, (0, 0, 100, 100), 1.0, {1}, 10.0)
    assert len(rivers_only.lines) == 1 and rivers_only.kind == [1]
    assert len(rivers_only.lines[0].coords) == 2  # the small wiggles are gone
    everything = osm.clip_and_simplify(all_kinds, (0, 0, 100, 100), 1.0, {1, 2}, 0.5)
    assert len(everything.lines) == 3


def osm_xml(tmp_path: Path) -> Path:
    """A tiny OpenStreetMap file near Kigali: a river, a culvert, places and two boundaries."""

    def node(ident: int, x: float, y: float, tags: str = "") -> str:
        lon, lat = local_to_lonlat(x, y)
        return f'<node id="{ident}" lat="{lat:.7f}" lon="{lon:.7f}" version="1">{tags}</node>'

    def tag(key: str, value: str) -> str:
        return f'<tag k="{key}" v="{value}"/>'

    def way(ident: int, refs: list[int], tags: str) -> str:
        nds = "".join(f'<nd ref="{ref}"/>' for ref in refs)
        return f'<way id="{ident}" version="1">{nds}{tags}</way>'

    def relation(ident: int, way_id: int, tags: str) -> str:
        member = f'<member type="way" ref="{way_id}" role="outer"/>'
        return (
            f'<relation id="{ident}" version="1">{member}{tag("type", "boundary")}{tags}</relation>'
        )

    square = [(0, 0), (40000, 0), (40000, 40000), (0, 40000)]
    small = [(10000, 10000), (20000, 10000), (20000, 20000), (10000, 20000)]
    parts = ['<?xml version="1.0" encoding="UTF-8"?><osm version="0.6" generator="test">']
    parts += [node(1, 1000, 1000), node(2, 2000, 1000), node(3, 3000, 1500)]
    parts += [node(4, 5000, 5000), node(5, 5100, 5000)]
    parts += [node(10 + i, x, y) for i, (x, y) in enumerate(square)]
    parts += [node(20 + i, x, y) for i, (x, y) in enumerate(small)]
    city_tags = tag("place", "city") + tag("name", "Kigali") + tag("population", "1,745,555")
    peak_tags = tag("natural", "peak") + tag("name", "Mont Kigali") + tag("ele", "1853")
    parts.append(node(30, 15000, 15000, city_tags))
    parts.append(node(31, 12000, 12000, peak_tags))
    parts.append(node(32, 13000, 13000, tag("place", "hamlet") + tag("name", "Ignored")))
    parts.append(way(100, [1, 2, 3], tag("waterway", "river") + tag("name", "Nyabugogo")))
    parts.append(way(101, [4, 5], tag("waterway", "stream") + tag("tunnel", "culvert")))
    parts.append(way(102, [10, 11, 12, 13, 10], ""))
    parts.append(way(103, [20, 21, 22, 23, 20], ""))
    admin = tag("boundary", "administrative")
    country_tags = admin + tag("admin_level", "2") + tag("ISO3166-1", "RW") + tag("name", "Rwanda")
    city_boundary_tags = (
        admin + tag("admin_level", "4") + tag("name", "Umujyi wa Kigali") + tag("name:en", "Kigali")
    )
    parts.append(relation(200, 102, country_tags))
    parts.append(relation(201, 103, city_boundary_tags))
    parts.append("</osm>")
    path = tmp_path / "tiny.osm"
    path.write_text("".join(parts))
    return path


def test_reading_an_osm_extract(tmp_path: Path) -> None:
    extract = osm.read_extract(osm_xml(tmp_path))

    assert extract.waterways.kind == [1] and extract.waterways.name == ["Nyabugogo"]
    river = np.asarray(extract.waterways.lines[0].coords)
    assert river == pytest.approx(np.array([[1000, 1000], [2000, 1000], [3000, 1500]]), abs=0.05)

    places = {place.name: place for place in extract.places}
    assert set(places) == {"Kigali", "Mont Kigali"}  # the hamlet is not a label kind
    assert places["Kigali"].kind == "city" and places["Kigali"].population == 1_745_555
    assert places["Mont Kigali"].kind == "peak" and places["Mont Kigali"].elevation == 1853
    assert (places["Kigali"].x, places["Kigali"].y) == pytest.approx((15000, 15000), abs=0.05)

    assert extract.country.area == pytest.approx(40000**2, rel=1e-4)
    assert extract.city.area == pytest.approx(10000**2, rel=1e-4)
