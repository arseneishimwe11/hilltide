"""Reversible transforms applied to arrays before compression.

Each transform makes smooth data look like small numbers, which gzip then
packs tightly. Every encoder here has an exact decoder; the web app has the
matching decoders in TypeScript (web/src/core/codecs.ts).

Encodings:

- "raw":       no transform.
- "plane16":   for 2D uint16 grids. Each value is predicted from its left,
               upper and upper-left neighbours (left + up - upleft), the
               difference is zigzag-coded, and the low and high bytes are
               stored as two separate planes. Output: uint8, 2 x count.
- "delta16":   for 1D uint16 sequences. Difference from the previous value,
               zigzag-coded, bytes split into two planes. Output: uint8,
               2 x count.
- "delta32":   for 1D int32 sequences. Difference from the previous value,
               zigzag-coded, bytes split into four planes. Output: uint8,
               4 x count.
"""

from __future__ import annotations

import numpy as np


def zigzag16(values: np.ndarray) -> np.ndarray:
    """Signed 16-bit differences to unsigned: 0, -1, 1, -2, ... -> 0, 1, 2, 3, ..."""
    signed = values.astype(np.int16)
    return ((signed.astype(np.int32) << 1) ^ (signed.astype(np.int32) >> 15)).astype(np.uint16)


def unzigzag16(values: np.ndarray) -> np.ndarray:
    unsigned = values.astype(np.uint16)
    return ((unsigned >> 1).astype(np.int32) ^ -(unsigned & 1).astype(np.int32)).astype(np.int16)


def zigzag32(values: np.ndarray) -> np.ndarray:
    signed = values.astype(np.int64)
    return ((signed << 1) ^ (signed >> 63)).astype(np.uint32)


def unzigzag32(values: np.ndarray) -> np.ndarray:
    unsigned = values.astype(np.int64)
    return ((unsigned >> 1) ^ -(unsigned & 1)).astype(np.int32)


def _split_bytes(values: np.ndarray, width: int) -> np.ndarray:
    as_bytes = values.astype(f"<u{width}").view(np.uint8).reshape(-1, width)
    return np.ascontiguousarray(as_bytes.T).reshape(-1)


def _join_bytes(planes: np.ndarray, width: int) -> np.ndarray:
    count = planes.size // width
    as_bytes = np.ascontiguousarray(planes.reshape(width, count).T)
    return as_bytes.view(f"<u{width}").reshape(-1)


def encode_plane16(grid: np.ndarray) -> np.ndarray:
    """2D uint16 grid -> uint8 planes (see module docstring)."""
    if grid.ndim != 2 or grid.dtype != np.uint16:
        raise ValueError("plane16 needs a 2D uint16 array")
    # value - (left + up - upleft) is the difference along rows of the
    # difference along columns, with zeros assumed outside the grid.
    q = grid.astype(np.int64)
    residual = np.diff(np.diff(q, axis=1, prepend=0), axis=0, prepend=0)
    # Differences wrap modulo 65536, exactly as the decoder's sums do.
    wrapped = ((residual + 32768) % 65536 - 32768).astype(np.int16)
    return _split_bytes(zigzag16(wrapped).reshape(-1), 2)


def decode_plane16(planes: np.ndarray, height: int, width: int) -> np.ndarray:
    """Inverse of encode_plane16: a running sum along rows, then along columns."""
    residual = unzigzag16(_join_bytes(planes, 2)).astype(np.int64).reshape(height, width)
    return (np.cumsum(np.cumsum(residual, axis=1), axis=0) % 65536).astype(np.uint16)


def encode_delta16(values: np.ndarray) -> np.ndarray:
    if values.ndim != 1 or values.dtype != np.uint16:
        raise ValueError("delta16 needs a 1D uint16 array")
    q = values.astype(np.int32)
    residual = np.diff(q, prepend=0)
    wrapped = ((residual + 32768) % 65536 - 32768).astype(np.int16)
    return _split_bytes(zigzag16(wrapped), 2)


def decode_delta16(planes: np.ndarray) -> np.ndarray:
    residual = unzigzag16(_join_bytes(planes, 2)).astype(np.int64)
    return (np.cumsum(residual) % 65536).astype(np.uint16)


def encode_delta32(values: np.ndarray) -> np.ndarray:
    if values.ndim != 1 or values.dtype != np.int32:
        raise ValueError("delta32 needs a 1D int32 array")
    residual = np.diff(values.astype(np.int64), prepend=0)
    if residual.size and (residual.min() < -(2**31) or residual.max() >= 2**31):
        raise ValueError("delta32: difference does not fit in 32 bits")
    return _split_bytes(zigzag32(residual), 4)


def decode_delta32(planes: np.ndarray) -> np.ndarray:
    residual = unzigzag32(_join_bytes(planes, 4)).astype(np.int64)
    return np.cumsum(residual).astype(np.int32)
