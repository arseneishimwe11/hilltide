import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BuildingStats } from "../data/buildings";
import { growthPercent, rangeSentence, readoutFor } from "./yearControl";

/** The real statistics file the pipeline committed. */
const stats = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../public/data/buildings/stats.json", import.meta.url)),
    "utf8",
  ),
) as BuildingStats;
const rows = stats.city.byYear;
const first = rows[0] as (typeof rows)[number];
const last = rows[rows.length - 1] as (typeof rows)[number];
const digits = (text: string): number => Number(text.replace(/[^\d]/g, ""));

describe("year readout", () => {
  it("shows the data rows at whole years", () => {
    const start = readoutFor(stats, first.year);
    expect(start.year).toBe(String(first.year));
    expect(digits(start.standing)).toBe(first.buildings);
    expect(start.added).toBe("The record starts here");
    expect(start.area).toContain(first.footprintKm2.toFixed(1));

    const end = readoutFor(stats, last.year);
    expect(digits(end.standing)).toBe(last.buildings);
    expect(end.added).toBe(
      `${(last.buildings - first.buildings).toLocaleString("en")} more than in ${first.year}`,
    );
  });

  it("never shows fewer buildings as the year advances", () => {
    let previous = 0;
    for (let year = first.year; year <= last.year; year += 0.05) {
      const standing = digits(readoutFor(stats, year).standing);
      expect(standing).toBeGreaterThanOrEqual(previous);
      previous = standing;
    }
  });

  it("labels a moment with the nearest year", () => {
    expect(readoutFor(stats, 2018.4).year).toBe("2018");
    expect(readoutFor(stats, 2018.6).year).toBe("2019");
  });
});

describe("growth and its uncertainty", () => {
  it("computes growth in whole percent", () => {
    expect(growthPercent(100, 153)).toBe(53);
    expect(growthPercent(200, 200)).toBe(0);
  });

  it("states the central figure, the range across thresholds and the rasters' own count", () => {
    const sentence = rangeSentence(stats);
    const central = growthPercent(first.buildings, last.buildings);
    const growth = stats.sensitivity.byThreshold.map((row) => Math.round(row.growthPercent));
    const rasters = stats.rasters.byYear;
    const raster = growthPercent(
      (rasters[0] as (typeof rasters)[number]).countEstimateCity,
      (rasters[rasters.length - 1] as (typeof rasters)[number]).countEstimateCity,
    );
    expect(sentence).toContain(`Growth from ${first.year} to ${last.year}`);
    expect(sentence).toContain(`${central} percent by this method`);
    expect(sentence).toContain(`between ${Math.min(...growth)} and ${Math.max(...growth)} percent`);
    expect(sentence).toContain(`gives ${raster} percent`);
    // The range really is a range around the figure used.
    expect(Math.min(...growth)).toBeLessThanOrEqual(central);
    expect(Math.max(...growth)).toBeGreaterThanOrEqual(central);
  });
});
