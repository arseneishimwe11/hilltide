import { describe, expect, it } from "vitest";
import type { HeightField } from "../data/heights";
import { LandClass } from "../data/landcover";
import { lightingFor } from "../sky/lighting";
import { hexToLinear, LAND_COLOURS, PALETTE_SIZE, paletteTexels } from "./palette";
import { buildTerrainTexels } from "./terrainTexels";

function field(width: number, height: number, fn: (x: number, y: number) => number): HeightField {
  const cell = 30;
  const grid = { name: "t", xMin: 0, yMax: height * cell, cell, width, height };
  const heights = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      heights[row * width + col] = fn((col + 0.5) * cell, grid.yMax - (row + 0.5) * cell);
    }
  }
  return { grid, heights, minHeight: 0, maxHeight: 0, source: "test" };
}

describe("terrain texels", () => {
  it("stores height, east slope, north slope and class", () => {
    // A plane rising 0.2 m per metre east and 0.05 m per metre north.
    const plane = field(8, 6, (x, y) => 1000 + 0.2 * x + 0.05 * y);
    const classes = new Uint8Array(48).fill(LandClass.Cropland);
    const texels = buildTerrainTexels(plane, classes);
    expect(texels.length).toBe(8 * 6 * 4);
    for (let i = 0; i < 48; i++) {
      expect(texels[i * 4]).toBeCloseTo(plane.heights[i] as number, 3);
      expect(texels[i * 4 + 1]).toBeCloseTo(0.2, 4); // also correct on the edges
      expect(texels[i * 4 + 2]).toBeCloseTo(0.05, 4);
      expect(texels[i * 4 + 3]).toBe(LandClass.Cropland);
    }
  });

  it("gives a peak zero slope at its top and outward slopes around it", () => {
    const peak = field(9, 9, (x, y) => 500 - Math.hypot(x - 135, y - 135));
    const texels = buildTerrainTexels(peak, null);
    const at = (row: number, col: number, channel: number): number =>
      texels[(row * 9 + col) * 4 + channel] as number;
    expect(at(4, 4, 1)).toBeCloseTo(0);
    expect(at(4, 4, 2)).toBeCloseTo(0);
    expect(at(4, 6, 1)).toBeLessThan(0); // east of the peak the ground falls eastward
    expect(at(4, 2, 1)).toBeGreaterThan(0);
    expect(at(2, 4, 2)).toBeLessThan(0); // north of the peak (row 2) it falls northward
    expect(at(6, 4, 2)).toBeGreaterThan(0);
    expect(at(0, 0, 3)).toBe(0); // no land cover given
  });

  it("rejects mismatched inputs", () => {
    const plane = field(4, 4, () => 0);
    expect(() => buildTerrainTexels(plane, new Uint8Array(3))).toThrow(/Land cover/);
    expect(() => buildTerrainTexels({ ...plane, heights: new Float32Array(5) }, null)).toThrow(
      /does not match/,
    );
  });
});

describe("palette", () => {
  it("has a colour for every class code and converts to linear", () => {
    const texels = paletteTexels();
    expect(texels.length).toBe(PALETTE_SIZE * 4);
    for (const code of Object.values(LandClass)) {
      expect(LAND_COLOURS[code]).toBeDefined();
      expect(texels[code * 4 + 3]).toBe(1);
    }
    expect(hexToLinear(0xffffff)).toEqual([1, 1, 1]);
    expect(hexToLinear(0x000000)).toEqual([0, 0, 0]);
    expect(hexToLinear(0x808080)[0]).toBeCloseTo(0.2159, 3);
  });

  it("keeps water darker than land so lakes read at a glance", () => {
    const luminance = (hex: number): number => {
      const [r, g, b] = hexToLinear(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const water = luminance(LAND_COLOURS[LandClass.Water] as number);
    for (const code of [
      LandClass.Trees,
      LandClass.Cropland,
      LandClass.Grassland,
      LandClass.BuiltUp,
    ]) {
      expect(luminance(LAND_COLOURS[code] as number)).toBeGreaterThan(water * 1.5);
    }
  });
});

describe("lighting", () => {
  const at = (elevation: number, azimuth = 120) =>
    lightingFor({ elevation, azimuth, declination: 0 });
  const brightness = (colour: readonly number[]): number =>
    (colour[0] as number) + (colour[1] as number) + (colour[2] as number);

  it("gets brighter as the sun climbs", () => {
    const elevations = [-30, -10, -3, 2, 10, 30, 80];
    const light = elevations.map(
      (e) => brightness(at(e).lightColour) + brightness(at(e).ambientColour),
    );
    for (let i = 1; i < light.length; i++) {
      expect(light[i]).toBeGreaterThanOrEqual(light[i - 1] as number);
    }
  });

  it("is warm at golden hour and neutral at noon", () => {
    const golden = at(6).lightColour;
    const noon = at(65).lightColour;
    expect(golden[0] / golden[2]).toBeGreaterThan(1.8);
    expect(noon[0] / noon[2]).toBeLessThan(1.3);
  });

  it("points the light at the sun by day and at a high moon by night", () => {
    const day = at(40, 90);
    expect(day.moonlit).toBe(false);
    expect(day.lightDirection[0]).toBeGreaterThan(0.7); // sun in the east
    expect(day.lightDirection[2]).toBeCloseTo(Math.sin((40 * Math.PI) / 180));
    const night = at(-40, 90);
    expect(night.moonlit).toBe(true);
    expect(night.lightDirection[0]).toBeLessThan(0); // moon opposite the sun
    expect(night.lightDirection[2]).toBeGreaterThan(0.5);
    expect(night.night).toBe(1);
    expect(day.night).toBe(0);
  });

  it("never lights the land from below the horizon", () => {
    for (const elevation of [-90, -20, -5, -1, 0, 1, 3]) {
      expect(at(elevation).lightDirection[2]).toBeGreaterThan(0.05);
      expect(Math.hypot(...at(elevation).lightDirection)).toBeCloseTo(1);
    }
  });

  it("stays legible at night: some light always remains", () => {
    const night = at(-60);
    expect(brightness(night.lightColour)).toBeGreaterThan(0.3);
    expect(brightness(night.ambientColour)).toBeGreaterThan(0.1);
  });
});
