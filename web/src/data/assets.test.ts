import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type BuildingStats, decodeBuildingTile } from "./buildings";
import { decodeDelta16, decodeDelta32, decodePlane16 } from "./codecs";
import { Container } from "./container";
import { decodeHeights, sampleHeight } from "./heights";
import { decodeLandCover, LandClass } from "./landcover";
import { decodeLines, totalLength } from "./lines";
import { assetEntry, parseManifest } from "./manifest";

/** These tests read the real assets the pipeline committed under public/data. */
const dataDir = fileURLToPath(new URL("../../public/data/", import.meta.url));

function load(relative: string): ArrayBuffer {
  const file = readFileSync(`${dataDir}${relative}`);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

const manifest = parseManifest(JSON.parse(readFileSync(`${dataDir}manifest.json`, "utf8")));

/** Byte planes for the given 16-bit zigzag residuals: all low bytes, then all high bytes. */
function planes16(residuals: number[]): Uint8Array {
  const zig = residuals.map((value) => ((value << 1) ^ (value >> 15)) & 0xffff);
  return Uint8Array.from([...zig.map((value) => value & 0xff), ...zig.map((value) => value >> 8)]);
}

describe("codecs", () => {
  it("decodes delta16 with wrap-around", () => {
    expect(Array.from(decodeDelta16(planes16([5, 3, -2, -7, 1])))).toEqual([5, 8, 6, 65535, 0]);
  });

  it("decodes plane16 as a running sum along rows, then columns", () => {
    // Grid [[10, 12], [11, 300]] has residuals [[10, 2], [1, 287]].
    const grid = decodePlane16(planes16([10, 2, 1, 287]), 2, 2);
    expect(Array.from(grid)).toEqual([10, 12, 11, 300]);
  });

  it("decodes delta32 including negative values", () => {
    const residuals = [100000, -100001, 7];
    const zig = residuals.map((value) => ((value << 1) ^ (value >> 31)) >>> 0);
    const bytes = new Uint8Array(zig.length * 4);
    zig.forEach((value, i) => {
      for (let plane = 0; plane < 4; plane++) {
        bytes[plane * zig.length + i] = (value >>> (plane * 8)) & 0xff;
      }
    });
    expect(Array.from(decodeDelta32(bytes))).toEqual([100000, -1, 6]);
  });

  it("rejects byte planes of the wrong length", () => {
    expect(() => decodeDelta16(new Uint8Array(3))).toThrow(/do not divide/);
    expect(() => decodePlane16(new Uint8Array(8), 3, 3)).toThrow(/expected 9 values/);
  });
});

describe("asset container", () => {
  it("rejects data that is not a Hilltide asset", () => {
    expect(() => Container.parse(new Uint8Array(16).buffer)).toThrow(/bad magic/);
  });

  it("checks kind and version", () => {
    const container = Container.parse(load("terrain/kigali.hlt"));
    expect(container.kind).toBe("heights");
    expect(() => container.expect("buildings", 1)).toThrow(/Expected a "buildings" asset/);
    expect(() => container.expect("heights", 99)).toThrow(/version 99/);
  });
});

describe("terrain assets from the pipeline", () => {
  it.each(["country", "region", "kigali"])("decodes the %s level", async (level) => {
    const entry = assetEntry(manifest, `terrain.${level}`);
    const data = load(entry.path);
    expect(data.byteLength).toBe(entry.bytes);

    const field = await decodeHeights(data);
    expect(field.heights.length).toBe(field.grid.width * field.grid.height);

    // The decoded range must match what the pipeline measured before packing.
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const height of field.heights) {
      if (height < min) min = height;
      if (height > max) max = height;
    }
    expect(min).toBeCloseTo(field.minHeight, 3);
    expect(max).toBeCloseTo(field.maxHeight, 3);
  });

  it("puts Kigali's known places at plausible heights", async () => {
    const field = await decodeHeights(load(assetEntry(manifest, "terrain.kigali").path));
    expect(field.grid.width).toBe(1280);
    expect(field.grid.cell).toBe(30);
    // Local coordinates computed by the pipeline's projection (tested there):
    // the city centre plateau is near 1,540 m; the Nyabugogo valley floor near 1,370 m.
    const centre = sampleHeight(field, 6890, 6181);
    const valley = sampleHeight(field, 4898, 6745);
    expect(centre).toBeGreaterThan(1480);
    expect(centre).toBeLessThan(1620);
    expect(valley).toBeGreaterThan(1340);
    expect(valley).toBeLessThan(1420);
    expect(centre - valley).toBeGreaterThan(100);
  });

  it("samples exactly at cell centres and clamps outside the grid", async () => {
    const field = await decodeHeights(load(assetEntry(manifest, "terrain.kigali").path));
    const { grid, heights } = field;
    const row = 400;
    const col = 700;
    const x = grid.xMin + (col + 0.5) * grid.cell;
    const y = grid.yMax - (row + 0.5) * grid.cell;
    expect(sampleHeight(field, x, y)).toBeCloseTo(heights[row * grid.width + col] as number, 3);
    expect(sampleHeight(field, grid.xMin - 5000, grid.yMax + 5000)).toBeCloseTo(
      heights[0] as number,
      3,
    );
  });
});

