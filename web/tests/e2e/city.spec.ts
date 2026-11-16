import { expect, test } from "@playwright/test";
import type { BuildingStats } from "../../src/data/buildings";
import type { Manifest } from "../../src/data/manifest";
import { changedShare, goToYear, openScene, sceneValue, watchErrors } from "./helpers";

/** The part of the frame that shows only the scene: right of the text, above the figures. */
const SCENE_ONLY = [0.55, 0.3, 1, 0.6] as const;

async function loadStats(page: import("@playwright/test").Page): Promise<BuildingStats> {
  const manifest = (await (await page.request.get("./data/manifest.json")).json()) as Manifest;
  const path = manifest.assets["buildings.stats"]?.path;
  if (path === undefined) throw new Error("no building statistics in the manifest");
  return (await (await page.request.get(`./data/${path}`)).json()) as BuildingStats;
}

const whole = (value: number): string => Math.round(value).toLocaleString("en");

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`Act 2 on ${backend}: the city grows from 2016 to 2023`, async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await openScene(page, { backend, extra: "still" });
    const shots: Record<number, Buffer> = {};
    for (const year of [2016, 2020, 2023]) {
      await goToYear(page, year);
      shots[year] = await page.screenshot({
        path: `test-results/screens/city-${testInfo.project.name}-${backend}-${year}.png`,
      });
    }
    const buildings = await sceneValue(page, "buildings");
    expect(buildings.loaded).toBe(buildings.total);
    expect(buildings.drawn).toBeGreaterThan(5_000);
    expect(buildings.drawn).toBeLessThanOrEqual(40_000);

    // The camera moves between these years too, so most of the scene changes. What must hold
    // is that every pair differs clearly: buildings and views are really being redrawn.
    const early = await changedShare(
      page,
      shots[2016] as Buffer,
      shots[2020] as Buffer,
      SCENE_ONLY,
    );
    const late = await changedShare(page, shots[2020] as Buffer, shots[2023] as Buffer, SCENE_ONLY);
    console.log(
      `${testInfo.project.name} ${backend}: scene changed ${(early * 100).toFixed(0)}% ` +
        `2016 to 2020, ${(late * 100).toFixed(0)}% 2020 to 2023; ${buildings.drawn} buildings drawn`,
    );
    expect(early).toBeGreaterThan(0.1);
    expect(late).toBeGreaterThan(0.1);
    expect(errors).toEqual([]);
  });
}

test("more of the city stands in later years, seen from one fixed view", async ({
  page,
}, testInfo) => {
  // The logic under test does not depend on the viewport; one is enough in software rendering.
  test.skip(testInfo.project.name !== "desktop", "run on the desktop viewport only");
  // With the camera held still (the end of Act 1 looks over Kigali), only the year changes.
  await openScene(page, { backend: "webgl2", extra: "still&holdCamera" });
  await goToYear(page, 2016);
  const first = await page.screenshot();
  await goToYear(page, 2023);
  const last = await page.screenshot();
  await goToYear(page, 2016);
  const again = await page.screenshot();
  const grown = await changedShare(page, first, last, SCENE_ONLY);
  const same = await changedShare(page, first, again, SCENE_ONLY);
  console.log(
    `fixed view: ${(grown * 100).toFixed(1)}% changed 2016 to 2023, ${(same * 100).toFixed(2)}% on return`,
  );
  expect(grown).toBeGreaterThan(0.01);
  // Going back to 2016 gives the 2016 picture again: the year alone drives the buildings.
  expect(same).toBeLessThan(grown / 4);
});

test("the figures on screen are the figures in the data", async ({ page }) => {
  await openScene(page, { backend: "webgl2", extra: "still" });
  const stats = await loadStats(page);
  const rows = stats.city.byYear;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) throw new Error("no yearly totals");

  await goToYear(page, first.year);
  await expect(page.getByText(`${whole(first.buildings)} buildings standing`)).toBeVisible();
  await expect(page.getByText("The record starts here")).toBeVisible();

  await goToYear(page, last.year);
  await expect(page.getByText(`${whole(last.buildings)} buildings standing`)).toBeVisible();
  await expect(
    page.getByText(`${whole(last.buildings - first.buildings)} more than in ${first.year}`),
  ).toBeVisible();
  await expect(
    page.getByText(`${last.footprintKm2.toFixed(1)} square kilometres of building footprints`),
  ).toBeVisible();

  // The uncertainty is stated, with numbers that come from the sensitivity table.
  const growth = stats.sensitivity.byThreshold.map((row) => Math.round(row.growthPercent));
  const range = page.getByText(/Growth from \d{4} to \d{4}/);
  await expect(range).toContainText(
    `between ${Math.min(...growth)} and ${Math.max(...growth)} percent`,
  );
  await expect(range).toContainText(
    `${Math.round((last.buildings / first.buildings - 1) * 100)} percent by this method`,
  );
  // And every mapped building is accounted for in the status line.
  await expect(
    page.getByText(`of ${whole(stats.footprints.dated)} mapped buildings drawn`),
  ).toBeVisible();
});

test("between two data years the count is interpolated", async ({ page }, testInfo) => {
  // The logic under test does not depend on the viewport; one is enough in software rendering.
  test.skip(testInfo.project.name !== "desktop", "run on the desktop viewport only");
  await openScene(page, { backend: "webgl2", extra: "quality=low", buildings: 15_000 });
  const stats = await loadStats(page);
  const a = stats.city.byYear.find((row) => row.year === 2019);
  const b = stats.city.byYear.find((row) => row.year === 2020);
  if (a === undefined || b === undefined) throw new Error("missing years");
  await goToYear(page, 2019.5);
  expect(await sceneValue(page, "year")).toBeCloseTo(2019.5, 1);
  const shown = await page.locator(".year__standing").textContent();
  const count = Number((shown ?? "").replace(/[^\d]/g, ""));
  expect(count).toBeGreaterThan(a.buildings);
  expect(count).toBeLessThan(b.buildings);
  expect(Math.abs(count - (a.buildings + b.buildings) / 2)).toBeLessThan(
    (b.buildings - a.buildings) * 0.1,
  );
});

test("the year slider works from the keyboard, and Play runs the years", async ({
  page,
}, testInfo) => {
  // The logic under test does not depend on the viewport; one is enough in software rendering.
  test.skip(testInfo.project.name !== "desktop", "run on the desktop viewport only");
  await openScene(page, { backend: "webgl2", extra: "still" });
  await goToYear(page, 2019);
  const slider = page.getByRole("slider", { name: "Year" });
  await slider.focus();
  await page.keyboard.press("End");
  await expect.poll(() => sceneValue(page, "year"), { timeout: 60_000 }).toBe(2023);
  await expect(slider).toHaveAttribute("aria-valuetext", /^2023: /);
  await page.keyboard.press("Home");
  await expect.poll(() => sceneValue(page, "year"), { timeout: 60_000 }).toBe(2016);

  const play = page.getByRole("button", { name: "Play" });
  await play.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect
    .poll(() => sceneValue(page, "year"), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(2018);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  const paused = await sceneValue(page, "year");
  await page.waitForTimeout(2500);
  expect(await sceneValue(page, "year")).toBe(paused);
});
