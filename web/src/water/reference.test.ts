import { describe, expect, it } from "vitest";
import { ReferenceSim, type SimLand, uniformLand } from "./reference";
import {
  defaultSettings,
  faceFlow,
  limitedFlow,
  mmPerHour,
  outflowScale,
  type SimSettings,
  stableTimeStep,
} from "./spec";

const CELL = 30;
const settings: SimSettings = defaultSettings(CELL);

function bedFrom(
  width: number,
  height: number,
  fn: (row: number, col: number) => number,
): Float32Array {
  const bed = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) bed[row * width + col] = fn(row, col);
  }
  return bed;
}

/** Rolling hills with pits and ridges: a hard case for any water scheme. */
function hills(width: number, height: number): Float32Array {
  let seed = 12345;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return bedFrom(
    width,
    height,
    (row, col) =>
      1500 +
      40 * Math.sin(col / 5) * Math.cos(row / 7) +
      15 * Math.sin((row + col) / 3) +
      random() * 2,
  );
}

function totalDepth(sim: ReferenceSim): number {
  return sim.depth.reduce((sum, value) => sum + value, 0);
}

function totalLost(sim: ReferenceSim): number {
  return sim.lost.reduce((sum, value) => sum + value, 0);
}

describe("simulation settings", () => {
  it("picks a time step inside the stability limit", () => {
    expect(settings.dt).toBeLessThanOrEqual(stableTimeStep(CELL, settings.depthCap));
    expect(settings.dt).toBeGreaterThan(1.5);
    expect(defaultSettings(60).dt).toBeCloseTo(settings.dt * 2, 0);
  });

  it("converts rainfall rates", () => {
    expect(mmPerHour(36)).toBeCloseTo(1e-5);
  });
});

describe("flow across one face", () => {
  const flow = (bedA: number, depthA: number, bedB: number, depthB: number, old = 0): number =>
    faceFlow(settings, bedA, depthA, bedB, depthB, old, old, old, 0.05);

  it("is zero between level water surfaces", () => {
    expect(flow(10, 2, 11, 1)).toBe(0);
  });

  it("runs from the higher surface to the lower", () => {
    expect(flow(10, 1, 10, 0.2)).toBeGreaterThan(0);
    expect(flow(10, 0.2, 10, 1)).toBeLessThan(0);
    expect(flow(10, 0.2, 10, 1)).toBeCloseTo(-flow(10, 1, 10, 0.2), 10);
  });

  it("cannot pass over a bed that stands above the water", () => {
    expect(flow(10, 1, 12, 0)).toBe(0); // a dry step higher than the water surface
    expect(flow(10, 0, 9, 0)).toBe(0); // nothing to move
  });

  it("is slowed by rougher ground", () => {
    const smooth = faceFlow(settings, 10, 1, 10, 0.2, 0.5, 0.5, 0.5, 0.02);
    const rough = faceFlow(settings, 10, 1, 10, 0.2, 0.5, 0.5, 0.5, 0.2);
    expect(rough).toBeLessThan(smooth);
    expect(rough).toBeGreaterThan(0);
  });

  it("never exceeds the speed of a shallow-water wave", () => {
    const depth = 0.5;
    const huge = faceFlow(settings, 100, depth, 0, 0, 50, 50, 50, 0.001);
    expect(huge).toBeLessThanOrEqual(depth * Math.sqrt(9.81 * depth) + 1e-9);
  });
});

describe("outflow limiter", () => {
  it("leaves affordable flows alone and scales the rest", () => {
    // 0.1 m of water in a 30 m cell can give 0.1 * 30 / dt per metre of face per step.
    const available = (0.1 * CELL) / settings.dt;
    expect(outflowScale(settings, 0.1, available / 4, 0, 0, 0)).toBe(1);
    expect(outflowScale(settings, 0.1, available, -available, 0, 0)).toBeCloseTo(0.5);
    expect(outflowScale(settings, 0, 1, 0, 0, 0)).toBe(0);
  });

  it("counts only flows that leave the cell", () => {
    // East flow negative and west flow positive both bring water in.
    expect(outflowScale(settings, 0.001, -5, 5, -5, 5)).toBe(1);
  });

  it("scales a face by the cell its water leaves", () => {
    expect(limitedFlow(2, 0.25, 1)).toBe(0.5);
    expect(limitedFlow(-2, 1, 0.25)).toBe(-0.5);
  });
});

