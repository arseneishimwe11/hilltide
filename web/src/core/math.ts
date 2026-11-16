/** Small numeric helpers shared across modules. */

export type Vec3 = readonly [number, number, number];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0 below `edge0`, 1 above `edge1`, smooth in between. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Moves `current` toward `goal` so that half the remaining distance is
 * covered every `halfLife` seconds, whatever the frame rate.
 */
export function damp(current: number, goal: number, dt: number, halfLife: number): number {
  if (halfLife <= 0) return goal;
  return goal + (current - goal) * 0.5 ** (dt / halfLife);
}
