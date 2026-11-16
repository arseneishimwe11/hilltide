import { describe, expect, it } from "vitest";
import {
  type CameraKey,
  dampPose,
  keepAboveGround,
  nearestKeyTime,
  poseDistance,
  samplePath,
  tiltForPortrait,
} from "./cameraPath";
import {
  type Chapter,
  chapterAt,
  chapterOpacity,
  scrollForProgress,
  sectionProgress,
} from "./scroll";

const keys: CameraKey[] = [
  { t: 0, position: [0, -40_000, 330_000], target: [0, 0, 1500] },
  { t: 0.4, position: [-90_000, -20_000, 60_000], target: [-60_000, 0, 1500] },
  { t: 0.8, position: [-40_000, -5_000, 9_000], target: [-10_000, 3_000, 1800] },
  { t: 1, position: [-2_000, -6_000, 4_200], target: [10_000, 7_000, 1450] },
];

describe("camera path", () => {
  it("passes exactly through every key", () => {
    for (const key of keys) {
      const pose = samplePath(keys, key.t);
      for (let axis = 0; axis < 3; axis++) {
        expect(pose.position[axis]).toBeCloseTo(key.position[axis] as number, 3);
        expect(pose.target[axis]).toBeCloseTo(key.target[axis] as number, 3);
      }
    }
  });

  it("holds the end poses outside the story", () => {
    expect(samplePath(keys, -1)).toEqual(samplePath(keys, 0));
    expect(samplePath(keys, 2)).toEqual(samplePath(keys, 1));
  });

  it("has no jumps: small steps in progress give small steps in pose", () => {
    let previous = samplePath(keys, 0);
    for (let step = 1; step <= 1000; step++) {
      const pose = samplePath(keys, step / 1000);
      // The whole path is about 400 km long, so a thousandth of it is well under 3 km.
      expect(poseDistance(previous, pose)).toBeLessThan(3000);
      previous = pose;
    }
  });

  it("descends evenly in logarithmic height and never below the lowest key", () => {
    const lowest = Math.min(...keys.map((key) => key.position[2]));
    for (let step = 0; step <= 200; step++) {
      expect(samplePath(keys, step / 200).position[2]).toBeGreaterThan(lowest * 0.8);
    }
    // Halfway between the first two keys the height is near their geometric mean.
    const mid = samplePath(keys, 0.2).position[2];
    expect(mid).toBeGreaterThan(100_000);
    expect(mid).toBeLessThan(220_000);
  });

  it("works with a single key", () => {
    const only = keys[0] as CameraKey;
    const pose = samplePath([only], 0.5);
    for (let axis = 0; axis < 3; axis++) {
      expect(pose.position[axis]).toBeCloseTo(only.position[axis] as number, 6);
    }
    expect(() => samplePath([], 0)).toThrow(/no keys/);
  });
});

describe("camera damping", () => {
  const from = samplePath(keys, 0);
  const to = samplePath(keys, 1);

  it("covers half the distance per half-life, at any frame rate", () => {
    const oneStep = dampPose(from, to, 0.5, 0.5);
    let manySteps = from;
    for (let i = 0; i < 50; i++) manySteps = dampPose(manySteps, to, 0.01, 0.5);
    expect(oneStep.position[2]).toBeCloseTo((from.position[2] + to.position[2]) / 2, 3);
    expect(manySteps.position[2]).toBeCloseTo(oneStep.position[2], 3);
  });

  it("jumps straight to the goal with no half-life (reduced motion)", () => {
    expect(dampPose(from, to, 0.016, 0)).toEqual(to);
  });

  it("converges", () => {
    let pose = from;
    for (let i = 0; i < 600; i++) pose = dampPose(pose, to, 1 / 60, 0.25);
    expect(poseDistance(pose, to)).toBeLessThan(1);
  });
});

describe("ground clearance", () => {
  it("lifts a camera that is too low and leaves others alone", () => {
    const ground = (): number => 1500;
    const low = keepAboveGround({ position: [0, 0, 1520], target: [1, 1, 1500] }, ground, 150);
    expect(low.position).toEqual([0, 0, 1650]);
    const high = { position: [0, 0, 9000], target: [1, 1, 1500] } as const;
    expect(keepAboveGround(high, ground, 150)).toBe(high);
  });
});

