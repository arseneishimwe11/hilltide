/** Frame-time statistics over a sliding window of recent frames. */

export interface FrameSummary {
  /** Frames in the window. */
  readonly frames: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Frames per second implied by the mean frame time. */
  readonly fps: number;
  /** Frames in the window that took longer than the hitch limit. */
  readonly hitches: number;
}

/** A frame longer than this is counted as a hitch (the project's budget). */
export const HITCH_MS = 100;

export function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index] as number;
}

export class FrameStats {
  private readonly times: Float32Array;
  private count = 0;
  private next = 0;
  /** Hitches since the recorder was created or reset, not only those still in the window. */
  totalHitches = 0;
  totalFrames = 0;

  constructor(windowSize = 600) {
    this.times = new Float32Array(windowSize);
  }

  /** Records one frame's duration in milliseconds. */
  record(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    this.times[this.next] = frameMs;
    this.next = (this.next + 1) % this.times.length;
    this.count = Math.min(this.count + 1, this.times.length);
    this.totalFrames++;
    if (frameMs > HITCH_MS) this.totalHitches++;
  }

  reset(): void {
    this.count = 0;
    this.next = 0;
    this.totalHitches = 0;
    this.totalFrames = 0;
  }

  summary(): FrameSummary {
    const window = Array.from(this.times.subarray(0, this.count)).sort((a, b) => a - b);
    if (window.length === 0) {
      return {
        frames: 0,
        meanMs: 0,
        medianMs: 0,
        p95Ms: 0,
        p99Ms: 0,
        maxMs: 0,
        fps: 0,
        hitches: 0,
      };
    }
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    return {
      frames: window.length,
      meanMs: mean,
      medianMs: percentile(window, 0.5),
      p95Ms: percentile(window, 0.95),
      p99Ms: percentile(window, 0.99),
      maxMs: window[window.length - 1] as number,
      fps: mean > 0 ? 1000 / mean : 0,
      hitches: window.filter((value) => value > HITCH_MS).length,
    };
  }
}
