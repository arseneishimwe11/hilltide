import type { BuildingTile } from "../data/buildings";

/** Heights are stored in one byte per year; this is the height a full byte stands for, in metres. */
export const HEIGHT_RANGE = 127.5;

/** Ground under a building: height at its centre and how steeply the land slopes there. */
export interface Ground {
  /** Terrain height in metres. */
  readonly height: number;
  /** Rise over run of the steepest direction (0 on flat ground). */
  readonly slope: number;
}

/**
 * Per-building data in the layout the GPU reads, one entry per building:
 *
 *   place    x, y of the centre; z of the box's base; depth the base is sunk
 *   shape    long side, short side, angle of the long side, first-year index
 *   heights  eight bytes: height in each year, as a share of HEIGHT_RANGE
 */
export interface InstanceArrays {
  readonly count: number;
  readonly place: Float32Array;
  readonly shape: Float32Array;
  readonly heightsA: Uint8Array;
  readonly heightsB: Uint8Array;
}

/** Deepest a building's base is sunk into a slope, in metres. */
const MAX_SINK = 12;

/**
 * Builds the GPU arrays for one tile. On a slope a box's downhill edge would
 * hang in the air, so each base is sunk by the drop across half the
 * building; the roof stays at ground height plus the building's height.
 */
export function buildInstanceArrays(
  tile: BuildingTile,
  groundAt: (x: number, y: number) => Ground,
): InstanceArrays {
  const years = tile.meta.years.length;
  if (years !== 8) throw new Error(`Expected 8 years of building heights, got ${years}`);
  const count = tile.count;
  const place = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  const heightsA = new Uint8Array(count * 4);
  const heightsB = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = tile.x[i] as number;
    const y = tile.y[i] as number;
    const length = tile.length[i] as number;
    const ground = groundAt(x, y);
    const sink = Math.min((ground.slope * length) / 2 + 0.3, MAX_SINK);
    place.set([x, y, ground.height - sink, sink], i * 4);
    shape.set(
      [length, tile.width[i] as number, tile.angle[i] as number, tile.first[i] as number],
      i * 4,
    );
    for (let year = 0; year < 8; year++) {
      const metres = tile.height[i * 8 + year] as number;
      const stored = Math.min(255, Math.round((metres / HEIGHT_RANGE) * 255));
      (year < 4 ? heightsA : heightsB)[i * 4 + (year % 4)] = stored;
    }
  }
  return { count, place, shape, heightsA, heightsB };
}

/**
 * Weights that turn eight yearly heights into the height at a moment
 * between years: height = sum of height[k] * weight[k]. Only the two years
 * around `yearIndex` get weight, in proportion to how close they are.
 *
 * Because a building's height is zero before its first year, the same sum
 * makes it rise from the ground during the year before it first appears.
 */
export function yearWeights(yearIndex: number): number[] {
  const position = Math.min(Math.max(yearIndex, 0), 7);
  return Array.from({ length: 8 }, (_unused, k) => Math.max(0, 1 - Math.abs(position - k)));
}

/** A building's height at a moment between years, the same sum the shader computes. */
export function heightAt(heights: ArrayLike<number>, yearIndex: number): number {
  return yearWeights(yearIndex).reduce(
    (sum, weight, k) => sum + weight * (heights[k] as number),
    0,
  );
}
