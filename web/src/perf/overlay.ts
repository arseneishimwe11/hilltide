import { t } from "../core/i18n";
import type { QualityState } from "../core/quality";
import { el } from "../ui/dom";
import type { FrameSummary } from "./frameStats";

export interface PerfReport {
  readonly backend: string;
  readonly gpu: string;
  readonly softwareRenderer: boolean;
  readonly userAgent: string;
  readonly viewport: string;
  readonly drawingBuffer: string;
  readonly devicePixelRatio: number;
  readonly quality: QualityState;
  readonly frames: FrameSummary;
  readonly totalFrames: number;
  readonly totalHitches: number;
  readonly loadedLevels: readonly string[];
  readonly firstFrame: { ms: number; bytes: number; requests: number } | null;
  readonly buildingsDrawn: number;
}

/**
 * A small panel (`?perf=1`) showing measured frame times and what the page
 * is running on. "Copy report" puts the same numbers on the clipboard as
 * JSON, for recording real-device measurements.
 */
export class PerfOverlay {
  private readonly body: HTMLElement;
  private latest: PerfReport | null = null;

  constructor(parent: HTMLElement) {
    const panel = el("aside", "perf");
    panel.setAttribute("aria-label", t("perf.title"));
    this.body = el("pre", "perf__body");
    const copy = el("button", "perf__copy", t("perf.copy"));
    copy.type = "button";
    copy.addEventListener("click", () => {
      if (this.latest === null) return;
      void navigator.clipboard?.writeText(JSON.stringify(this.latest, null, 2)).then(() => {
        copy.textContent = t("perf.copied");
        setTimeout(() => {
          copy.textContent = t("perf.copy");
        }, 1500);
      });
    });
    panel.append(el("p", "perf__title", t("perf.title")), this.body, copy);
    parent.append(panel);
  }

  update(report: PerfReport): void {
    this.latest = report;
    const f = report.frames;
    const ms = (value: number): string => value.toFixed(1).padStart(6);
    this.body.textContent = [
      `${report.backend}${report.softwareRenderer ? " (software)" : ""}`,
      report.gpu,
      `${report.drawingBuffer} px, ratio ${report.devicePixelRatio}`,
      `quality ${report.quality.tier} x${report.quality.resolutionScale.toFixed(1)}`,
      `levels ${report.loadedLevels.join(" ")}`,
      `buildings drawn ${report.buildingsDrawn.toLocaleString("en")}`,
      report.firstFrame === null
        ? ""
        : `first frame ${report.firstFrame.ms} ms, ${(report.firstFrame.bytes / 1e6).toFixed(2)} MB`,
      "",
      `fps    ${f.fps.toFixed(1).padStart(6)}`,
      `median ${ms(f.medianMs)} ms`,
      `p95    ${ms(f.p95Ms)} ms`,
      `p99    ${ms(f.p99Ms)} ms`,
      `max    ${ms(f.maxMs)} ms`,
      `hitches ${report.totalHitches} of ${report.totalFrames} frames`,
    ].join("\n");
  }
}
