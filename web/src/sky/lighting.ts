import { clamp, lerp, type Vec3 } from "../core/math";
import { type SunPosition, sunDirection } from "./sun";

/** Light and atmosphere colours for a sun position. All colours are linear RGB. */
export interface Lighting {
  /** Unit vector toward the main light (x east, y north, z up): the sun, or the moon at night. */
  readonly lightDirection: Vec3;
  /** Colour and strength of the main light. */
  readonly lightColour: Vec3;
  /** Light arriving from the whole sky. */
  readonly ambientColour: Vec3;
  /** Colour of distant haze. */
  readonly hazeColour: Vec3;
  readonly skyZenith: Vec3;
  readonly skyHorizon: Vec3;
  /** 0 in daylight, 1 in full night. */
  readonly night: number;
  /** True when the main light is the stylised moon rather than the sun. */
  readonly moonlit: boolean;
}

interface Stop {
  readonly elevation: number;
  readonly light: Vec3;
  readonly ambient: Vec3;
  readonly haze: Vec3;
  readonly zenith: Vec3;
  readonly horizon: Vec3;
}

/**
 * Looks by sun elevation in degrees: deep night, the end of civil twilight,
 * sunrise or sunset, golden hour, morning, high sun. Chosen by eye for the
 * palette of the place (dusk amber, mist, deep greens); values in between
 * are interpolated.
 */
const STOPS: readonly Stop[] = [
  {
    elevation: -18,
    light: [0.11, 0.14, 0.22],
    ambient: [0.03, 0.04, 0.07],
    haze: [0.02, 0.03, 0.05],
    zenith: [0.005, 0.008, 0.02],
    horizon: [0.02, 0.03, 0.06],
  },
  {
    elevation: -6,
    light: [0.12, 0.14, 0.24],
    ambient: [0.05, 0.06, 0.1],
    haze: [0.06, 0.07, 0.12],
    zenith: [0.02, 0.03, 0.08],
    horizon: [0.16, 0.12, 0.16],
  },
  {
    elevation: 0,
    light: [0.9, 0.42, 0.18],
    ambient: [0.16, 0.15, 0.2],
    haze: [0.5, 0.3, 0.24],
    zenith: [0.1, 0.16, 0.34],
    horizon: [0.85, 0.45, 0.25],
  },
  {
    elevation: 8,
    light: [1.25, 0.86, 0.5],
    ambient: [0.26, 0.27, 0.32],
    haze: [0.72, 0.6, 0.5],
    zenith: [0.14, 0.27, 0.52],
    horizon: [0.8, 0.66, 0.52],
  },
  {
    elevation: 25,
    light: [1.3, 1.16, 0.98],
    ambient: [0.3, 0.34, 0.4],
    haze: [0.68, 0.74, 0.78],
    zenith: [0.13, 0.3, 0.6],
    horizon: [0.62, 0.74, 0.84],
  },
  {
    elevation: 70,
    light: [1.35, 1.28, 1.16],
    ambient: [0.32, 0.36, 0.42],
    haze: [0.66, 0.74, 0.8],
    zenith: [0.1, 0.27, 0.6],
    horizon: [0.56, 0.72, 0.86],
  },
];

function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Lowest elevation, in degrees, the main light is drawn from, so slopes never go fully flat. */
const MIN_LIGHT_ELEVATION = 4;
/** Elevation of the stylised moon, in degrees. */
const MOON_ELEVATION = 38;

export function lightingFor(sun: SunPosition): Lighting {
  const first = STOPS[0] as Stop;
  const last = STOPS[STOPS.length - 1] as Stop;
  const elevation = clamp(sun.elevation, first.elevation, last.elevation);
  let upper = 1;
  while (upper < STOPS.length - 1 && elevation > (STOPS[upper] as Stop).elevation) upper++;
  const a = STOPS[upper - 1] as Stop;
  const b = STOPS[upper] as Stop;
  const t = (elevation - a.elevation) / (b.elevation - a.elevation);

  const moonlit = sun.elevation < -4;
  // At night the light comes from a stylised moon: opposite the sun's bearing, well above
  // the horizon. It is a rendering choice for legibility, not the real moon's position.
  const lightDirection = moonlit
    ? sunDirection({
        elevation: MOON_ELEVATION,
        azimuth: (sun.azimuth + 180) % 360,
        declination: sun.declination,
      })
    : sunDirection({ ...sun, elevation: Math.max(sun.elevation, MIN_LIGHT_ELEVATION) });

  return {
    lightDirection,
    lightColour: mix3(a.light, b.light, t),
    ambientColour: mix3(a.ambient, b.ambient, t),
    hazeColour: mix3(a.haze, b.haze, t),
    skyZenith: mix3(a.zenith, b.zenith, t),
    skyHorizon: mix3(a.horizon, b.horizon, t),
    night: clamp((2 - sun.elevation) / 10, 0, 1),
    moonlit,
  };
}
