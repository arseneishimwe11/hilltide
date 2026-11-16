import type { GridSpec } from "../data/grid";
import { decodeHeights } from "../data/heights";
import { decodeLandCover } from "../data/landcover";
import { buildTerrainTexels } from "./terrainTexels";

/** A terrain level decoded and packed, ready to upload to the GPU. */
export interface PreparedTerrain {
  readonly grid: GridSpec;
  /** Heights in metres, kept for camera clearance and label placement. */
  readonly heights: Float32Array;
  /** RGBA float texels: height, east slope, north slope, land-cover class. */
  readonly texels: Float32Array;
  readonly minHeight: number;
  readonly maxHeight: number;
}

/** Decodes a heights asset and its land cover and packs them into texels. */
export async function prepareTerrain(
  heightsData: ArrayBuffer,
  coverData: ArrayBuffer | null,
): Promise<PreparedTerrain> {
  const [field, cover] = await Promise.all([
    decodeHeights(heightsData),
    coverData === null ? null : decodeLandCover(coverData),
  ]);
  if (
    cover !== null &&
    (cover.grid.width !== field.grid.width || cover.grid.cell !== field.grid.cell)
  ) {
    throw new Error(`Land cover grid does not match terrain grid "${field.grid.name}"`);
  }
  return {
    grid: field.grid,
    heights: field.heights,
    texels: buildTerrainTexels(field, cover?.classes ?? null),
    minHeight: field.minHeight,
    maxHeight: field.maxHeight,
  };
}
