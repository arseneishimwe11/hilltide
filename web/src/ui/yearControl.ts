import { t } from "../core/i18n";
import { type BuildingStats, totalsAt } from "../data/buildings";
import { el } from "./dom";

const whole = (value: number): string => Math.round(value).toLocaleString("en");

/** Growth between the first and last year, in percent, rounded to a whole number. */
export function growthPercent(first: number, last: number): number {
  return Math.round((last / first - 1) * 100);
}

/** The sentence that states how uncertain the growth figure is, from the statistics file. */
export function rangeSentence(stats: BuildingStats): string {
  const rows = stats.city.byYear;
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const rasterFirst = stats.rasters.byYear[0];
  const rasterLast = stats.rasters.byYear[stats.rasters.byYear.length - 1];
  if (!firstRow || !lastRow || !rasterFirst || !rasterLast) return "";
  const byThreshold = stats.sensitivity.byThreshold.map((row) => row.growthPercent);
  return t("year.range", {
    first: firstRow.year,
    last: lastRow.year,
    central: growthPercent(firstRow.buildings, lastRow.buildings),
    low: Math.round(Math.min(...byThreshold)),
    high: Math.round(Math.max(...byThreshold)),
    raster: growthPercent(rasterFirst.countEstimateCity, rasterLast.countEstimateCity),
  });
}

export interface YearReadout {
  readonly year: string;
  readonly standing: string;
  readonly added: string;
  readonly area: string;
}

/** The figures shown for a moment between two data years, all computed from the statistics. */
export function readoutFor(stats: BuildingStats, year: number): YearReadout {
  const rows = stats.city.byYear;
  const first = rows[0];
  if (first === undefined) throw new Error("No yearly totals");
  const now = totalsAt(rows, year);
  return {
    year: String(Math.round(year)),
    standing: t("year.standing", { count: whole(now.buildings) }),
    added:
      now.buildings === first.buildings
        ? t("year.start")
        : t("year.added", { count: whole(now.buildings - first.buildings), year: first.year }),
    area: t("year.area", { area: now.footprintKm2.toFixed(1) }),
  };
}

/**
 * The year slider with its live figures. The slider is a native range
 * input, so it works with keyboard, touch and assistive technology.
 */
export class YearControl {
  readonly root: HTMLElement;
  private readonly yearText: HTMLElement;
  private readonly standing: HTMLElement;
  private readonly added: HTMLElement;
  private readonly area: HTMLElement;
  private readonly range: HTMLElement;
  private readonly status: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly playButton: HTMLButtonElement;
  private stats: BuildingStats | null = null;
  private shownYear = Number.NaN;
  /** Called when the visitor drags the slider or uses its keys. */
  onSeek: ((year: number) => void) | null = null;
  onTogglePlay: (() => void) | null = null;

  constructor(firstYear: number, lastYear: number) {
    this.root = el("div", "year");
    this.yearText = el("p", "year__now", String(firstYear));
    this.yearText.setAttribute("aria-hidden", "true");

    const figures = el("div", "year__figures");
    this.standing = el("p", "year__standing");
    this.added = el("p", "year__added");
    this.area = el("p", "year__area");
    figures.append(el("p", "year__where", t("year.where")), this.standing, this.added, this.area);
    figures.setAttribute("aria-live", "off");

    const controls = el("div", "year__controls");
    this.playButton = el("button", "year__play", t("year.play"));
    this.playButton.type = "button";
    this.playButton.addEventListener("click", () => this.onTogglePlay?.());
    this.slider = el("input", "year__slider");
    this.slider.type = "range";
    this.slider.min = String(firstYear);
    this.slider.max = String(lastYear);
    this.slider.step = "0.01";
    this.slider.value = String(firstYear);
    this.slider.setAttribute("aria-label", t("year.label"));
    this.slider.addEventListener("input", () => this.onSeek?.(Number(this.slider.value)));
    const ends = el("div", "year__ends");
    ends.append(el("span", "", String(firstYear)), el("span", "", String(lastYear)));
    ends.setAttribute("aria-hidden", "true");
    const track = el("div", "year__track");
    track.append(this.slider, ends);
    controls.append(this.playButton, track);

    this.range = el("p", "year__range");
    this.status = el("p", "year__status");
    this.status.setAttribute("role", "status");
    this.root.append(this.yearText, figures, controls, this.range, this.status);
  }

  setStats(stats: BuildingStats): void {
    this.stats = stats;
    this.range.textContent = rangeSentence(stats);
    this.shownYear = Number.NaN;
  }

  /** Shows a moment between years. Cheap to call every frame: it only writes when something changed. */
  setYear(year: number): void {
    if (this.stats === null || Math.abs(year - this.shownYear) < 0.004) return;
    this.shownYear = year;
    const readout = readoutFor(this.stats, year);
    this.yearText.textContent = readout.year;
    this.standing.textContent = readout.standing;
    this.added.textContent = readout.added;
    this.area.textContent = readout.area;
    this.slider.value = year.toFixed(2);
    this.slider.setAttribute("aria-valuetext", `${readout.year}: ${readout.standing}`);
  }

  setPlaying(playing: boolean): void {
    this.playButton.textContent = t(playing ? "year.pause" : "year.play");
    this.playButton.setAttribute("aria-pressed", String(playing));
  }

  /** Loading progress, then how many of the mapped buildings this device is drawing. */
  setStatus(loaded: number, total: number, drawn: number): void {
    this.status.textContent =
      loaded < total
        ? t("year.loading", { percent: Math.floor((loaded / Math.max(total, 1)) * 100) })
        : t("year.drawn", { drawn: whole(drawn), total: whole(total) });
  }
}
