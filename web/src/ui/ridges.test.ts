import { describe, expect, it } from "vitest";
import { ridgeLayers, ridgeProfile, seededRandom } from "./ridges";

describe("ridges", () => {
  it("is deterministic for a seed", () => {
    expect(ridgeLayers(7, 4)).toEqual(ridgeLayers(7, 4));
    expect(ridgeLayers(7, 4)).not.toEqual(ridgeLayers(8, 4));
  });

  it("keeps profile heights within 0 and 1", () => {
    const profile = ridgeProfile(seededRandom(3), 200);
    expect(profile).toHaveLength(200);
    expect(Math.min(...profile)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...profile)).toBeLessThanOrEqual(1);
  });

  it("orders layers from far to near with closed paths", () => {
    const layers = ridgeLayers(1, 5);
    expect(layers.map((layer) => layer.depth)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    for (const layer of layers) {
      expect(layer.path.startsWith("M0.0 ")).toBe(true);
      expect(layer.path.endsWith("Z")).toBe(true);
      expect(layer.path).not.toContain("NaN");
    }
  });
});
