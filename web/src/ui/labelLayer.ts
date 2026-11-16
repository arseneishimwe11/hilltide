import { smoothstep } from "../core/math";
import { el } from "./dom";
import { projectToScreen } from "./projection";

/** A place label from the pipeline's curated list (labels/labels.json). */
export interface PlaceLabel {
  readonly name: string;
  readonly kind: "city" | "place" | "peak" | "lake" | "forest";
  /** "country": shown from high altitude. "kigali": shown when close to the city. */
  readonly level: "country" | "kigali";
  readonly x: number;
  readonly y: number;
  /** Summit height in metres, for peaks. */
  readonly elevation?: number;
}

export interface LabelView {
  /** Projection times view matrix, column-major. */
  readonly viewProjection: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  /** 0 near the ground, 1 from orbit. */
  readonly altitude01: number;
  /** Height of the drawn ground at a point, including the curvature drop. */
  groundAt(x: number, y: number): number;
}

/** How visible each level's labels are at a camera altitude (0 near the ground, 1 from orbit). */
export function levelOpacity(level: PlaceLabel["level"], altitude01: number): number {
  return level === "country"
    ? smoothstep(0.6, 0.85, altitude01)
    : 1 - smoothstep(0.06, 0.22, altitude01);
}

/** A few restrained place names, positioned over the live scene every frame. */
export class LabelLayer {
  private readonly root: HTMLElement;
  private readonly nodes: { label: PlaceLabel; node: HTMLElement }[] = [];

  constructor(parent: HTMLElement, before: Element | null, labels: readonly PlaceLabel[]) {
    this.root = el("div", "labels");
    this.root.setAttribute("aria-hidden", "true");
    for (const label of labels) {
      const node = el("span", `label label--${label.kind}`);
      node.append(el("span", "label__name", label.name));
      if (label.elevation !== undefined) {
        node.append(el("span", "label__detail", `${label.elevation.toLocaleString("en")} m`));
      }
      node.style.opacity = "0";
      this.root.append(node);
      this.nodes.push({ label, node });
    }
    parent.insertBefore(this.root, before);
  }

  update(view: LabelView): void {
    for (const { label, node } of this.nodes) {
      const opacity = levelOpacity(label.level, view.altitude01);
      if (opacity < 0.02) {
        node.style.opacity = "0";
        continue;
      }
      const point = projectToScreen(
        view.viewProjection,
        [label.x, label.y, view.groundAt(label.x, label.y)],
        view.width,
        view.height,
      );
      if (!point.visible) {
        node.style.opacity = "0";
        continue;
      }
      node.style.opacity = opacity.toFixed(2);
      node.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)`;
    }
  }
}
