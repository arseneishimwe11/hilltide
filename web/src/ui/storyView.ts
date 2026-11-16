import { type MessageKey, t } from "../core/i18n";
import type { SiteConfig } from "../core/siteConfig";
import type { Chapter } from "../story/scroll";
import { chapterOpacity } from "../story/scroll";
import { el } from "./dom";
import { ridgeLayers } from "./ridges";
import { YearControl } from "./yearControl";

const SVG_NS = "http://www.w3.org/2000/svg";

function ridgeDrawing(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 400");
  svg.setAttribute("preserveAspectRatio", "xMidYMax slice");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ridges");
  for (const layer of ridgeLayers(2016, 6)) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", layer.path);
    path.style.setProperty("--depth", layer.depth.toFixed(2));
    svg.append(path);
  }
  return svg;
}

export interface SunControlState {
  /** Clock time shown, "HH:MM" in Kigali. */
  readonly time: string;
  /** True while the scene follows the real current time. */
  readonly live: boolean;
  readonly night: boolean;
}

export interface StoryChapters {
  readonly land: readonly Chapter[];
  readonly city: readonly Chapter[];
}

export interface StoryYears {
  readonly first: number;
  readonly last: number;
}

/**
 * The page around the live scene: the canvas, the scrolling story with its
 * chapter text, the year control, the loading cover and the sun control.
 */
export class StoryView {
  readonly canvas: HTMLCanvasElement;
  /** The tall elements whose scroll spans drive each act. */
  readonly landSection: HTMLElement;
  readonly citySection: HTMLElement;
  readonly yearControl: YearControl;
  private readonly cover: HTMLElement;
  private readonly coverStatus: HTMLElement;
  private readonly chapterNodes = new Map<string, HTMLElement>();
  private readonly sunLabel: HTMLElement;
  private readonly sunButton: HTMLButtonElement;
  private readonly sunNote: HTMLElement;
  private readonly kigaliBody: HTMLElement;
  onToggleSun: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly chapters: StoryChapters,
    years: StoryYears,
    config: SiteConfig,
  ) {
    this.canvas = el("canvas", "scene");
    this.canvas.setAttribute("aria-hidden", "true");
    const main = el("main", "story");

    // --- Act 1 ---------------------------------------------------------------
    this.landSection = el("section", "act act--land");
    this.landSection.setAttribute("aria-label", t("land.kicker"));
    const landPin = el("div", "act__pin");
    const title = el("div", "chapter chapter--title");
    title.append(
      el("h1", "chapter__name", t("site.name")),
      el("p", "chapter__tagline", t("site.tagline")),
      el("p", "chapter__hint", t("land.title.hint")),
    );
    if (config.creatorName !== null) {
      title.append(el("p", "chapter__credit", t("about.createdBy", { name: config.creatorName })));
    }
    this.chapterNodes.set("title", title);
    landPin.append(
      title,
      this.chapter("country", "land.kicker", t("land.country.title"), t("land.country.body")),
      this.chapter("hills", "land.kicker", t("land.hills.title"), t("land.hills.body")),
    );
    const kigali = this.chapter("kigali", "land.kicker", t("land.kigali.title"), "");
    this.kigaliBody = kigali.querySelector(".chapter__body") as HTMLElement;
    landPin.append(kigali);
    this.landSection.append(landPin);

    // --- Act 2 ---------------------------------------------------------------
    this.citySection = el("section", "act act--city");
    this.citySection.setAttribute("aria-label", t("city.kicker"));
    const cityPin = el("div", "act__pin");
    this.yearControl = new YearControl(years.first, years.last);
    cityPin.append(
      this.chapter(
        "city-intro",
        "city.kicker",
        t("city.intro.title", { year: years.first }),
        t("city.intro.body"),
      ),
      this.chapter("city-growth", "city.kicker", t("city.growth.title"), t("city.growth.body")),
      this.chapter(
        "city-now",
        "city.kicker",
        t("city.now.title", { year: years.last }),
        t("city.now.body"),
      ),
      this.yearControl.root,
    );
    this.citySection.append(cityPin);

    const outro = el("section", "outro");
    outro.append(el("p", "outro__text", t("next.note")));
    main.append(this.landSection, this.citySection, outro);

    const sun = el("div", "sun");
    this.sunLabel = el("span", "sun__label");
    this.sunButton = el("button", "sun__button");
    this.sunButton.type = "button";
    this.sunButton.addEventListener("click", () => this.onToggleSun?.());
    this.sunNote = el("span", "sun__note");
    sun.append(this.sunLabel, this.sunButton, this.sunNote);

    this.cover = el("div", "cover");
    this.coverStatus = el("p", "cover__status", t("loading.status"));
    this.coverStatus.setAttribute("role", "status");
    this.cover.append(ridgeDrawing(), this.coverStatus);

    root.replaceChildren(this.canvas, main, sun, this.cover);
    this.setProgress(0, 0);
  }

  private chapter(id: string, kicker: MessageKey, title: string, body: string): HTMLElement {
    const node = el("div", "chapter");
    node.append(
      el("p", "chapter__kicker", t(kicker)),
      el("h2", "chapter__title", title),
      el("p", "chapter__body", body),
    );
    this.chapterNodes.set(id, node);
    return node;
  }

  /** Shows the chapter text that belongs to the progress through each act. */
  setProgress(land: number, city: number): void {
    const show = (chapters: readonly Chapter[], progress: number): void => {
      for (const chapter of chapters) {
        const node = this.chapterNodes.get(chapter.id);
        if (node === undefined) continue;
        const opacity = chapterOpacity(chapter, progress);
        node.style.opacity = opacity.toFixed(3);
        node.style.visibility = opacity > 0.01 ? "visible" : "hidden";
      }
    };
    show(this.chapters.land, land);
    show(this.chapters.city, city);
  }

  /** Fills in the measured elevation of Kigali's centre. */
  setKigaliElevation(metres: number): void {
    const rounded = Math.round(metres / 10) * 10;
    this.kigaliBody.textContent = t("land.kigali.body", {
      elevation: rounded.toLocaleString("en"),
    });
  }

  setSun(state: SunControlState): void {
    this.sunLabel.textContent = t(state.live ? "sun.now" : "sun.fixed", { time: state.time });
    this.sunButton.textContent = t(state.live ? "sun.golden" : "sun.live");
    this.sunNote.textContent = state.night ? t("sun.night") : "";
  }

  /** Fades the loading cover away once the live scene has drawn its first frame. */
  reveal(): void {
    this.cover.classList.add("cover--gone");
    this.cover.setAttribute("aria-hidden", "true");
  }

  /** Replaces the loading status with a message that stays (a failure the visitor should see). */
  fail(message: string, title?: string): void {
    this.coverStatus.textContent = message;
    this.coverStatus.classList.add("cover__status--error");
    if (title !== undefined) {
      this.cover.insertBefore(el("p", "cover__title", title), this.coverStatus);
    }
  }
}
