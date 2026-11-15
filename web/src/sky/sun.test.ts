import { describe, expect, it } from "vitest";
import { clockTime, KIGALI, solarCoordinates, sunDirection, sunPosition } from "./sun";

const utc = (iso: string): Date => new Date(`${iso}Z`);

describe("solar coordinates", () => {
  it("gives the solstice and equinox declinations", () => {
    expect(solarCoordinates(utc("2026-06-21T08:00:00")).declination).toBeCloseTo(23.44, 1);
    expect(solarCoordinates(utc("2026-12-21T20:00:00")).declination).toBeCloseTo(-23.44, 1);
    expect(Math.abs(solarCoordinates(utc("2026-03-20T14:46:00")).declination)).toBeLessThan(0.05);
  });

  it("gives the known extremes of the equation of time", () => {
    // About -14.2 minutes in mid February and +16.4 minutes in early November.
    expect(solarCoordinates(utc("2026-02-11T12:00:00")).equationOfTime).toBeCloseTo(-14.2, 0);
    expect(solarCoordinates(utc("2026-11-03T12:00:00")).equationOfTime).toBeCloseTo(16.4, 0);
  });
});

describe("sun position", () => {
  it("is overhead at the subsolar point", () => {
    const moment = utc("2026-03-20T12:00:00");
    const { declination, equationOfTime } = solarCoordinates(moment);
    // At 12:00 UTC the sun is overhead where solar noon falls: shifted by the equation of time.
    const longitude = -equationOfTime / 4;
    expect(sunPosition(moment, declination, longitude).elevation).toBeGreaterThan(89.9);
  });

  it("matches geometry at Kigali on the June solstice at solar noon", () => {
    // Solar noon in Kigali: 12:00 UTC minus the longitude offset and the equation of time.
    const base = utc("2026-06-21T12:00:00");
    const { equationOfTime, declination } = solarCoordinates(base);
    const noon = new Date(base.getTime() - (4 * KIGALI.longitude + equationOfTime) * 60_000);
    const position = sunPosition(noon, KIGALI.latitude, KIGALI.longitude);
    // Noon elevation is 90 minus the angle between latitude and declination.
    expect(position.elevation).toBeCloseTo(90 - Math.abs(KIGALI.latitude - declination), 1);
    // In June the sun passes north of Kigali.
    expect(Math.min(position.azimuth, 360 - position.azimuth)).toBeLessThan(1);
  });

  it("passes south of Kigali in December", () => {
    const base = utc("2026-12-21T12:00:00");
    const { equationOfTime } = solarCoordinates(base);
    const noon = new Date(base.getTime() - (4 * KIGALI.longitude + equationOfTime) * 60_000);
    expect(sunPosition(noon, KIGALI.latitude, KIGALI.longitude).azimuth).toBeCloseTo(180, 0);
  });

  it("rises in the east near 6:00 and sets in the west near 18:00 in Kigali", () => {
    // Kigali is UTC+2 all year. Close to the equator, days are about 12 hours long.
    const morning = sunPosition(utc("2026-11-15T04:30:00"), KIGALI.latitude, KIGALI.longitude);
    const evening = sunPosition(utc("2026-11-15T15:30:00"), KIGALI.latitude, KIGALI.longitude);
    const night = sunPosition(utc("2026-11-15T22:00:00"), KIGALI.latitude, KIGALI.longitude);
    expect(morning.elevation).toBeGreaterThan(5);
    expect(morning.elevation).toBeLessThan(20);
    expect(morning.azimuth).toBeGreaterThan(90);
    expect(morning.azimuth).toBeLessThan(125);
    expect(evening.elevation).toBeGreaterThan(0);
    expect(evening.elevation).toBeLessThan(15);
    expect(evening.azimuth).toBeGreaterThan(235);
    expect(evening.azimuth).toBeLessThan(270);
    expect(night.elevation).toBeLessThan(-30);
  });

  it("matches a published reference: Greenwich at noon on the 2026 March equinox", () => {
    // At latitude 51.4779 on the equinox the noon elevation is 90 - 51.48 = 38.5 degrees.
    const position = sunPosition(utc("2026-03-20T12:07:00"), 51.4779, 0);
    expect(position.elevation).toBeCloseTo(38.5, 0);
    expect(position.azimuth).toBeCloseTo(180, 0);
  });
});

describe("sun direction", () => {
  it("is a unit vector with x east, y north, z up", () => {
    expect(sunDirection({ elevation: 90, azimuth: 0, declination: 0 })[2]).toBeCloseTo(1);
    const east = sunDirection({ elevation: 0, azimuth: 90, declination: 0 });
    expect(east[0]).toBeCloseTo(1);
    expect(east[1]).toBeCloseTo(0);
    const north = sunDirection({ elevation: 0, azimuth: 0, declination: 0 });
    expect(north[1]).toBeCloseTo(1);
    const low = sunDirection({ elevation: -10, azimuth: 200, declination: 0 });
    expect(Math.hypot(...low)).toBeCloseTo(1);
    expect(low[2]).toBeLessThan(0);
  });
});

describe("clock time", () => {
  it("shows Kigali time two hours ahead of UTC", () => {
    expect(clockTime(utc("2026-11-15T21:14:00"), KIGALI.timeZone)).toBe("23:14");
    expect(clockTime(utc("2026-11-15T22:05:00"), KIGALI.timeZone)).toBe("00:05");
  });
});