describe("reduced motion", () => {
  it("snaps progress to the nearest fixed view", () => {
    expect(nearestKeyTime(keys, 0.05)).toBe(0);
    expect(nearestKeyTime(keys, 0.25)).toBe(0.4);
    expect(nearestKeyTime(keys, 0.61)).toBe(0.8);
    expect(nearestKeyTime(keys, 0.95)).toBe(1);
    expect(nearestKeyTime([], 0.5)).toBe(0);
  });
});

describe("portrait framing", () => {
  const low = { position: [0, 0, 5000], target: [10_000, 0, 1500] } as const;

  it("leaves landscape views alone", () => {
    expect(tiltForPortrait(low, 1.6, 38)).toBe(low);
    expect(tiltForPortrait(low, 1, 38)).toBe(low);
  });

  it("looks further down on a tall screen, more so the taller it is", () => {
    const phone = tiltForPortrait(low, 0.5, 38);
    const tablet = tiltForPortrait(low, 0.75, 38);
    expect(phone.position).toEqual(low.position);
    expect(phone.target[2]).toBeLessThan(tablet.target[2]);
    expect(tablet.target[2]).toBeLessThan(low.target[2]);
    // About 7.6 degrees more pitch for a phone: 20 percent of the field of view.
    const pitch = (pose: typeof low): number =>
      (Math.atan2(pose.position[2] - pose.target[2], 10_000) * 180) / Math.PI;
    expect(pitch(phone as typeof low) - pitch(low)).toBeCloseTo(7.6, 1);
  });

  it("never tilts past straight down", () => {
    const steep = { position: [0, 0, 300_000], target: [1000, 0, 1500] } as const;
    const tilted = tiltForPortrait(steep, 0.45, 38);
    expect(Number.isFinite(tilted.target[2])).toBe(true);
    expect(tilted.target[2]).toBeLessThan(steep.position[2]);
  });
});

describe("scroll mapping", () => {
  it("runs from 0 to 1 while the section is pinned", () => {
    // Section at 1000 px, 5000 px tall, viewport 800 px: pinned for 4200 px.
    expect(sectionProgress(0, 1000, 5000, 800)).toBe(0);
    expect(sectionProgress(1000, 1000, 5000, 800)).toBe(0);
    expect(sectionProgress(3100, 1000, 5000, 800)).toBeCloseTo(0.5);
    expect(sectionProgress(5200, 1000, 5000, 800)).toBe(1);
    expect(sectionProgress(9999, 1000, 5000, 800)).toBe(1);
  });

  it("is the inverse of scrollForProgress", () => {
    for (const progress of [0, 0.13, 0.5, 0.99, 1]) {
      const y = scrollForProgress(progress, 1000, 5000, 800);
      expect(sectionProgress(y, 1000, 5000, 800)).toBeCloseTo(progress);
    }
  });

  it("handles a section no taller than the viewport", () => {
    expect(sectionProgress(0, 100, 500, 800)).toBe(0);
    expect(sectionProgress(100, 100, 500, 800)).toBe(1);
  });
});

describe("chapters", () => {
  const chapters: Chapter[] = [
    { id: "country", start: 0, end: 0.3 },
    { id: "hills", start: 0.3, end: 0.75 },
    { id: "kigali", start: 0.75, end: 1 },
  ];

  it("assigns every progress value to one chapter", () => {
    expect(chapterAt(chapters, 0)?.id).toBe("country");
    expect(chapterAt(chapters, 0.3)?.id).toBe("hills");
    expect(chapterAt(chapters, 0.749)?.id).toBe("hills");
    expect(chapterAt(chapters, 1)?.id).toBe("kigali");
    expect(chapterAt(chapters, 1.1)).toBeNull();
  });

  it("fades text in and out, but not at the very start or end of the story", () => {
    const [country, hills, kigali] = chapters as [Chapter, Chapter, Chapter];
    expect(chapterOpacity(country, 0)).toBe(1); // already visible on load
    expect(chapterOpacity(country, 0.3)).toBe(0);
    expect(chapterOpacity(hills, 0.3)).toBe(0);
    expect(chapterOpacity(hills, 0.5)).toBe(1);
    expect(chapterOpacity(hills, 0.75)).toBe(0);
    expect(chapterOpacity(kigali, 1)).toBe(1); // stays at the end
    expect(chapterOpacity(hills, 0.1)).toBe(0);
  });
});
