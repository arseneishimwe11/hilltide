import { t } from "../core/i18n";
import type { SiteConfig } from "../core/siteConfig";
import { ridgeLayers } from "./ridges";

const SVG_NS = "http://www.w3.org/2000/svg";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

/** The Phase 0 page: name, tagline and an honest "being built" note. */
export function renderPlaceholder(root: HTMLElement, config: SiteConfig): void {
  const main = element("main", "placeholder");

  const copy = element("div", "placeholder__copy");
  copy.append(
    element("p", "placeholder__status", t("placeholder.status")),
    element("h1", "placeholder__name", t("site.name")),
    element("p", "placeholder__tagline", t("site.tagline")),
    element("p", "placeholder__body", t("placeholder.body")),
    element("p", "placeholder__acts", t("placeholder.acts")),
  );
  if (config.creatorName !== null) {
    copy.append(
      element("p", "placeholder__credit", t("about.createdBy", { name: config.creatorName })),
    );
  }

  main.append(ridgeDrawing(), copy);
  root.replaceChildren(main);
}
