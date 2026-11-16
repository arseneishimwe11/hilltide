import { faceFlow, limitedFlow, outflowScale, type SimSettings } from "./spec";

/** What does not change during a run: the land the water moves over. */
export interface SimLand {
  readonly width: number;
  readonly height: number;
  /** Bed height in metres, row-major, row 0 at the northern edge. */
  readonly bed: Float32Array;
  /** Manning roughness per cell. */
  readonly roughness: Float32Array;
  /** Most water the ground can take in, in metres per second, per cell. */
  readonly infiltration: Float32Array;
}

export interface WaterTotals {
  /** Water on the ground, in cubic metres. */
  readonly stored: number;
  /** Water that soaked into the ground, in cubic metres. */
  readonly infiltrated: number;
  /** Water that left over the edge of the grid, in cubic metres. */
  readonly outflow: number;
}

/**
 * The reference implementation: plain loops on the CPU, one array per
 * quantity, in the same three stages the GPU versions run. It is the
 * definition the GPU versions are tested against, and what the validation
 * scripts run.
 */
export class ReferenceSim {
  readonly depth: Float32Array;
  /** Flow across each cell's east face. */
  readonly flowEast: Float32Array;
  /** Flow across each cell's south face. */
  readonly flowSouth: Float32Array;
  /** Depth of water each cell has removed so far: infiltration, or everything on the edge ring. */
  readonly lost: Float32Array;
  private readonly newEast: Float32Array;
  private readonly newSouth: Float32Array;
  private readonly scale: Float32Array;
  private readonly nextDepth: Float32Array;
  /** Simulated seconds so far. */
  time = 0;

  constructor(
    readonly land: SimLand,
    readonly settings: SimSettings,
  ) {
    const cells = land.width * land.height;
    if (land.bed.length !== cells) throw new Error("Bed does not match the grid");
    this.depth = new Float32Array(cells);
    this.flowEast = new Float32Array(cells);
    this.flowSouth = new Float32Array(cells);
    this.lost = new Float32Array(cells);
    this.newEast = new Float32Array(cells);
    this.newSouth = new Float32Array(cells);
    this.scale = new Float32Array(cells);
    this.nextDepth = new Float32Array(cells);
  }

  isEdge(row: number, col: number): boolean {
    return row === 0 || col === 0 || row === this.land.height - 1 || col === this.land.width - 1;
  }

  /** Advances one time step with rain falling at `rain` metres per second. */
  step(rain: number): void {
    const { width, height, bed, roughness, infiltration } = this.land;
    const s = this.settings;
    const { depth, flowEast, flowSouth, newEast, newSouth, scale, nextDepth, lost } = this;
    const at = (row: number, col: number): number => row * width + col;

    // Stage 1: a new flow for every face.
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = at(row, col);
        if (col + 1 < width) {
          const j = at(row, col + 1);
          newEast[i] = faceFlow(
            s,
            bed[i] as number,
            depth[i] as number,
            bed[j] as number,
            depth[j] as number,
            flowEast[i] as number,
            col > 0 ? (flowEast[i - 1] as number) : 0,
            col + 2 < width ? (flowEast[j] as number) : 0,
            0.5 * ((roughness[i] as number) + (roughness[j] as number)),
          );
        } else {
          newEast[i] = 0;
        }
        if (row + 1 < height) {
          const j = at(row + 1, col);
          newSouth[i] = faceFlow(
            s,
            bed[i] as number,
            depth[i] as number,
            bed[j] as number,
            depth[j] as number,
            flowSouth[i] as number,
            row > 0 ? (flowSouth[i - width] as number) : 0,
            row + 2 < height ? (flowSouth[j] as number) : 0,
            0.5 * ((roughness[i] as number) + (roughness[j] as number)),
          );
        } else {
          newSouth[i] = 0;
        }
      }
    }

    // Stage 2: how much of its outgoing flow each cell can afford.
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = at(row, col);
        scale[i] = outflowScale(
          s,
          depth[i] as number,
          newEast[i] as number,
          col > 0 ? (newEast[i - 1] as number) : 0,
          newSouth[i] as number,
          row > 0 ? (newSouth[i - width] as number) : 0,
        );
      }
    }

    // Stage 3: move the water, add rain, take infiltration, empty the edge ring.
    const exchange = s.dt / s.cell;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = at(row, col);
        const here = scale[i] as number;
        const east =
          col + 1 < width ? limitedFlow(newEast[i] as number, here, scale[i + 1] as number) : 0;
        const west =
          col > 0 ? limitedFlow(newEast[i - 1] as number, scale[i - 1] as number, here) : 0;
        const south =
          row + 1 < height
            ? limitedFlow(newSouth[i] as number, here, scale[i + width] as number)
            : 0;
        const north =
          row > 0
            ? limitedFlow(newSouth[i - width] as number, scale[i - width] as number, here)
            : 0;
        let water = (depth[i] as number) + exchange * (west - east + north - south);
        water = Math.max(water, 0) + rain * s.dt;
        let removed = Math.min(water, (infiltration[i] as number) * s.dt);
        water -= removed;
        if (this.isEdge(row, col)) {
          removed += water;
          water = 0;
        }
        nextDepth[i] = water;
        lost[i] = (lost[i] as number) + removed;
        flowEast[i] = east;
        flowSouth[i] = south;
      }
    }
    depth.set(nextDepth);
    this.time += s.dt;
  }

  /** Volumes in cubic metres. Together with the rain that fell, they account for all the water. */
  totals(): WaterTotals {
    const { width, height } = this.land;
    const area = this.settings.cell ** 2;
    let stored = 0;
    let infiltrated = 0;
    let outflow = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = row * width + col;
        stored += this.depth[i] as number;
        if (this.isEdge(row, col)) outflow += this.lost[i] as number;
        else infiltrated += this.lost[i] as number;
      }
    }
    return { stored: stored * area, infiltrated: infiltrated * area, outflow: outflow * area };
  }
}

/** Flat, uniform land properties for a bed: handy for tests and simple cases. */
export function uniformLand(
  width: number,
  height: number,
  bed: Float32Array,
  roughness = 0.05,
  infiltration = 0,
): SimLand {
  return {
    width,
    height,
    bed,
    roughness: new Float32Array(width * height).fill(roughness),
    infiltration: new Float32Array(width * height).fill(infiltration),
  };
}
