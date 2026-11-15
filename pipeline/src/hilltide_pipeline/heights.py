"""Packing terrain heights into the web asset format, and reading them back."""

from __future__ import annotations

import numpy as np

from .codecs import decode_plane16, encode_plane16
from .container import Container
from .grid import Grid

KIND = "heights"
VERSION = 1


def quantize(heights: np.ndarray, step: float) -> tuple[np.ndarray, float]:
    """Heights in metres to uint16 steps above a base height.

    Returns the quantized grid and the base, so that
    height = base + step * value, exact to within step / 2.
    """
    if not np.isfinite(heights).all():
        raise ValueError("Heights contain missing values; fill them before packing")
    base = float(np.floor(heights.min()))
    steps = np.rint((heights.astype(np.float64) - base) / step)
    if steps.max() > 65535:
        raise ValueError(f"Height range {heights.max() - base:.0f} m does not fit at step {step} m")
    return steps.astype(np.uint16), base


def pack_heights(heights: np.ndarray, grid: Grid, step: float, source: str) -> Container:
    """Build the heights asset for one grid."""
    if heights.shape != grid.shape:
        raise ValueError(f"Heights are {heights.shape}, grid {grid.name} is {grid.shape}")
    quantized, base = quantize(heights, step)
    restored = base + step * quantized.astype(np.float64)
    meta = {
        "grid": grid.describe(),
        "base": base,
        "step": step,
        "minHeight": float(restored.min()),
        "maxHeight": float(restored.max()),
        "source": source,
    }
    container = Container(KIND, VERSION, meta)
    container.add(
        "heights",
        encode_plane16(quantized),
        encoding="plane16",
        decoded_dtype="u16",
        decoded_count=quantized.size,
    )
    return container


def unpack_heights(container: Container) -> tuple[np.ndarray, dict]:
    """Heights in metres (float32) and the asset metadata."""
    if container.kind != KIND:
        raise ValueError(f"Expected a heights asset, got {container.kind}")
    meta = container.meta
    height, width = meta["grid"]["height"], meta["grid"]["width"]
    quantized = decode_plane16(container.section("heights").data, height, width)
    return (meta["base"] + meta["step"] * quantized.astype(np.float64)).astype(np.float32), meta
