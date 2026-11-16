import type { CameraKey } from "./cameraPath";
import type { Chapter } from "./scroll";

/**
 * Act 1, The Land: the camera path from high above Rwanda to Kigali.
 * Positions are local metres (x east, y north of 30 E, 2 S; z above sea level).
 *
 *   0.00  Rwanda from high altitude, the whole country in frame
 *   0.30  lower, over Lake Kivu, looking east across the Congo-Nile divide
 *   0.62  low over the central hills, heading east
 *   0.85  the hills west of Kigali
 *   1.00  settled above the city, looking north-east across its ridges
 */
export const LAND_KEYS: readonly CameraKey[] = [
  { t: 0, position: [-14_000, -48_000, 365_000], target: [-14_000, 6_000, 1_500] },
  { t: 0.3, position: [-118_000, -34_000, 62_000], target: [-70_000, -6_000, 1_800] },
  { t: 0.62, position: [-62_000, -14_000, 11_000], target: [-28_000, 0, 1_900] },
  { t: 0.85, position: [-24_000, -6_000, 6_200], target: [2_000, 5_000, 1_600] },
  { t: 1, position: [-5_500, -7_500, 4_600], target: [9_500, 7_500, 1_450] },
];

/** Text chapters of Act 1, by story progress. Their copy is in the message catalog. */
export const LAND_CHAPTERS: readonly Chapter[] = [
  { id: "title", start: 0, end: 0.16 },
  { id: "country", start: 0.16, end: 0.4 },
  { id: "hills", start: 0.4, end: 0.78 },
  { id: "kigali", start: 0.78, end: 1 },
];

/** Story progress from which each finer terrain level should be on screen. */
export const LEVEL_NEEDED_FROM = { region: 0.3, kigali: 0.7 } as const;

/** Kigali's centre in local metres (30.0619 E, 1.9441 S). */
export const KIGALI_CENTRE = [6_890, 6_181] as const;
