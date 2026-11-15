import { Container } from "./container";

export interface LinesMeta {
  /** Local metres of the point that stored coordinates are relative to. */
  readonly origin: readonly [number, number];
  /** Metres per stored unit. */
  readonly unit: number;
  readonly lineCount: number;
  readonly pointCount: number;
  readonly lengthKm: number;
  readonly names: readonly string[];
  /** Meaning of the per-line kind codes, when the asset has classes. */
  readonly kinds?: Readonly<Record<string, string>>;
}

/** A set of polylines (rivers, a border) in local metres. */
export interface LineSet {
  readonly meta: LinesMeta;
  /** x, y pairs of every point of every line, back to back. */
  readonly positions: Float32Array;
  /** Index of each line's first point; one extra final entry equals the point count. */
  readonly starts: Int32Array;
  /** Class code per line (for waterways: 1 river, 2 stream, 3 canal, 4 drain). */
  readonly kind: Uint8Array;
  /** Name per line; empty when unnamed. */
  readonly names: readonly string[];
}

export async function decodeLines(data: ArrayBuffer): Promise<LineSet> {
  const container = Container.parse<LinesMeta>(data).expect("lines", 1);
  const meta = container.meta;
  const [x, y, starts, kind, nameIndex] = await Promise.all([
    container.i32("x"),
    container.i32("y"),
    container.i32("starts"),
    container.u8("kind"),
    container.u16("name"),
  ]);
  const positions = new Float32Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    positions[2 * i] = meta.origin[0] + (x[i] as number) * meta.unit;
    positions[2 * i + 1] = meta.origin[1] + (y[i] as number) * meta.unit;
  }
  const table = ["", ...meta.names];
  const names = Array.from(nameIndex, (index) => table[index] ?? "");
  return { meta, positions, starts, kind, names };
}

/** Total length in metres, computed from the decoded points. */
export function totalLength(lines: LineSet): number {
  let length = 0;
  for (let line = 0; line + 1 < lines.starts.length; line++) {
    const first = lines.starts[line] as number;
    const end = lines.starts[line + 1] as number;
    for (let i = first + 1; i < end; i++) {
      const dx = (lines.positions[2 * i] as number) - (lines.positions[2 * i - 2] as number);
      const dy = (lines.positions[2 * i + 1] as number) - (lines.positions[2 * i - 1] as number);
      length += Math.hypot(dx, dy);
    }
  }
  return length;
}
