import { Container } from "./container";
import type { GridSpec } from "./grid";

interface MaskMeta {
  readonly grid: GridSpec;
  /** Stored value that means "on the border". */
  readonly zero: number;
  /** Stored steps per kilometre of distance. */
  readonly stepsPerKm: number;
}

/** Signed distance to the Rwanda border on a coarse grid: positive inside the country. */
export interface DistanceMask {
  readonly grid: GridSpec;
  /** One byte per cell, row 0 at the northern edge: zero + distance in km * stepsPerKm. */
  readonly values: Uint8Array;
  readonly zero: number;
  readonly stepsPerKm: number;
}

export async function decodeMask(data: ArrayBuffer): Promise<DistanceMask> {
  const container = Container.parse<MaskMeta>(data).expect("distance-mask", 1);
  const { grid, zero, stepsPerKm } = container.meta;
  return { grid, values: await container.u8("distance"), zero, stepsPerKm };
}

/** Distance to the border in km at a cell (positive inside). */
export function maskDistanceKm(mask: DistanceMask, row: number, col: number): number {
  return ((mask.values[row * mask.grid.width + col] as number) - mask.zero) / mask.stepsPerKm;
}
