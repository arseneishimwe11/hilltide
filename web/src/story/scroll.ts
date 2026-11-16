import { clamp } from "../core/math";

/**
 * Progress through a tall section as the page scrolls: 0 when the section's
 * top reaches the top of the viewport, 1 when its bottom reaches the bottom
 * of the viewport. The section's content is expected to be sticky, so the
 * scene stays on screen for the whole span.
 */
export function sectionProgress(
  scrollY: number,
  sectionTop: number,
  sectionHeight: number,
  viewportHeight: number,
): number {
  const span = sectionHeight - viewportHeight;
  if (span <= 0) return scrollY >= sectionTop ? 1 : 0;
  return clamp((scrollY - sectionTop) / span, 0, 1);
}

/** A stretch of the story with its own text, from `start` to `end` of the section's progress. */
export interface Chapter {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/** The chapter that owns a progress value; the last chapter owns progress 1. */
export function chapterAt(chapters: readonly Chapter[], progress: number): Chapter | null {
  for (const chapter of chapters) {
    const isLast = chapter === chapters[chapters.length - 1];
    if (
      progress >= chapter.start &&
      (progress < chapter.end || (isLast && progress <= chapter.end))
    ) {
      return chapter;
    }
  }
  return null;
}

/**
 * How visible a chapter's text is at a progress value: fades in over the
 * first `fade` of its span and out over the last.
 */
export function chapterOpacity(chapter: Chapter, progress: number, fade = 0.2): number {
  const span = chapter.end - chapter.start;
  if (span <= 0 || progress < chapter.start || progress > chapter.end) return 0;
  const local = (progress - chapter.start) / span;
  const fadeIn = chapter.start <= 0 ? 1 : clamp(local / fade, 0, 1);
  const fadeOut = chapter.end >= 1 ? 1 : clamp((1 - local) / fade, 0, 1);
  return Math.min(fadeIn, fadeOut);
}

/** Scroll offset that corresponds to a progress value; the inverse of `sectionProgress`. */
export function scrollForProgress(
  progress: number,
  sectionTop: number,
  sectionHeight: number,
  viewportHeight: number,
): number {
  return sectionTop + clamp(progress, 0, 1) * Math.max(sectionHeight - viewportHeight, 0);
}
