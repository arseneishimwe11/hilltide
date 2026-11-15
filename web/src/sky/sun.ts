/**
 * Where the sun is in the sky, for any moment and place.
 *
 * Follows the NOAA solar position equations (after Meeus, "Astronomical
 * Algorithms"). Accurate to about 0.01 degrees for dates near the present,
 * which is far finer than the lighting needs.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

/** Kigali: latitude and longitude in degrees, and its time zone. */
export const KIGALI = { latitude: -1.9441, longitude: 30.0619, timeZone: "Africa/Kigali" } as const;

export interface SunPosition {
  /** Degrees above the horizon; negative when the sun is down. No refraction applied. */
  readonly elevation: number;
  /** Compass bearing in degrees: 0 north, 90 east, 180 south, 270 west. */
  readonly azimuth: number;
  /** The sun's declination in degrees. */
  readonly declination: number;
}

function julianCentury(date: Date): number {
  const julianDay = date.getTime() / DAY_MS + 2440587.5;
  return (julianDay - 2451545.0) / 36525.0;
}

/** Declination (degrees) and equation of time (minutes) for a moment. */
export function solarCoordinates(date: Date): { declination: number; equationOfTime: number } {
  const t = julianCentury(date);
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const trueLongitude = meanLongitude + centre;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination =
    Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) / RAD;

  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const l0 = meanLongitude * RAD;
  const m = meanAnomaly * RAD;
  const equationOfTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m));
  return { declination, equationOfTime };
}

/** Sun position for a moment (any Date; its UTC instant is used) and a place in degrees. */
export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const { declination, equationOfTime } = solarCoordinates(date);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  // True solar time in minutes: clock time corrected for longitude and the equation of time.
  const solarMinutes = (((utcMinutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const lat = latitude * RAD;
  const dec = declination * RAD;

  const sinElevation =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinElevation)));
  // Bearing measured clockwise from north.
  const azimuth = Math.atan2(
    -Math.cos(dec) * Math.sin(hourAngle),
    Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(hourAngle),
  );
  return {
    elevation: elevation / RAD,
    azimuth: (((azimuth / RAD) % 360) + 360) % 360,
    declination,
  };
}

/**
 * Unit vector pointing at the sun in Hilltide's local frame: x east, y north,
 * z up. Below the horizon z is negative.
 */
export function sunDirection(position: SunPosition): [number, number, number] {
  const elevation = position.elevation * RAD;
  const azimuth = position.azimuth * RAD;
  return [
    Math.cos(elevation) * Math.sin(azimuth),
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
  ];
}

/** Wall-clock time in a time zone, as "HH:MM" on a 24-hour clock. */
export function clockTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
