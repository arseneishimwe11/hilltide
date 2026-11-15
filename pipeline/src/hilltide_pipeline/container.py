"""The Hilltide asset container: one small binary format for every web asset.

GitHub Pages does not compress arbitrary binary files in transit, so each
asset carries its own gzip-compressed sections, which the browser unpacks
with DecompressionStream.

Layout (all integers little-endian):

    bytes 0..3    magic  b"HLT1"
    bytes 4..7    uint32 length N of the header
    bytes 8..8+N  header: UTF-8 JSON, padded with spaces so that 8+N is a
                  multiple of 8
    then          section payloads, back to back

Header JSON:

    {
      "kind":     string, what the asset is ("heights", "buildings", ...),
      "version":  integer, format version of that kind,
      "meta":     object, kind-specific metadata,
      "sections": [ { "name", "dtype", "count", "encoding",
                      "offset", "length", "compression" }, ... ]
    }

`offset` is relative to the first byte after the header. `dtype` is one of
u8, i8, u16, i16, u32, i32, f32. `encoding` names the reversible transform
applied before compression (see codecs.py); "raw" means none.
"""

from __future__ import annotations

import gzip
import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

MAGIC = b"HLT1"

DTYPES: dict[str, np.dtype] = {
    "u8": np.dtype("<u1"),
    "i8": np.dtype("<i1"),
    "u16": np.dtype("<u2"),
    "i16": np.dtype("<i2"),
    "u32": np.dtype("<u4"),
    "i32": np.dtype("<i4"),
    "f32": np.dtype("<f4"),
}


def dtype_name(dtype: np.dtype) -> str:
    for name, candidate in DTYPES.items():
        if np.dtype(dtype).newbyteorder("<") == candidate:
            return name
    raise ValueError(f"Unsupported dtype {dtype}")


@dataclass
class Section:
    """One named array inside a container, already transformed by its encoding."""

    name: str
    data: np.ndarray
    encoding: str = "raw"
    #: dtype and element count of the decoded array, when the encoding changes them.
    decoded_dtype: str | None = None
    decoded_count: int | None = None


@dataclass
class Container:
    kind: str
    version: int
    meta: dict = field(default_factory=dict)
    sections: list[Section] = field(default_factory=list)

    def add(self, name: str, data: np.ndarray, encoding: str = "raw", **decoded) -> Container:
        self.sections.append(Section(name, np.ascontiguousarray(data), encoding, **decoded))
        return self

    def section(self, name: str) -> Section:
        for section in self.sections:
            if section.name == name:
                return section
        raise KeyError(name)

    def to_bytes(self) -> bytes:
        payloads: list[bytes] = []
        entries: list[dict] = []
        offset = 0
        for section in self.sections:
            raw = section.data.astype(section.data.dtype.newbyteorder("<"), copy=False).tobytes()
            # mtime=0 keeps the output byte-identical between runs.
            packed = gzip.compress(raw, compresslevel=9, mtime=0)
            entries.append(
                {
                    "name": section.name,
                    "dtype": section.decoded_dtype or dtype_name(section.data.dtype),
                    "count": int(section.decoded_count or section.data.size),
                    "storedDtype": dtype_name(section.data.dtype),
                    "storedCount": int(section.data.size),
                    "encoding": section.encoding,
                    "offset": offset,
                    "length": len(packed),
                    "compression": "gzip",
                }
            )
            payloads.append(packed)
            offset += len(packed)
        header = json.dumps(
            {"kind": self.kind, "version": self.version, "meta": self.meta, "sections": entries},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        header += b" " * (-(8 + len(header)) % 8)
        return MAGIC + struct.pack("<I", len(header)) + header + b"".join(payloads)

    def write(self, path: Path) -> int:
        data = self.to_bytes()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return len(data)

    @staticmethod
    def from_bytes(data: bytes) -> Container:
        if data[:4] != MAGIC:
            raise ValueError("Not a Hilltide asset (bad magic)")
        (header_length,) = struct.unpack("<I", data[4:8])
        header = json.loads(data[8 : 8 + header_length].decode("utf-8"))
        body = memoryview(data)[8 + header_length :]
        container = Container(header["kind"], header["version"], header["meta"])
        for entry in header["sections"]:
            packed = bytes(body[entry["offset"] : entry["offset"] + entry["length"]])
            raw = gzip.decompress(packed) if entry["compression"] == "gzip" else packed
            stored = np.frombuffer(raw, dtype=DTYPES[entry["storedDtype"]])
            if stored.size != entry["storedCount"]:
                raise ValueError(f"Section {entry['name']}: wrong element count")
            container.sections.append(
                Section(
                    entry["name"],
                    stored,
                    entry["encoding"],
                    decoded_dtype=entry["dtype"],
                    decoded_count=entry["count"],
                )
            )
        return container

    @staticmethod
    def read(path: Path) -> Container:
        return Container.from_bytes(path.read_bytes())
