import { clamp, damp, type Vec3 } from "../core/math";

/** Where the camera is and what it looks at, in local metres (x east, y north, z up). */
export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

/** A pose at a point of the story, `t` from 0 to 1. Keys are listed in order of `t`. */
export interface CameraKey extends CameraPose {
  readonly t: number;
}

/**
 * Cubic Hermite interpolation through unevenly spaced keys with
 * Catmull-Rom tangents: smooth, and it passes exactly through each key.
 */
function hermite(times: readonly number[], values: readonly number[], t: number): number {
  const last = times.length - 1;
  if (t <= (times[0] as number)) return values[0] as number;
  if (t >= (times[last] as number)) return values[last] as number;
  let i = 0;
  while (i < last - 1 && t > (times[i + 1] as number)) i++;
  const t0 = times[i] as number;
  const t1 = times[i + 1] as number;
  const v0 = values[i] as number;
  const v1 = values[i + 1] as number;
  const span = t1 - t0;
  const tangent = (index: number): number => {
    const before = Math.max(index - 1, 0);
    const after = Math.min(index + 1, last);
    const dt = (times[after] as number) - (times[before] as number);
    return dt === 0 ? 0 : ((values[after] as number) - (values[before] as number)) / dt;
  };
  const u = (t - t0) / span;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * v0 +
    (u3 - 2 * u2 + u) * span * tangent(i) +
    (-2 * u3 + 3 * u2) * v1 +
    (u3 - u2) * span * tangent(i + 1)
  );
}

/**
 * The camera pose at story progress `t`. Heights are interpolated in
 * logarithmic space, so a descent from 300 km to 3 km feels even instead of
 * spending almost all of its time at altitude.
 */
export function samplePath(keys: readonly CameraKey[], t: number): CameraPose {
  if (keys.length === 0) throw new Error("Camera path has no keys");
  const times = keys.map((key) => key.t);
  const progress = clamp(t, times[0] as number, times[times.length - 1] as number);
  const component = (pick: (key: CameraKey) => number, logarithmic = false): number => {
    const values = keys.map((key) => (logarithmic ? Math.log(pick(key)) : pick(key)));
    const value = hermite(times, values, progress);
    return logarithmic ? Math.exp(value) : value;
  };
  return {
    position: [
      component((key) => key.position[0]),
      component((key) => key.position[1]),
      component((key) => key.position[2], true),
    ],
    target: [
      component((key) => key.target[0]),
      component((key) => key.target[1]),
      component((key) => key.target[2]),
    ],
  };
}

/** Eases a pose toward a goal pose; frame-rate independent. `halfLife` in seconds. */
export function dampPose(
  current: CameraPose,
  goal: CameraPose,
  dt: number,
  halfLife: number,
): CameraPose {
  const each = (a: Vec3, b: Vec3): Vec3 => [
    damp(a[0], b[0], dt, halfLife),
    damp(a[1], b[1], dt, halfLife),
    damp(a[2], b[2], dt, halfLife),
  ];
  return {
    position: each(current.position, goal.position),
    target: each(current.target, goal.target),
  };
}

/** Largest distance between matching points of two poses, in metres. */
export function poseDistance(a: CameraPose, b: CameraPose): number {
  const gap = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  return Math.max(gap(a.position, b.position), gap(a.target, b.target));
}

/**
 * Raises the camera where needed so it stays at least `clearance` metres
 * above the ground beneath it. `groundAt` returns terrain height in metres.
 */
export function keepAboveGround(
  pose: CameraPose,
  groundAt: (x: number, y: number) => number,
  clearance: number,
): CameraPose {
  const floor = groundAt(pose.position[0], pose.position[1]) + clearance;
  if (pose.position[2] >= floor) return pose;
  return { position: [pose.position[0], pose.position[1], floor], target: pose.target };
}

/**
 * The key time closest to a progress value. With reduced motion the camera
 * shows these fixed views one after another instead of flying between them.
 */
export function nearestKeyTime(keys: readonly CameraKey[], t: number): number {
  let best = keys[0]?.t ?? 0;
  for (const key of keys) {
    if (Math.abs(key.t - t) < Math.abs(best - t)) best = key.t;
  }
  return best;
}
