import { Container } from "./container";
import type { GridSpec } from "./grid";

/** Land-cover class codes (ESA WorldCover codes divided by ten). */
export const LandClass = {
  None: 0,
  Trees: 1,
  Shrubland: 2,
  Grassland: 3,
  Cropland: 4,
  BuiltUp: 5,
  Bare: 6,
  Snow: 7,
  Water: 8,
  Wetland: 9,
  Other: 10,
} as const;

export interface LandCoverMeta {
  readonly grid: GridSpec;
  readonly classes: Readonly<Record<string, string>>;
  /** Share of the grid in each class, by class code. */
  readonly share: Readonly<Record<string, number>>;
  readonly source: string;
}

export interface LandCover {
  readonly grid: GridSpec;
  /** One class code per cell, row-major, row 0 at the northern edge. */
  readonly classes: Uint8Array;
  readonly meta: LandCoverMeta;
}

export async function decodeLandCover(data: ArrayBuffer): Promise<LandCover> {
  const container = Container.parse<LandCoverMeta>(data).expect("landcover", 1);
  const classes = await container.u8("classes");
  return { grid: container.meta.grid, classes, meta: container.meta };
}
