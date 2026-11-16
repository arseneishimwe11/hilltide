/**
 * Quality tiers and the automatic scaler.
 *
 * The scaler watches real frame times. It first trims the rendering
 * resolution, which is cheap and invisible at small steps, and only when
 * that is exhausted does it drop a whole tier (coarser meshes, fewer shadow
 * steps, a coarser Kigali grid). It climbs back cautiously.
 */

import { clamp } from "./math";

export type Tier = "low" | "medium" | "high";
export const TIER_ORDER: readonly Tier[] = ["low", "medium", "high"];

export interface QualitySettings {
  /** Upper limit on device pixel ratio. */
  readonly pixelRatioCap: number;
  /** Quads along one side of each terrain level's mesh. */
  readonly meshQuads: number;
  /** Steps of the terrain shadow march toward the sun; 0 turns shadows off. */
  readonly shadowSteps: number;
  /** Target frame time in milliseconds. */
  readonly targetMs: number;
}

export const TIERS: Readonly<Record<Tier, QualitySettings>> = {
  low: { pixelRatioCap: 1, meshQuads: 192, shadowSteps: 0, targetMs: 1000 / 30 },
  medium: { pixelRatioCap: 1.5, meshQuads: 320, shadowSteps: 12, targetMs: 1000 / 30 },
  high: { pixelRatioCap: 2, meshQuads: 512, shadowSteps: 24, targetMs: 1000 / 60 },
};

export interface DeviceHints {
  /** navigator.deviceMemory in GB, when the browser reports it. */
  readonly memoryGb?: number | undefined;
  /** navigator.hardwareConcurrency. */
  readonly cores?: number | undefined;
  readonly isMobile: boolean;
  /** True when the GPU is a software renderer (as in headless tests). */
  readonly softwareRenderer: boolean;
}

/** A first guess before any frame has been measured; the scaler corrects it. */
export function initialTier(hints: DeviceHints): Tier {
  if (hints.softwareRenderer) return "low";
  const weak = (hints.memoryGb ?? 8) <= 4 || (hints.cores ?? 8) <= 4;
  if (hints.isMobile) return weak ? "low" : "medium";
  return weak ? "medium" : "high";
}

export interface QualityState {
  readonly tier: Tier;
  /** Multiplier on rendering resolution within the tier, from MIN_SCALE to 1. */
  readonly resolutionScale: number;
}

export const MIN_SCALE = 0.6;
const SCALE_STEP = 0.1;

export interface ScalerOptions {
  /** Frames per decision. */
  readonly windowFrames?: number;
  /** Slower than target by this factor: reduce quality. */
  readonly slowFactor?: number;
  /** Faster than target by this factor for `calmWindows` windows in a row: raise quality. */
  readonly fastFactor?: number;
  readonly calmWindows?: number;
  /** Highest tier the scaler may reach (the user's or the device's ceiling). */
  readonly ceiling?: Tier;
}

export class QualityScaler {
  private state: QualityState;
  private readonly windowFrames: number;
  private readonly slowFactor: number;
  private readonly fastFactor: number;
  private readonly calmWindows: number;
  private readonly ceiling: Tier;
  private window: number[] = [];
  private calm = 0;

  constructor(tier: Tier, options: ScalerOptions = {}) {
    this.state = { tier, resolutionScale: 1 };
    this.windowFrames = options.windowFrames ?? 90;
    this.slowFactor = options.slowFactor ?? 1.25;
    this.fastFactor = options.fastFactor ?? 0.7;
    this.calmWindows = options.calmWindows ?? 4;
    this.ceiling = options.ceiling ?? "high";
  }

  get current(): QualityState {
    return this.state;
  }

  /**
   * Feeds one frame time. Returns the new state when quality changes,
   * otherwise null. Decisions use the 75th percentile of a window, so a
   * single slow frame (a load, a garbage collection) changes nothing.
   */
  sample(frameMs: number): QualityState | null {
    this.window.push(frameMs);
    if (this.window.length < this.windowFrames) return null;
    const sorted = this.window.sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.75)] as number;
    this.window = [];

    const target = TIERS[this.state.tier].targetMs;
    const before = this.state;
    if (typical > target * this.slowFactor) {
      this.calm = 0;
      this.state = this.lower();
    } else if (typical < target * this.fastFactor) {
      this.calm++;
      if (this.calm >= this.calmWindows) {
        this.calm = 0;
        this.state = this.raise();
      }
    } else {
      this.calm = 0;
    }
    return this.state === before ? null : this.state;
  }

  private lower(): QualityState {
    const { tier, resolutionScale } = this.state;
    if (resolutionScale > MIN_SCALE + 1e-6) {
      return { tier, resolutionScale: clamp(resolutionScale - SCALE_STEP, MIN_SCALE, 1) };
    }
    const index = TIER_ORDER.indexOf(tier);
    if (index === 0) return this.state;
    // A lower tier is much cheaper, so start it at full resolution again.
    return { tier: TIER_ORDER[index - 1] as Tier, resolutionScale: 1 };
  }

  private raise(): QualityState {
    const { tier, resolutionScale } = this.state;
    if (resolutionScale < 1 - 1e-6) {
      return { tier, resolutionScale: clamp(resolutionScale + SCALE_STEP, MIN_SCALE, 1) };
    }
    const index = TIER_ORDER.indexOf(tier);
    if (index >= TIER_ORDER.indexOf(this.ceiling)) return this.state;
    // Enter the higher tier at reduced resolution and earn the rest.
    return { tier: TIER_ORDER[index + 1] as Tier, resolutionScale: 0.8 };
  }
}
