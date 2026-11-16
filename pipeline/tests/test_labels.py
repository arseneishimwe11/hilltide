import numpy as np
import pytest
import shapely

from hilltide_pipeline.container import Container
from hilltide_pipeline.grid import COUNTRY, Grid, lonlat_to_local
from hilltide_pipeline.labels import (
    FEATURES,
    OSM_PLACES,
    WATER,
    build_labels,
    country_mask,
    pack_mask,
    unpack_mask,
)
from hilltide_pipeline.osm import Place


def places_for_every_label() -> list[Place]:
    out = []
    for index, (name, _text, _level, kinds) in enumerate(OSM_PLACES):
        out.append(Place(name, kinds[0], 1000.0 * index, 2000.0, elevation=4507.0))
    return out


def classes_matching_features() -> np.ndarray:
    classes = np.full(COUNTRY.shape, 4, dtype=np.uint8)
    for feature in FEATURES:
        row, col = COUNTRY.cell_of(*lonlat_to_local(feature.lon, feature.lat))
        classes[int(row), int(col)] = feature.expect or 4
    return classes


def test_labels_combine_checked_features_and_osm_places() -> None:
    labels = build_labels(places_for_every_label(), COUNTRY, classes_matching_features())
    assert len(labels) == len(FEATURES) + len(OSM_PLACES)
    by_key = {(label["name"], label["level"]): label for label in labels}
    assert by_key[("Lake Kivu", "country")]["kind"] == "lake"
    assert by_key[("Kigali", "country")]["kind"] == "city"
    assert by_key[("Kigali", "kigali")]["kind"] == "city"
    assert by_key[("Karisimbi", "country")] == {
        "name": "Karisimbi", "kind": "peak", "level": "country",
        "x": by_key[("Karisimbi", "country")]["x"], "y": 2000, "elevation": 4507,
    }  # fmt: skip
    assert by_key[("Kimironko", "kigali")]["kind"] == "place"


def test_a_misplaced_feature_fails_the_build() -> None:
    dry = np.full(COUNTRY.shape, 4, dtype=np.uint8)  # no water anywhere
    with pytest.raises(ValueError, match="Lake Kivu"):
        build_labels(places_for_every_label(), COUNTRY, dry)


def test_a_missing_osm_place_fails_the_build() -> None:
    without_kigali = [place for place in places_for_every_label() if place.name != "Kigali"]
    with pytest.raises(ValueError, match="named 'Kigali'"):
        build_labels(without_kigali, COUNTRY, classes_matching_features())


def test_lake_labels_expect_water() -> None:
    assert all(feature.expect == WATER for feature in FEATURES if feature.kind == "lake")


def test_country_mask_is_signed_distance_in_km() -> None:
    grid = Grid("t", 0.0, 100_000.0, 1000.0, 100, 100)
    square = shapely.box(20_000, 20_000, 80_000, 80_000)
    distance = country_mask(square, grid)
    assert distance[50, 50] == pytest.approx(29.5, abs=0.01)  # centre: 30 km minus half a cell
    assert distance[50, 5] == pytest.approx(-14.5, abs=0.01)  # outside, west
    assert distance[50, 20] > 0 > distance[50, 19]  # the sign flips across the border


def test_mask_round_trip_within_half_a_step() -> None:
    grid = Grid("t", 0.0, 100_000.0, 1000.0, 100, 100)
    distance = country_mask(shapely.box(20_000, 20_000, 80_000, 80_000), grid)
    restored, meta = unpack_mask(Container.from_bytes(pack_mask(distance, grid).to_bytes()))
    assert np.abs(restored - distance).max() <= 0.25 + 1e-9
    assert meta["zero"] == 128 and meta["stepsPerKm"] == 2
    # Far values are clipped, not wrapped.
    far = pack_mask(np.full(grid.shape, -500.0), grid)
    assert unpack_mask(far)[0].max() == -64.0
