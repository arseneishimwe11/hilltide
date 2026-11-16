import { expect, type Page } from "@playwright/test";
import type { HilltideState } from "../../src/app";

/** A fixed moment for the sun, so screenshots do not depend on when the tests run. */
export const TIMES = {
  morning: "2026-06-21T08:00:00Z", // 10:00 in Kigali
  goldenHour: "2026-06-21T15:25:00Z", // 17:25 in Kigali
  night: "2026-06-21T21:00:00Z", // 23:00 in Kigali
} as const;

export interface OpenOptions {
  readonly backend?: "webgl2" | "webgpu";
  readonly time?: string;
  /** Extra query parameters, for example "still" or "perf=1". */
  readonly extra?: string;
  /** Most buildings drawn per frame. */
  readonly buildings?: number;
}

/** Collects page errors and console errors; assert on the returned list at the end of a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** Opens the page and waits for the first live frame. */
export async function openScene(page: Page, options: OpenOptions = {}): Promise<void> {
  const query = [
    options.backend === "webgl2" ? "backend=webgl2" : "",
    `time=${options.time ?? TIMES.morning}`,
    "quality=medium",
    // A software rasteriser cannot draw hundreds of thousands of boxes per frame in
    // reasonable time; tests cap the buildings drawn. Real devices use their tier's budget.
    `buildings=${options.buildings ?? 40_000}`,
    options.extra ?? "",
  ]
    .filter((part) => part !== "")
    .join("&");
  await page.goto(`./?${query}`);
  await page.waitForFunction(
    () => window.__hilltide !== undefined && (window.__hilltide.ready || window.__hilltide.failed),
    null,
    { timeout: 120_000 },
  );
  const failed = await page.evaluate(() => window.__hilltide?.failed ?? null);
  expect(failed, "the scene should start without failing").toBeNull();
}

type DataKey =
  | "backend"
  | "levels"
  | "firstFrame"
  | "renderedFrames"
  | "quality"
  | "gpu"
  | "year"
  | "buildings"
  | "cityProgress";

/** Reads one field of the page's state object. */
export function sceneValue<K extends DataKey>(page: Page, key: K): Promise<HilltideState[K]> {
  return page.evaluate((name) => {
    const state = window.__hilltide;
    if (state === undefined) throw new Error("Hilltide has not started");
    return state[name];
  }, key) as Promise<HilltideState[K]>;
}

/** Scrolls the story to a progress value and waits until the camera and loading have settled. */
export async function goToProgress(page: Page, progress: number): Promise<void> {
  await page.evaluate((value) => window.__hilltide?.scrollToProgress(value), progress);
  await page.waitForFunction(
    (value) => {
      const state = window.__hilltide;
      return state?.settled === true && Math.abs(state.progress - value) < 0.01;
    },
    progress,
    { timeout: 180_000 },
  );
}

export interface ImageStats {
  readonly width: number;
  readonly height: number;
  /** Distinct colours after rounding each channel to 16 levels. */
  readonly colours: number;
  /** Standard deviation of luminance, 0 to 255. */
  readonly contrast: number;
  /** Mean luminance, 0 to 255. */
  readonly brightness: number;
}

/**
 * Takes a screenshot, saves it, and measures it, so a test can tell a real
 * picture from a blank or single-colour frame. `clip` limits the
 * measurement to part of the page (the saved file is always the full view).
 */
export async function screenshotStats(page: Page, path: string): Promise<ImageStats> {
  const png = await page.screenshot({ path });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const seen = new Set<number>();
    let sum = 0;
    let sumSquares = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luminance;
      sumSquares += luminance * luminance;
    }
    const mean = sum / pixels;
    return {
      width: bitmap.width,
      height: bitmap.height,
      colours: seen.size,
      contrast: Math.sqrt(Math.max(sumSquares / pixels - mean * mean, 0)),
      brightness: mean,
    };
  }, png.toString("base64"));
}

/** Scrolls Act 2 to a year and waits until buildings are loaded and the camera has settled. */
export async function goToYear(page: Page, year: number): Promise<void> {
  await page.evaluate((value) => window.__hilltide?.scrollToYear(value), year);
  await page.waitForFunction(
    (value) => {
      const state = window.__hilltide;
      return (
        state?.settled === true &&
        Math.abs(state.year - value) < 0.51 &&
        state.buildings.total > 0 &&
        state.buildings.loaded === state.buildings.total
      );
    },
    year,
    { timeout: 200_000 },
  );
}

/**
 * Share of pixels that differ visibly between two screenshots, inside a
 * region given as fractions of the image (left, top, right, bottom).
 */
export async function changedShare(
  page: Page,
  before: Buffer,
  after: Buffer,
  region: readonly [number, number, number, number],
): Promise<number> {
  return page.evaluate(
    async ({ a, b, box }) => {
      const load = async (base64: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        const x0 = Math.floor(bitmap.width * (box[0] as number));
        const y0 = Math.floor(bitmap.height * (box[1] as number));
        const x1 = Math.floor(bitmap.width * (box[2] as number));
        const y1 = Math.floor(bitmap.height * (box[3] as number));
        return context.getImageData(x0, y0, x1 - x0, y1 - y0);
      };
      const [first, second] = await Promise.all([load(a), load(b)]);
      let changed = 0;
      for (let i = 0; i < first.data.length; i += 4) {
        const difference =
          Math.abs((first.data[i] as number) - (second.data[i] as number)) +
          Math.abs((first.data[i + 1] as number) - (second.data[i + 1] as number)) +
          Math.abs((first.data[i + 2] as number) - (second.data[i + 2] as number));
        if (difference > 36) changed++;
      }
      return changed / (first.data.length / 4);
    },
    { a: before.toString("base64"), b: after.toString("base64"), box: [...region] },
  );
}
