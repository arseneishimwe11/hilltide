import type { GridSpec } from "../data/grid";
import { decodeHeights } from "../data/heights";
import { decodeLandCover, LandClass } from "../data/landcover";
import { decodeLines } from "../data/lines";
import { burnLines } from "./burnLines";
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

/** Mapped waterways to draw as water on a level: a lines asset and the kinds to use from it. */
export interface WaterLines {
  readonly data: ArrayBuffer;
  readonly kinds: readonly number[];
}

/**
 * Decodes a heights asset and its land cover, marks mapped rivers as water,
 * and packs everything into texels.
 */
export async function prepareTerrain(
  heightsData: ArrayBuffer,
  coverData: ArrayBuffer | null,
  water: readonly WaterLines[] = [],
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
  if (cover !== null) {
    for (const entry of water) {
      const lines = await decodeLines(entry.data);
      burnLines(cover.classes, field.grid, lines, new Set(entry.kinds), LandClass.Water);
    }
  }
  return {
    grid: field.grid,
    heights: field.heights,
    texels: buildTerrainTexels(field, cover?.classes ?? null),
    minHeight: field.minHeight,
    maxHeight: field.maxHeight,
  };
}
