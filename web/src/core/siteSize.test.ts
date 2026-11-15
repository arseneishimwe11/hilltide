import { describe, expect, it } from "vitest";
// @ts-expect-error plain Node script without type declarations
import { checkSizes, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "../../../scripts/check-site-size.mjs";

interface SizeReport {
  totalBytes: number;
  fileCount: number;
  problems: string[];
}
type Check = (
  files: Array<{ path: string; bytes: number }>,
  limits?: { maxFileBytes?: number; maxTotalBytes?: number },
) => SizeReport;

const check = checkSizes as Check;
const MB = 1024 * 1024;

describe("site size guard", () => {
  it("keeps the limits from the standing instructions", () => {
    expect(MAX_FILE_BYTES).toBe(50 * MB);
    expect(MAX_TOTAL_BYTES).toBeLessThanOrEqual(100 * MB);
  });

  it("passes a small site", () => {
    const report = check([
      { path: "index.html", bytes: 2000 },
      { path: "data/country.bin", bytes: 1 * MB },
    ]);
    expect(report.problems).toEqual([]);
    expect(report.totalBytes).toBe(2000 + MB);
    expect(report.fileCount).toBe(2);
  });

  it("rejects a single file over the limit", () => {
    const report = check([{ path: "data/huge.bin", bytes: 50 * MB + 1 }]);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain("data/huge.bin");
  });

  it("rejects a site over the total budget", () => {
    const files = Array.from({ length: 5 }, (_unused, index) => ({
      path: `data/part-${index}.bin`,
      bytes: 30 * MB,
    }));
    const report = check(files);
    expect(report.problems).toEqual(["site total is 150.0 MB (limit 100 MB)"]);
  });
});
