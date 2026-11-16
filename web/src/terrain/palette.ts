import { LandClass } from "../data/landcover";

/**
 * Ground colours by land-cover class, drawn from the place: deep hill
 * greens, the yellow-green of cultivated slopes, laterite red on bare and
 * built ground, dark lake water. sRGB hex values.
 */
export const LAND_COLOURS: Readonly<Record<number, number>> = {
  [LandClass.None]: 0x5a6b52,
  [LandClass.Trees]: 0x1f4a36,
  [LandClass.Shrubland]: 0x3f6844,
  [LandClass.Grassland]: 0x6d8650,
  [LandClass.Cropland]: 0x86904f,
  [LandClass.BuiltUp]: 0xa3664a,
  [LandClass.Bare]: 0xb4623c,
  [LandClass.Snow]: 0xe8ece6,
  [LandClass.Water]: 0x14394b,
  [LandClass.Wetland]: 0x3d6a58,
  [LandClass.Other]: 0x55705a,
};

/** Number of entries in the palette texture (class codes 0 to 15). */
export const PALETTE_SIZE = 16;

/** sRGB hex to linear RGB components in 0..1. */
export function hexToLinear(hex: number): [number, number, number] {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((hex >> 16) & 0xff), channel((hex >> 8) & 0xff), channel(hex & 0xff)];
}

/** The palette as RGBA float texels in linear colour, one per class code. */
export function paletteTexels(): Float32Array {
  const texels = new Float32Array(PALETTE_SIZE * 4);
  for (let code = 0; code < PALETTE_SIZE; code++) {
    const [r, g, b] = hexToLinear(LAND_COLOURS[code] ?? (LAND_COLOURS[LandClass.None] as number));
    texels.set([r, g, b, 1], code * 4);
  }
  return texels;
}
