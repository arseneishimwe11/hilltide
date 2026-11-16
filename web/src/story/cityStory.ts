import { clamp } from "../core/math";
import type { CameraKey } from "./cameraPath";
import { LAND_KEYS } from "./landStory";
import type { Chapter } from "./scroll";

/** First and last year of the building record. */
export const FIRST_YEAR = 2016;
export const LAST_YEAR = 2023;

/**
 * Act 2, Kigali Builds Itself: the camera starts where Act 1 ended, drops
 * closer, and moves slowly round the south of the city while the years run.
 * Positions are local metres (z above sea level).
 */
export const CITY_KEYS: readonly CameraKey[] = [
  { ...(LAND_KEYS[LAND_KEYS.length - 1] as CameraKey), t: 0 },
  // From above Mount Kigali, looking north-east over the centre.
  { t: 0.18, position: [3_900, 2_600, 2_480], target: [8_000, 6_200, 1_480] },
  // Round the south of the city, about 900 m above the ridges.
  { t: 0.5, position: [7_000, 900, 2_400], target: [8_200, 6_400, 1_480] },
  { t: 0.8, position: [11_900, 2_300, 2_400], target: [8_400, 6_800, 1_480] },
  { t: 1, position: [13_900, 4_300, 2_520], target: [8_300, 7_000, 1_480] },
];

/** Text chapters of Act 2, by progress through the act. */
export const CITY_CHAPTERS: readonly Chapter[] = [
  { id: "city-intro", start: 0, end: 0.2 },
  { id: "city-growth", start: 0.2, end: 0.8 },
  { id: "city-now", start: 0.8, end: 1 },
];

/** The years run between these points of the act; before and after, the year holds still. */
const YEARS_START = 0.14;
const YEARS_END = 0.86;

/** The year shown at a progress through the act: 2016 at the start, 2023 at the end. */
export function yearForProgress(progress: number): number {
  const along = clamp((progress - YEARS_START) / (YEARS_END - YEARS_START), 0, 1);
  return FIRST_YEAR + along * (LAST_YEAR - FIRST_YEAR);
}

/** The progress through the act at which a year is shown; the inverse of `yearForProgress`. */
export function progressForYear(year: number): number {
  const along = clamp((year - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR), 0, 1);
  return YEARS_START + along * (YEARS_END - YEARS_START);
}
