import { Container } from "./container";
import { cellOf, type GridSpec } from "./grid";

export interface HeightsMeta {
  readonly grid: GridSpec;
  /** height in metres = base + step * stored value */
  readonly base: number;
  readonly step: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly source: string;
}

/** A terrain level: heights in metres on a grid. */
export interface HeightField {
  readonly grid: GridSpec;
  /** Row-major, row 0 at the northern edge. */
  readonly heights: Float32Array;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly source: string;
}

export async function decodeHeights(data: ArrayBuffer): Promise<HeightField> {
  const container = Container.parse<HeightsMeta>(data).expect("heights", 1);
  const { grid, base, step, minHeight, maxHeight, source } = container.meta;
  const stored = await container.u16("heights", [grid.height, grid.width]);
  const heights = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i++) {
    heights[i] = base + step * (stored[i] as number);
  }
  return { grid, heights, minHeight, maxHeight, source };
}

/** Height at a local position, bilinear between cell centres, clamped at the edges. */
export function sampleHeight(field: HeightField, x: number, y: number): number {
  const { grid, heights } = field;
  const [row, col] = cellOf(grid, x, y);
  const r = Math.min(Math.max(row - 0.5, 0), grid.height - 1);
  const c = Math.min(Math.max(col - 0.5, 0), grid.width - 1);
  const r0 = Math.floor(r);
  const c0 = Math.floor(c);
  const r1 = Math.min(r0 + 1, grid.height - 1);
  const c1 = Math.min(c0 + 1, grid.width - 1);
  const fr = r - r0;
  const fc = c - c0;
  const at = (rr: number, cc: number): number => heights[rr * grid.width + cc] as number;
  const top = at(r0, c0) * (1 - fc) + at(r0, c1) * fc;
  const bottom = at(r1, c0) * (1 - fc) + at(r1, c1) * fc;
  return top * (1 - fr) + bottom * fr;
}
