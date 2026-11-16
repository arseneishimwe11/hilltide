import type { HeightField } from "../data/heights";

/**
 * Packs a terrain level into one RGBA float texel per cell:
 *
 *   R  height in metres
 *   G  slope toward the east  (metres of rise per metre)
 *   B  slope toward the north (metres of rise per metre)
 *   A  land-cover class code (0 when unknown)
 *
 * With height and slope in the same texel, one bilinear read in the shader
 * gives a smooth surface and smooth lighting normals together.
 *
 * Texel (col, row) is cell (row, col) of the grid: row 0 is the northern edge.
 */
export function buildTerrainTexels(field: HeightField, classes: Uint8Array | null): Float32Array {
  const { width, height, cell } = field.grid;
  const heights = field.heights;
  if (heights.length !== width * height) throw new Error("Height field does not match its grid");
  if (classes !== null && classes.length !== heights.length) {
    throw new Error("Land cover does not match the terrain grid");
  }
  const texels = new Float32Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const north = Math.max(row - 1, 0);
    const south = Math.min(row + 1, height - 1);
    for (let col = 0; col < width; col++) {
      const west = Math.max(col - 1, 0);
      const east = Math.min(col + 1, width - 1);
      const index = row * width + col;
      const out = index * 4;
      texels[out] = heights[index] as number;
      texels[out + 1] =
        ((heights[row * width + east] as number) - (heights[row * width + west] as number)) /
        ((east - west) * cell);
      texels[out + 2] =
        ((heights[north * width + col] as number) - (heights[south * width + col] as number)) /
        ((south - north) * cell);
      texels[out + 3] = classes === null ? 0 : (classes[index] as number);
    }
  }
  return texels;
}
