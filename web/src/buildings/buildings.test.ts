import { describe, expect, it } from "vitest";
import type { BuildingTile } from "../data/buildings";
import { allocateInstances, type BudgetOptions, shareAtDistance } from "./budget";
import { buildInstanceArrays, HEIGHT_RANGE, heightAt, yearWeights } from "./instances";

const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];

function tile(buildings: { first: number; height: number; length?: number }[]): BuildingTile {
  const count = buildings.length;
  const height = new Float32Array(count * 8);
  buildings.forEach((building, i) => {
    for (let year = building.first; year < 8; year++) height[i * 8 + year] = building.height;
  });
  return {
    meta: {
      origin: [0, 0],
      tileSize: 3840,
      count,
      years: YEARS,
      lengthUnit: 0.1,
      heightUnit: 0.5,
      angleSteps: 256,
    },
    count,
    x: Float32Array.from(buildings.map((_b, i) => 100 + i * 50)),
    y: Float32Array.from(buildings.map(() => 200)),
    length: Float32Array.from(buildings.map((b) => b.length ?? 12)),
    width: Float32Array.from(buildings.map(() => 8)),
    angle: Float32Array.from(buildings.map(() => 0.5)),
    first: Uint8Array.from(buildings.map((b) => b.first)),
    height,
  };
}

describe("year interpolation", () => {
  it("gives full weight to a whole year and splits between two years", () => {
    expect(yearWeights(3)).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    expect(yearWeights(3.25)).toEqual([0, 0, 0, 0.75, 0.25, 0, 0, 0]);
    expect(yearWeights(0)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(yearWeights(7)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("always sums to one and never looks outside the record", () => {
    for (let y = -1; y <= 8; y += 0.13) {
      expect(yearWeights(y).reduce((sum, w) => sum + w, 0)).toBeCloseTo(1);
    }
    expect(yearWeights(-3)).toEqual(yearWeights(0));
    expect(yearWeights(12)).toEqual(yearWeights(7));
  });

  it("makes a building rise during the year before it first appears", () => {
    const heights = [0, 0, 0, 9, 9, 9, 9, 9]; // first year index 3
    expect(heightAt(heights, 0)).toBe(0);
    expect(heightAt(heights, 2)).toBe(0);
    expect(heightAt(heights, 2.5)).toBeCloseTo(4.5);
    expect(heightAt(heights, 3)).toBe(9);
    expect(heightAt(heights, 6.7)).toBeCloseTo(9);
  });

  it("follows a building that is extended later", () => {
    const heights = [4, 4, 4, 12, 12, 12, 12, 12];
    expect(heightAt(heights, 2.5)).toBeCloseTo(8);
    // Never shrinks as the slider moves forward when the data never shrinks.
    let previous = 0;
    for (let y = 0; y <= 7; y += 0.1) {
      const now = heightAt(heights, y);
      expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = now;
    }
  });
});

describe("instance arrays", () => {
  const flat = () => ({ height: 1500, slope: 0 });

  it("packs place, shape and yearly heights for the GPU", () => {
    const arrays = buildInstanceArrays(
      tile([
        { first: 0, height: 6 },
        { first: 3, height: 51 },
      ]),
      flat,
    );
    expect(arrays.count).toBe(2);
    expect(Array.from(arrays.place.subarray(0, 2))).toEqual([100, 200]);
    expect(arrays.place[2]).toBeCloseTo(1500 - 0.3, 3); // base just under the ground
    expect(Array.from(arrays.shape.subarray(4, 8))).toEqual([12, 8, 0.5, 3]);
    // First building: 6 m in every year.
    const six = Math.round((6 / HEIGHT_RANGE) * 255);
    expect(Array.from(arrays.heightsA.subarray(0, 4))).toEqual([six, six, six, six]);
    // Second building: nothing in the first three years, then 51 m.
    const tall = Math.round((51 / HEIGHT_RANGE) * 255);
    expect(Array.from(arrays.heightsA.subarray(4, 8))).toEqual([0, 0, 0, tall]);
    expect(Array.from(arrays.heightsB.subarray(4, 8))).toEqual([tall, tall, tall, tall]);
  });

  it("keeps stored heights within a quarter metre of the data", () => {
    const arrays = buildInstanceArrays(tile([{ first: 0, height: 37.5 }]), flat);
    expect(((arrays.heightsA[0] as number) / 255) * HEIGHT_RANGE).toBeCloseTo(37.5, 0);
    expect(Math.abs(((arrays.heightsA[0] as number) / 255) * HEIGHT_RANGE - 37.5)).toBeLessThan(
      0.26,
    );
  });

  it("sinks the base on slopes, more for long buildings, but never absurdly", () => {
    const sloped = () => ({ height: 1500, slope: 0.2 });
    const arrays = buildInstanceArrays(
      tile([
        { first: 0, height: 5, length: 10 },
        { first: 0, height: 5, length: 40 },
        { first: 0, height: 5, length: 400 },
      ]),
      sloped,
    );
    expect(arrays.place[3]).toBeCloseTo(1.3); // 0.2 * 10 / 2 + 0.3
    expect(arrays.place[7]).toBeCloseTo(4.3);
    expect(arrays.place[11]).toBe(12); // capped
    expect(arrays.place[2]).toBeCloseTo(1500 - 1.3);
  });
});

describe("drawing budget", () => {
  const options: BudgetOptions = { budget: 1000, fullDetailDistance: 2000, minShare: 0.05 };

  it("draws near tiles in full and far tiles in part", () => {
    expect(shareAtDistance(500, options)).toBe(1);
    expect(shareAtDistance(2000, options)).toBe(1);
    expect(shareAtDistance(4000, options)).toBeCloseTo(0.25);
    expect(shareAtDistance(100_000, options)).toBe(0.05);
  });

  it("skips tiles outside the view", () => {
    const counts = allocateInstances(
      [
        { count: 300, distance: 1000, visible: true },
        { count: 300, distance: 1000, visible: false },
      ],
      options,
    );
    expect(counts).toEqual([300, 0]);
  });

  it("never exceeds the budget, scaling every tile down together", () => {
    const tiles = Array.from({ length: 10 }, (_unused, i) => ({
      count: 800,
      distance: 1000 + i * 1500,
      visible: true,
    }));
    const counts = allocateInstances(tiles, options);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(1000);
    expect(counts[0]).toBeGreaterThan(counts[5] as number); // near tiles still get more
    expect(counts.every((n, i) => n <= (tiles[i]?.count ?? 0))).toBe(true);
  });

  it("draws everything when the budget allows", () => {
    const counts = allocateInstances([{ count: 120, distance: 500, visible: true }], {
      ...options,
      budget: 1_000_000,
    });
    expect(counts).toEqual([120]);
  });
});