describe("the four required behaviours", () => {
  it("conserves mass: rain in equals water on the ground plus water removed", () => {
    const width = 48;
    const height = 40;
    const land: SimLand = uniformLand(width, height, hills(width, height), 0.05, mmPerHour(8));
    const sim = new ReferenceSim(land, settings);
    const rain = mmPerHour(60);
    let rained = 0;
    for (let step = 0; step < 600; step++) {
      const falling = step < 350 ? rain : 0; // a storm, then draining
      sim.step(falling);
      rained += falling * settings.dt * width * height;
    }
    const accounted = totalDepth(sim) + totalLost(sim);
    // Stated tolerance: one part in ten thousand of the rain that fell.
    expect(Math.abs(accounted - rained) / rained).toBeLessThan(1e-4);
    // And the pieces are all really there: some stored, some soaked in, some left.
    const totals = sim.totals();
    expect(totals.stored).toBeGreaterThan(0);
    expect(totals.infiltrated).toBeGreaterThan(0);
    expect(totals.outflow).toBeGreaterThan(0);
    expect((totals.stored + totals.infiltrated + totals.outflow) / CELL ** 2).toBeCloseTo(
      accounted,
      1,
    );
  });

  it("keeps still water still: a lake at rest over an uneven bed does not move", () => {
    const width = 30;
    const height = 30;
    // A bowl with an island; the rim is high, so nothing reaches the edge.
    const bed = bedFrom(width, height, (row, col) => {
      const distance = Math.hypot(row - 14.5, col - 14.5);
      return (
        100 +
        0.02 * distance * distance +
        (distance < 3 ? 2.5 : 0) +
        0.3 * Math.sin(row) * Math.cos(col)
      );
    });
    const sim = new ReferenceSim(uniformLand(width, height, bed), settings);
    const level = 101.5;
    for (let i = 0; i < bed.length; i++) sim.depth[i] = Math.max(level - (bed[i] as number), 0);
    const before = Float32Array.from(sim.depth);
    for (let step = 0; step < 300; step++) sim.step(0);
    let moved = 0;
    let fastest = 0;
    for (let i = 0; i < bed.length; i++) {
      moved = Math.max(moved, Math.abs((sim.depth[i] as number) - (before[i] as number)));
      fastest = Math.max(
        fastest,
        Math.abs(sim.flowEast[i] as number),
        Math.abs(sim.flowSouth[i] as number),
      );
    }
    // Float32 storage leaves surfaces level only to about a ten-thousandth of a metre.
    expect(moved).toBeLessThan(2e-4);
    expect(fastest).toBeLessThan(1e-3);
    expect(totalLost(sim)).toBe(0);
  });

  it("flows downhill on a tilted plane, and never uphill", () => {
    const width = 60;
    const height = 12;
    // Falls half a metre per 30 m cell toward the east: a 1.7 percent slope.
    const bed = bedFrom(width, height, (_row, col) => 200 - 0.5 * col);
    const sim = new ReferenceSim(uniformLand(width, height, bed), settings);
    // A block of water near the western end.
    for (let row = 3; row < 9; row++) {
      for (let col = 8; col < 14; col++) sim.depth[row * width + col] = 0.5;
    }
    const centre = (): number => {
      let mass = 0;
      let moment = 0;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const depth = sim.depth[row * width + col] as number;
          mass += depth;
          moment += depth * col;
        }
      }
      return moment / mass;
    };
    const start = centre();
    let previous = start;
    for (let step = 0; step < 120; step++) {
      sim.step(0);
      if (step % 20 === 19) {
        const now = centre();
        expect(now).toBeGreaterThan(previous); // always further downhill
        previous = now;
      }
    }
    expect(previous - start).toBeGreaterThan(5);
    // Nothing climbed west of where the water started.
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < 6; col++) expect(sim.depth[row * width + col]).toBeLessThan(1e-3);
    }
  });

  it("lets water out at the borders", () => {
    const width = 40;
    const height = 10;
    const bed = bedFrom(width, height, (_row, col) => 200 - 0.5 * col);
    const sim = new ReferenceSim(uniformLand(width, height, bed), settings);
    for (let row = 3; row < 7; row++) {
      for (let col = 20; col < 26; col++) sim.depth[row * width + col] = 0.4;
    }
    const initial = totalDepth(sim);
    for (let step = 0; step < 2500; step++) sim.step(0);
    const left = totalDepth(sim);
    // A thin film drains ever more slowly, so "nearly all" rather than "all".
    expect(left).toBeLessThan(initial * 0.05);
    const totals = sim.totals();
    expect(totals.outflow / CELL ** 2).toBeCloseTo(initial - left, 2);
    expect(totals.infiltrated).toBe(0);
    // The edge ring itself never holds water.
    for (let row = 0; row < height; row++) expect(sim.depth[row * width + width - 1]).toBe(0);
  });
});

describe("robustness", () => {
  it("never produces a negative or non-finite depth, even in a violent case", () => {
    const width = 40;
    const height = 40;
    const sim = new ReferenceSim(uniformLand(width, height, hills(width, height), 0.02), settings);
    // A wall of water dropped on steep, pitted terrain, with extreme rain on top.
    for (let row = 10; row < 20; row++) {
      for (let col = 10; col < 20; col++) sim.depth[row * width + col] = 8;
    }
    for (let step = 0; step < 400; step++) {
      sim.step(mmPerHour(300));
      if (step % 50 === 0) {
        for (const depth of sim.depth) {
          expect(Number.isFinite(depth)).toBe(true);
          expect(depth).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("keeps a symmetric case symmetric", () => {
    const size = 31;
    const bed = bedFrom(size, size, (row, col) => 100 + 0.05 * Math.hypot(row - 15, col - 15) ** 2);
    const sim = new ReferenceSim(uniformLand(size, size, bed), settings);
    sim.depth[15 * size + 5] = 2; // west of centre
    sim.depth[15 * size + 25] = 2; // mirrored east of centre
    for (let step = 0; step < 150; step++) sim.step(0);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const mirrored = sim.depth[row * size + (size - 1 - col)] as number;
        expect(sim.depth[row * size + col]).toBeCloseTo(mirrored, 4);
      }
    }
  });

  it("soaks in no more than the ground can take, and nothing where it cannot", () => {
    const width = 12;
    const height = 12;
    const bed = bedFrom(width, height, () => 100); // flat, so the water just sits
    const land = uniformLand(width, height, bed, 0.05, mmPerHour(10));
    land.infiltration[5 * width + 5] = 0; // a sealed cell
    const sim = new ReferenceSim(land, settings);
    const steps = 200;
    for (let step = 0; step < steps; step++) sim.step(mmPerHour(40));
    const most = mmPerHour(10) * settings.dt * steps;
    expect(sim.lost[6 * width + 6]).toBeCloseTo(most, 5);
    expect(sim.lost[5 * width + 5]).toBe(0);
  });
});
