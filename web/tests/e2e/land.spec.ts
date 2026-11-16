import { expect, test } from "@playwright/test";
import {
  goToProgress,
  openScene,
  sceneValue,
  screenshotStats,
  TIMES,
  watchErrors,
} from "./helpers";

/** Story positions photographed: from space, over Lake Kivu, across the hills, near and over Kigali. */
const STOPS = [0, 0.3, 0.62, 0.85, 1];
const FIRST_FRAME_BUDGET_BYTES = 5_000_000;

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`Act 1 on ${backend}: real pictures from space down to Kigali`, async ({
    page,
  }, testInfo) => {
    const errors = watchErrors(page);
    // "still" shows the fixed views without the flight between them, which
    // would take minutes in software rendering.
    await openScene(page, { backend, extra: "still" });

    expect(await sceneValue(page, "backend")).toBe(backend);
    const measured: string[] = [];
    for (const stop of STOPS) {
      await goToProgress(page, stop);
      const stats = await screenshotStats(
        page,
        `test-results/screens/land-${testInfo.project.name}-${backend}-${stop}.png`,
      );
      measured.push(`${stop}: ${stats.colours} colours, contrast ${stats.contrast.toFixed(1)}`);
      // The loading cover alone (a blank scene) measures about 30 colours; real frames
      // measure 150 or more.
      expect(stats.colours, `colours at ${stop}`).toBeGreaterThan(90);
      expect(stats.contrast, `contrast at ${stop}`).toBeGreaterThan(8);
    }
    console.log(`${testInfo.project.name} ${backend}: ${measured.join("; ")}`);
    expect(await sceneValue(page, "levels")).toEqual(["country", "region", "kigali"]);
    expect(errors).toEqual([]);
  });
}

test("the first frame arrives within the data budget", async ({ page }) => {
  await openScene(page, { backend: "webgl2", extra: "still" });
  const first = await sceneValue(page, "firstFrame");
  if (first === null) throw new Error("no first-frame measurement");
  console.log(
    `first frame: ${first.ms} ms, ${(first.bytes / 1e6).toFixed(2)} MB in ${first.requests} requests`,
  );
  expect(first.bytes).toBeGreaterThan(500_000); // the measurement is real, not zero
  expect(first.bytes).toBeLessThan(FIRST_FRAME_BUDGET_BYTES);
});

test("the story text follows the scroll", async ({ page }) => {
  await openScene(page, { backend: "webgl2", extra: "still" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await goToProgress(page, 0.62);
  await expect(page.getByRole("heading", { name: "A thousand hills" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
  await goToProgress(page, 1);
  await expect(page.getByRole("heading", { name: "Kigali" })).toBeVisible();
  // The elevation in the text is measured from the terrain, not typed in.
  await expect(page.getByText(/about 1,[45]\d0 metres/)).toBeVisible();
});

test("golden hour and night are both legible, and differ", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  const name = (label: string): string =>
    `test-results/screens/light-${testInfo.project.name}-${label}.png`;

  await openScene(page, { backend: "webgl2", time: TIMES.night, extra: "still" });
  await goToProgress(page, 1);
  await expect(page.getByText("Night view, with stylised moonlight")).toBeVisible();
  const night = await screenshotStats(page, name("night"));
  console.log(`night: ${night.colours} colours, contrast ${night.contrast.toFixed(1)}`);
  expect(night.colours).toBeGreaterThan(60);
  expect(night.contrast).toBeGreaterThan(4);

  // The control switches the light to golden hour of the same day.
  await page.getByRole("button", { name: "Golden hour" }).click();
  await page.waitForFunction(() => window.__hilltide?.settled === true);
  await expect(page.getByText(/Kigali at 17:\d\d/)).toBeVisible();
  const golden = await screenshotStats(page, name("golden"));
  console.log(`golden hour: ${golden.colours} colours, contrast ${golden.contrast.toFixed(1)}`);
  expect(golden.brightness).toBeGreaterThan(night.brightness * 1.5);
  await expect(page.getByRole("button", { name: "Back to now" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("with reduced motion the camera cuts between views instead of flying", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openScene(page, { backend: "webgl2" });
  const before = await sceneValue(page, "renderedFrames");
  await goToProgress(page, 0.62);
  const after = await sceneValue(page, "renderedFrames");
  // One cut, a few frames at most. A flight would render dozens.
  expect(after - before).toBeLessThan(8);
});

test("the performance overlay reports the device and measured frame times", async ({ page }) => {
  await openScene(page, { backend: "webgl2", extra: "still&perf=1" });
  const panel = page.getByRole("complementary", { name: "Performance" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("webgl2 (software)");
  await expect(panel).toContainText(/median\s+[\d.]+ ms/);
  await expect(panel).toContainText(/first frame \d+ ms/);
});

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`frame times on ${backend}, software rendering (recorded, not judged)`, async ({
    page,
  }, testInfo) => {
    // One viewport is enough for a record, and software WebGPU takes minutes.
    test.skip(testInfo.project.name !== "desktop", "recorded on the desktop viewport only");
    // Continuous rendering for a few seconds at the opening view and over Kigali.
    // These numbers come from a CPU rasteriser; they say nothing about a real GPU.
    await openScene(page, { backend, extra: "still&perf=1" });
    for (const stop of [0, 1]) {
      await goToProgress(page, stop);
      await page.waitForTimeout(6000);
      const frames = await page.evaluate(() => window.__hilltide?.frames());
      if (frames === undefined) throw new Error("no frame statistics");
      console.log(
        `frame times ${testInfo.project.name} ${backend} at ${stop}: median ${frames.medianMs.toFixed(0)} ms, ` +
          `p95 ${frames.p95Ms.toFixed(0)} ms, ${frames.fps.toFixed(1)} fps over ${frames.frames} frames`,
      );
      expect(frames.frames).toBeGreaterThan(2);
    }
  });
}

test("a browser without WebGPU or WebGL2 gets a clear message, not a blank page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Hide WebGPU and refuse 3D contexts, as an old or locked-down browser would.
    Reflect.deleteProperty(Navigator.prototype, "gpu");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
      if (kind === "webgl2" || kind === "webgpu") return null;
      return original.call(this, kind as "2d");
    } as typeof original;
  });
  await page.goto("./");
  await expect(page.getByText("This browser cannot draw Hilltide")).toBeVisible();
  await expect(page.getByText(/needs WebGPU or WebGL 2/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hilltide");
});
