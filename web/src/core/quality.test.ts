import { describe, expect, it } from "vitest";
import { FrameStats, HITCH_MS, percentile } from "../perf/frameStats";
import { initialTier, MIN_SCALE, QualityScaler, TIERS } from "./quality";

function feed(scaler: QualityScaler, frameMs: number, frames: number): void {
  for (let i = 0; i < frames; i++) scaler.sample(frameMs);
}

describe("initial tier", () => {
  it("starts software renderers and weak phones low, strong desktops high", () => {
    expect(initialTier({ isMobile: false, softwareRenderer: true })).toBe("low");
    expect(initialTier({ isMobile: true, softwareRenderer: false, memoryGb: 4 })).toBe("low");
    expect(initialTier({ isMobile: true, softwareRenderer: false, memoryGb: 8, cores: 8 })).toBe(
      "medium",
    );
    expect(initialTier({ isMobile: false, softwareRenderer: false, cores: 4 })).toBe("medium");
    expect(initialTier({ isMobile: false, softwareRenderer: false, memoryGb: 16, cores: 12 })).toBe(
      "high",
    );
  });
});

describe("quality scaler", () => {
  it("leaves quality alone while frames are on target", () => {
    const scaler = new QualityScaler("high");
    feed(scaler, TIERS.high.targetMs, 1000);
    expect(scaler.current).toEqual({ tier: "high", resolutionScale: 1 });
  });

  it("trims resolution first, then drops a tier", () => {
    const scaler = new QualityScaler("high", { windowFrames: 10 });
    feed(scaler, 40, 10);
    expect(scaler.current).toEqual({ tier: "high", resolutionScale: 0.9 });
    feed(scaler, 40, 30);
    expect(scaler.current.tier).toBe("high");
    expect(scaler.current.resolutionScale).toBeCloseTo(MIN_SCALE);
    feed(scaler, 40, 10);
    expect(scaler.current).toEqual({ tier: "medium", resolutionScale: 1 });
  });

  it("bottoms out at the lowest tier and smallest scale", () => {
    const scaler = new QualityScaler("low", { windowFrames: 5 });
    feed(scaler, 500, 500);
    expect(scaler.current.tier).toBe("low");
    expect(scaler.current.resolutionScale).toBeCloseTo(MIN_SCALE);
  });

  it("ignores a single slow frame", () => {
    const scaler = new QualityScaler("high", { windowFrames: 20 });
    for (let i = 0; i < 200; i++) scaler.sample(i % 20 === 0 ? 400 : TIERS.high.targetMs);
    expect(scaler.current).toEqual({ tier: "high", resolutionScale: 1 });
  });

  it("climbs back only after several calm windows, and not past the ceiling", () => {
    const scaler = new QualityScaler("low", {
      windowFrames: 10,
      calmWindows: 3,
      ceiling: "medium",
    });
    feed(scaler, 5, 20);
    expect(scaler.current.tier).toBe("low"); // two calm windows are not enough
    feed(scaler, 5, 10);
    expect(scaler.current).toEqual({ tier: "medium", resolutionScale: 0.8 });
    feed(scaler, 5, 600);
    expect(scaler.current).toEqual({ tier: "medium", resolutionScale: 1 });
  });

  it("reports a change only when one happens", () => {
    const scaler = new QualityScaler("medium", { windowFrames: 4 });
    const results = [50, 50, 50, 50].map((ms) => scaler.sample(ms));
    expect(results.slice(0, 3)).toEqual([null, null, null]);
    expect(results[3]).toEqual({ tier: "medium", resolutionScale: 0.9 });
  });
});

describe("frame statistics", () => {
  it("summarises a window", () => {
    const stats = new FrameStats(100);
    for (let i = 1; i <= 100; i++) stats.record(i);
    const summary = stats.summary();
    expect(summary.frames).toBe(100);
    expect(summary.meanMs).toBeCloseTo(50.5);
    expect(summary.medianMs).toBe(50);
    expect(summary.p95Ms).toBe(95);
    expect(summary.p99Ms).toBe(99);
    expect(summary.maxMs).toBe(100);
    expect(summary.fps).toBeCloseTo(1000 / 50.5);
    expect(summary.hitches).toBe(0);
  });

  it("keeps only the most recent frames but counts every hitch", () => {
    const stats = new FrameStats(10);
    stats.record(HITCH_MS + 50);
    for (let i = 0; i < 10; i++) stats.record(16);
    expect(stats.summary().frames).toBe(10);
    expect(stats.summary().hitches).toBe(0); // the slow frame left the window
    expect(stats.totalHitches).toBe(1);
    expect(stats.totalFrames).toBe(11);
  });

  it("ignores invalid values and handles an empty window", () => {
    const stats = new FrameStats();
    stats.record(Number.NaN);
    stats.record(-5);
    expect(stats.summary().frames).toBe(0);
    expect(stats.summary().fps).toBe(0);
    expect(percentile([], 0.5)).toBe(0);
  });
});
