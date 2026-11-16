import type { GridSpec } from "../data/grid";
import type { LineSet } from "../data/lines";

/**
 * Marks the grid cells that lines pass through with a class code, for
 * example mapped rivers as water. The terrain shader then draws them like
 * any other water: draped exactly on the land, with no extra geometry.
 *
 * Returns the number of cells changed.
 */
export function burnLines(
  classes: Uint8Array,
  grid: GridSpec,
  lines: LineSet,
  kinds: ReadonlySet<number>,
  code: number,
): number {
  let changed = 0;
  const mark = (x: number, y: number): void => {
    const col = Math.floor((x - grid.xMin) / grid.cell);
    const row = Math.floor((grid.yMax - y) / grid.cell);
    if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return;
    const index = row * grid.width + col;
    if (classes[index] !== code) {
      classes[index] = code;
      changed++;
    }
  };
  const step = grid.cell / 2;
  for (let line = 0; line + 1 < lines.starts.length; line++) {
    if (!kinds.has(lines.kind[line] as number)) continue;
    const first = lines.starts[line] as number;
    const end = lines.starts[line + 1] as number;
    for (let i = first; i + 1 < end; i++) {
      const x0 = lines.positions[2 * i] as number;
      const y0 = lines.positions[2 * i + 1] as number;
      const x1 = lines.positions[2 * i + 2] as number;
      const y1 = lines.positions[2 * i + 3] as number;
      // Sample the segment every half cell, so no cell it crosses is skipped.
      const pieces = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let piece = 0; piece <= pieces; piece++) {
        const t = piece / pieces;
        mark(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    }
  }
  return changed;
}
