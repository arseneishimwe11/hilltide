/**
 * The water simulation's specification: the numbers and the per-cell maths
 * that every implementation (CPU reference, WebGPU compute, WebGL2) follows.
 *
 * Method: the local-inertial form of the shallow water equations (Bates,
 * Horritt and Fewtrell 2010; de Almeida et al. 2012), as used for
 * large-scale inundation models. Each cell holds a water depth. Each cell
 * also owns two faces, its east one and its south one, and the flow across
 * each (m2/s per metre of face, positive toward east or south). One step:
 *
 *   1. Flux:   a new flow for every face from the water-surface slope
 *              across it, the flow it already had (inertia) and Manning
 *              friction.
 *   2. Limit:  for every cell, a factor from 0 to 1 that scales its
 *              outgoing flows so it cannot give away more water than it
 *              holds. This is what keeps depths from going negative.
 *   3. Update: depths change by the limited flows; rain is added;
 *              infiltration is taken; cells on the grid's outer ring are
 *              emptied (water that reaches the edge has left the area).
 *
 * Every face's flow is taken from one cell and given to its neighbour, so
 * water is neither created nor destroyed by the flow itself. What rain
 * adds, and what infiltration and the edge remove, is tallied per cell.
 *
 * Grid convention: row 0 is the northern edge, as in the terrain. "South"
 * is toward higher row numbers.
 */

export const GRAVITY = 9.81;

export interface SimSettings {
  /** Cell size in metres. */
  readonly cell: number;
  /** Time step in seconds. */
  readonly dt: number;
  /**
   * Weight of a face's own previous flow against the average of its two
   * neighbours along the flow direction (de Almeida's theta). Below 1 it
   * damps the grid-scale oscillations the plain scheme can show.
   */
  readonly theta: number;
  /** Faces with less water than this across them carry no flow, in metres. */
  readonly dryDepth: number;
  /**
   * Flow depth is capped at this for the wave-speed terms, in metres, so the
   * fixed time step stays stable however deep a pool becomes.
   */
  readonly depthCap: number;
}

/** Largest stable time step for a cell size and the depth cap (CFL condition with a safety factor). */
export function stableTimeStep(cell: number, depthCap: number, safety = 0.7): number {
  return (safety * cell) / Math.sqrt(GRAVITY * depthCap);
}

export function defaultSettings(cell: number): SimSettings {
  const depthCap = 10;
  return {
    cell,
    dt: Math.floor(stableTimeStep(cell, depthCap) * 10) / 10,
    theta: 0.9,
    dryDepth: 1e-4,
    depthCap,
  };
}

/** Millimetres per hour to metres per second. */
export function mmPerHour(value: number): number {
  return value / 3.6e6;
}

/**
 * New flow across one face.
 *
 * `bedA`, `depthA` are the cell the positive direction leaves; `bedB`,
 * `depthB` the cell it enters. `flow` is the face's current flow, `flowBehind`
 * and `flowAhead` those of the next faces along the same direction.
 */
export function faceFlow(
  settings: SimSettings,
  bedA: number,
  depthA: number,
  bedB: number,
  depthB: number,
  flow: number,
  flowBehind: number,
  flowAhead: number,
  roughness: number,
): number {
  const surfaceA = bedA + depthA;
  const surfaceB = bedB + depthB;
  // Depth of water that can actually pass over the higher of the two beds.
  const passing = Math.max(surfaceA, surfaceB) - Math.max(bedA, bedB);
  if (passing <= settings.dryDepth) return 0;
  const depth = Math.min(passing, settings.depthCap);
  const slope = (surfaceB - surfaceA) / settings.cell;
  const carried = settings.theta * flow + (1 - settings.theta) * 0.5 * (flowBehind + flowAhead);
  const friction =
    1 + (GRAVITY * settings.dt * roughness * roughness * Math.abs(carried)) / depth ** (7 / 3);
  const next = (carried - GRAVITY * depth * settings.dt * slope) / friction;
  // The method is only valid up to the speed of a shallow-water wave.
  const limit = depth * Math.sqrt(GRAVITY * depth);
  return Math.min(Math.max(next, -limit), limit);
}

/**
 * Factor from 0 to 1 for a cell's outgoing flows so that, over one time
 * step, they cannot remove more water than the cell holds.
 */
export function outflowScale(
  settings: SimSettings,
  depth: number,
  flowEast: number,
  flowWest: number,
  flowSouth: number,
  flowNorth: number,
): number {
  const leaving =
    Math.max(flowEast, 0) +
    Math.max(-flowWest, 0) +
    Math.max(flowSouth, 0) +
    Math.max(-flowNorth, 0);
  const available = (depth * settings.cell) / settings.dt;
  return leaving > available ? available / leaving : 1;
}

/** A face's flow after limiting: scaled by the factor of the cell it leaves. */
export function limitedFlow(flow: number, scaleFrom: number, scaleInto: number): number {
  return flow * (flow > 0 ? scaleFrom : scaleInto);
}
