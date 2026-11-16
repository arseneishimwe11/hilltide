import { Matrix4, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { levelOpacity } from "./labelLayer";
import { projectToScreen } from "./projection";

function cameraMatrix(position: [number, number, number], target: [number, number, number]) {
  const camera = new PerspectiveCamera(38, 16 / 9, 100, 2_000_000);
  camera.up.set(0, 0, 1);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .elements;
}

describe("label projection", () => {
  const matrix = cameraMatrix([0, -50_000, 300_000], [0, 0, 1500]);

  it("puts the point the camera looks at in the middle of the screen", () => {
    const point = projectToScreen(matrix, [0, 0, 1500], 1600, 900);
    expect(point.visible).toBe(true);
    expect(point.x).toBeCloseTo(800, 0);
    expect(point.y).toBeCloseTo(450, 0);
  });

  it("puts east to the right and north toward the top", () => {
    const centre = projectToScreen(matrix, [0, 0, 1500], 1600, 900);
    const east = projectToScreen(matrix, [40_000, 0, 1500], 1600, 900);
    const north = projectToScreen(matrix, [0, 40_000, 1500], 1600, 900);
    expect(east.x).toBeGreaterThan(centre.x + 50);
    expect(Math.abs(east.y - centre.y)).toBeLessThan(5);
    expect(north.y).toBeLessThan(centre.y - 50);
  });

  it("hides points outside the view and behind the camera", () => {
    expect(projectToScreen(matrix, [900_000, 0, 1500], 1600, 900).visible).toBe(false);
    const level = cameraMatrix([0, 0, 5000], [10_000, 0, 5000]); // looking east, level
    expect(projectToScreen(level, [-20_000, 0, 5000], 1600, 900).visible).toBe(false);
    expect(projectToScreen(level, [20_000, 0, 5000], 1600, 900).visible).toBe(true);
  });
});

describe("label levels", () => {
  it("shows country names from orbit and city names near the ground, never both", () => {
    expect(levelOpacity("country", 1)).toBe(1);
    expect(levelOpacity("kigali", 1)).toBe(0);
    expect(levelOpacity("country", 0)).toBe(0);
    expect(levelOpacity("kigali", 0)).toBe(1);
    for (let a = 0; a <= 1; a += 0.05) {
      expect(Math.min(levelOpacity("country", a), levelOpacity("kigali", a))).toBe(0);
    }
  });
});
