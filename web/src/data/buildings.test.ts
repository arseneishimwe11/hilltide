import { describe, expect, it } from "vitest";
import { totalsAt, type YearTotals } from "./buildings";

const rows: YearTotals[] = [
  { year: 2016, buildings: 1000, footprintKm2: 10 },
  { year: 2017, buildings: 1200, footprintKm2: 12 },
  { year: 2018, buildings: 1500, footprintKm2: 16 },
];

describe("yearly totals between data years", () => {
  it("returns the data rows at whole years", () => {
    expect(totalsAt(rows, 2016)).toEqual(rows[0]);
    expect(totalsAt(rows, 2017)).toEqual(rows[1]);
    expect(totalsAt(rows, 2018)).toEqual(rows[2]);
  });

  it("interpolates between years", () => {
    const mid = totalsAt(rows, 2017.5);
    expect(mid.buildings).toBe(1350);
    expect(mid.footprintKm2).toBeCloseTo(14);
    expect(totalsAt(rows, 2016.25).buildings).toBe(1050);
  });

  it("never extrapolates beyond the record", () => {
    expect(totalsAt(rows, 2010)).toEqual(rows[0]);
    expect(totalsAt(rows, 2030)).toEqual(rows[2]);
  });

  it("never shows fewer buildings as the slider moves forward", () => {
    let previous = 0;
    for (let year = 2016; year <= 2018; year += 0.05) {
      const { buildings } = totalsAt(rows, year);
      expect(buildings).toBeGreaterThanOrEqual(previous);
      previous = buildings;
    }
  });

  it("rejects an empty record", () => {
    expect(() => totalsAt([], 2016)).toThrow(/No yearly totals/);
  });
});