describe("line assets from the pipeline", () => {
  it.each(["water.country", "water.kigali", "border.country", "border.kigali"])(
    "decodes %s with the length the pipeline measured",
    async (key) => {
      const entry = assetEntry(manifest, key);
      const lines = await decodeLines(load(entry.path));
      expect(lines.starts.length).toBe(lines.meta.lineCount + 1);
      expect(lines.positions.length).toBe(lines.meta.pointCount * 2);
      expect(lines.starts.at(-1)).toBe(lines.meta.pointCount);
      // Stored at 0.1 m: the decoded length matches to well under a tenth of a percent.
      expect(totalLength(lines) / 1000).toBeCloseTo(lines.meta.lengthKm, -1);
      expect(Math.abs(totalLength(lines) / 1000 / lines.meta.lengthKm - 1)).toBeLessThan(1e-3);
    },
  );

  it("names the Nyabarongo among Kigali's waterways", async () => {
    const lines = await decodeLines(load(assetEntry(manifest, "water.kigali").path));
    expect(lines.names).toContain("Nyabarongo");
    expect(new Set(lines.kind)).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe("land cover assets from the pipeline", () => {
  it("decodes the country level with Lake Kivu as water", async () => {
    const cover = await decodeLandCover(load(assetEntry(manifest, "landcover.country").path));
    const { grid, classes } = cover;
    expect(classes.length).toBe(grid.width * grid.height);
    // Middle of Lake Kivu: about 29.2 E, 2.0 S, which is x = -89 km, y = 0 km.
    const col = Math.floor((-89_000 - grid.xMin) / grid.cell);
    const row = Math.floor((grid.yMax - 0) / grid.cell);
    expect(classes[row * grid.width + col]).toBe(LandClass.Water);
    let water = 0;
    for (const code of classes) if (code === LandClass.Water) water++;
    expect(water / classes.length).toBeCloseTo(cover.meta.share[String(LandClass.Water)] ?? -1, 4);
  });
});

describe("building assets from the pipeline", () => {
  const stats = JSON.parse(
    readFileSync(`${dataDir}${assetEntry(manifest, "buildings.stats").path}`, "utf8"),
  ) as BuildingStats;

  it("has yearly totals that only grow, for the grid and the city", () => {
    expect(stats.years).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]);
    for (const rows of [stats.grid.byYear, stats.city.byYear]) {
      expect(rows.map((row) => row.year)).toEqual(stats.years);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]?.buildings).toBeGreaterThanOrEqual(rows[i - 1]?.buildings ?? 0);
        expect(rows[i]?.footprintKm2).toBeGreaterThanOrEqual(rows[i - 1]?.footprintKm2 ?? 0);
      }
    }
    expect(stats.city.byYear.at(-1)?.buildings).toBeLessThanOrEqual(
      stats.grid.byYear.at(-1)?.buildings ?? 0,
    );
  });

  it("accounts for every footprint: dated, too faint, or not steadily present", () => {
    const { used, dated, tooFaintToDate, notSteadilyPresent } = stats.footprints;
    expect(dated + tooFaintToDate + notSteadilyPresent).toBe(used);
    expect(stats.grid.byYear.at(-1)?.buildings).toBe(dated);
  });

  it("has tiles whose counts add up to the dated total", () => {
    const total = stats.tiles.list.reduce((sum, tile) => sum + tile.count, 0);
    expect(total).toBe(stats.footprints.dated);
    for (const tile of stats.tiles.list) {
      const entry = assetEntry(manifest, `buildings.tile.${tile.col}.${tile.row}`);
      expect(entry.info.count).toBe(tile.count);
      expect(tile.countByFirstYear.reduce((sum, n) => sum + n, 0)).toBe(tile.count);
    }
  });

  it("decodes the densest tile: inside its square, largest first, nothing before its first year", async () => {
    const densest = [...stats.tiles.list].sort((a, b) => b.count - a.count)[0];
    if (densest === undefined) throw new Error("no tiles");
    const entry = assetEntry(manifest, `buildings.tile.${densest.col}.${densest.row}`);
    const tile = await decodeBuildingTile(load(entry.path));
    const years = tile.meta.years.length;

    expect(tile.count).toBe(densest.count);
    expect(tile.height.length).toBe(tile.count * years);
    const [x0, y0] = tile.meta.origin;
    const byFirstYear = new Array<number>(years).fill(0);
    let previousArea = Number.POSITIVE_INFINITY;
    for (let i = 0; i < tile.count; i++) {
      const x = tile.x[i] as number;
      const y = tile.y[i] as number;
      expect(x).toBeGreaterThanOrEqual(x0);
      expect(x).toBeLessThanOrEqual(x0 + tile.meta.tileSize);
      expect(y).toBeGreaterThanOrEqual(y0);
      expect(y).toBeLessThanOrEqual(y0 + tile.meta.tileSize);

      const length = tile.length[i] as number;
      const width = tile.width[i] as number;
      expect(length).toBeGreaterThanOrEqual(width - 0.11);
      // Sorted by footprint area, up to rounding of each side to 0.1 m.
      expect(length * width).toBeLessThanOrEqual(previousArea + 0.11 * (length + width + 1));
      previousArea = length * width;

      const first = tile.first[i] as number;
      byFirstYear[first] = (byFirstYear[first] as number) + 1;
      for (let year = 0; year < years; year++) {
        const height = tile.height[i * years + year] as number;
        if (year < first) expect(height).toBe(0);
        else expect(height).toBeGreaterThanOrEqual(2.5);
      }
    }
    expect(byFirstYear).toEqual(densest.countByFirstYear);
  });
});

describe("manifest", () => {
  it("lists every source with its required credit", () => {
    for (const entry of Object.values(manifest.assets)) {
      for (const source of entry.sources) {
        expect(manifest.sources[source]?.attribution.length, source).toBeGreaterThan(20);
      }
    }
  });

  it("fails clearly on unknown assets and versions", () => {
    expect(() => assetEntry(manifest, "terrain.moon")).toThrow(/not in the manifest/);
    expect(() => parseManifest({ version: 99 })).toThrow(/Unsupported/);
  });
});
