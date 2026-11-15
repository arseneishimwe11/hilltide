import numpy as np
import pytest

from hilltide_pipeline.codecs import (
    decode_delta16,
    decode_delta32,
    decode_plane16,
    encode_delta16,
    encode_delta32,
    encode_plane16,
    unzigzag16,
    zigzag16,
)
from hilltide_pipeline.container import MAGIC, Container
from hilltide_pipeline.grid import Grid
from hilltide_pipeline.heights import pack_heights, quantize, unpack_heights


def rolling_hills(height: int, width: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:height, 0:width]
    hills = 1500 + 300 * np.sin(x / 17.0) * np.cos(y / 23.0) + 80 * np.sin((x + y) / 5.0)
    return (hills + rng.normal(0, 0.5, (height, width))).astype(np.float32)


def test_zigzag_round_trip_and_order() -> None:
    values = np.array([0, -1, 1, -2, 2, 32767, -32768], dtype=np.int16)
    coded = zigzag16(values)
    assert coded.tolist()[:5] == [0, 1, 2, 3, 4]
    assert np.array_equal(unzigzag16(coded), values)


@pytest.mark.parametrize("shape", [(1, 1), (1, 9), (7, 1), (33, 47), (128, 128)])
def test_plane16_round_trip_is_exact(shape: tuple[int, int]) -> None:
    rng = np.random.default_rng(shape[0] * 100 + shape[1])
    grid = rng.integers(0, 65536, shape, dtype=np.uint16)  # worst case: noise, wraps
    assert np.array_equal(decode_plane16(encode_plane16(grid), *shape), grid)


def test_plane16_makes_smooth_terrain_small() -> None:
    quantized, _ = quantize(rolling_hills(256, 256), 0.1)
    planes = encode_plane16(quantized)
    high_bytes = planes[planes.size // 2 :]
    assert (high_bytes == 0).mean() > 0.99  # differences fit in one byte almost everywhere


def test_delta_codecs_round_trip() -> None:
    rng = np.random.default_rng(3)
    u16 = rng.integers(0, 65536, 1000, dtype=np.uint16)
    assert np.array_equal(decode_delta16(encode_delta16(u16)), u16)
    i32 = rng.integers(-(2**30), 2**30, 1000, dtype=np.int32)
    assert np.array_equal(decode_delta32(encode_delta32(i32)), i32)
    assert decode_delta16(encode_delta16(np.zeros(0, np.uint16))).size == 0


def test_container_round_trip_and_layout() -> None:
    container = Container("test", 3, {"note": "hello", "n": 2})
    container.add("a", np.arange(10, dtype=np.uint16))
    container.add("b", np.linspace(0, 1, 5, dtype=np.float32))
    data = container.to_bytes()
    assert data[:4] == MAGIC
    header_length = int.from_bytes(data[4:8], "little")
    assert (8 + header_length) % 8 == 0
    back = Container.from_bytes(data)
    assert (back.kind, back.version, back.meta) == ("test", 3, {"note": "hello", "n": 2})
    assert np.array_equal(back.section("a").data, np.arange(10, dtype=np.uint16))
    assert np.array_equal(back.section("b").data, np.linspace(0, 1, 5, dtype=np.float32))
    with pytest.raises(KeyError):
        back.section("missing")
    with pytest.raises(ValueError):
        Container.from_bytes(b"NOPE" + data[4:])


def test_container_output_is_reproducible() -> None:
    def build() -> bytes:
        return Container("t", 1, {"k": 1}).add("a", np.arange(100, dtype=np.int32)).to_bytes()

    assert build() == build()


def test_heights_round_trip_within_half_a_step() -> None:
    grid = Grid("t", 0.0, 3000.0, 30.0, 120, 100)
    heights = rolling_hills(100, 120)
    for step in (0.05, 0.25, 0.5):
        restored, meta = unpack_heights(
            Container.from_bytes(pack_heights(heights, grid, step, "test").to_bytes())
        )
        assert restored.shape == heights.shape
        assert np.abs(restored - heights).max() <= step / 2 + 1e-3
        assert meta["grid"]["width"] == 120 and meta["step"] == step
        assert meta["minHeight"] <= meta["maxHeight"]


def test_heights_reject_bad_input() -> None:
    grid = Grid("t", 0.0, 300.0, 30.0, 10, 10)
    with pytest.raises(ValueError, match="grid"):
        pack_heights(np.zeros((5, 5), np.float32), grid, 0.1, "test")
    holes = np.zeros((10, 10), np.float32)
    holes[2, 2] = np.nan
    with pytest.raises(ValueError, match="missing"):
        pack_heights(holes, grid, 0.1, "test")
    tall = np.zeros((10, 10), np.float32)
    tall[0, 0] = 9000.0
    with pytest.raises(ValueError, match="does not fit"):
        pack_heights(tall, grid, 0.05, "test")
