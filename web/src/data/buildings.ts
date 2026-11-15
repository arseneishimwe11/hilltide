import { Container } from "./container";

export interface BuildingTileMeta {
  /** Local metres of the tile's south-west corner. */
  readonly origin: readonly [number, number];
  readonly tileSize: number;
  readonly count: number;
  readonly years: readonly number[];
  /** Metres per stored unit of position, length and width. */
  readonly lengthUnit: number;
  /** Metres per stored unit of height. */
  readonly heightUnit: number;
  /** Stored angle units per half turn. */
  readonly angleSteps: number;
}

/**
 * The buildings of one tile, largest footprint first, so drawing only the
 * first N is a cheap level of detail. Each building is a rectangle with the
 * area of its real footprint.
 */
export interface BuildingTile {
  readonly meta: BuildingTileMeta;
  readonly count: number;
  /** Centre in local metres. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Long and short side in metres. */
  readonly length: Float32Array;
  readonly width: Float32Array;
  /** Direction of the long side: radians from east, anticlockwise, in [0, pi). */
  readonly angle: Float32Array;
  /** Index into `meta.years` of the first year the building stands. */
  readonly first: Uint8Array;
  /** Height in metres per building and year (count x years, building-major); 0 before `first`. */
  readonly height: Float32Array;
}

export async function decodeBuildingTile(data: ArrayBuffer): Promise<BuildingTile> {
  const container = Container.parse<BuildingTileMeta>(data).expect("buildings", 1);
  const meta = container.meta;
  const [x, y, length, width, angle, first, height] = await Promise.all([
    container.u16("x"),
    container.u16("y"),
    container.u16("length"),
    container.u16("width"),
    container.u8("angle"),
    container.u8("first"),
    container.u8("height"),
  ]);
  const scaled = (values: Uint16Array | Uint8Array, unit: number, offset = 0): Float32Array => {
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = offset + (values[i] as number) * unit;
    return out;
  };
  return {
    meta,
    count: meta.count,
    x: scaled(x, meta.lengthUnit, meta.origin[0]),
    y: scaled(y, meta.lengthUnit, meta.origin[1]),
    length: scaled(length, meta.lengthUnit),
    width: scaled(width, meta.lengthUnit),
    angle: scaled(angle, Math.PI / meta.angleSteps),
    first,
    height: scaled(height, meta.heightUnit),
  };
}

export interface YearTotals {
  readonly year: number;
  readonly buildings: number;
  readonly footprintKm2: number;
}

export interface RasterYear {
  readonly year: number;
  readonly builtKm2: number;
  readonly builtKm2City: number;
  readonly countEstimate: number;
  readonly countEstimateCity: number;
}

export interface TileInfo {
  readonly col: number;
  readonly row: number;
  readonly origin: readonly [number, number];
  readonly count: number;
  readonly countByFirstYear: readonly number[];
  readonly maxHeight: number;
}

/** buildings/stats.json: yearly totals, method parameters and the tile index. */
export interface BuildingStats {
  readonly years: readonly number[];
  readonly method: Readonly<Record<string, string | number>>;
  readonly footprints: {
    readonly onGrid: number;
    readonly byPublishedPrecision: Readonly<Record<string, number>>;
    readonly used: number;
    readonly dated: number;
    readonly tooFaintToDate: number;
    readonly notSteadilyPresent: number;
  };
  readonly grid: { readonly areaKm2: number; readonly byYear: readonly YearTotals[] };
  readonly city: {
    readonly name: string;
    readonly areaKm2: number;
    readonly byYear: readonly YearTotals[];
  };
  readonly rasters: { readonly note: string; readonly byYear: readonly RasterYear[] };
  readonly tiles: {
    readonly size: number;
    readonly across: number;
    readonly list: readonly TileInfo[];
  };
}

/**
 * Totals at a fractional year, for the slider between two data years.
 * Counts are interpolated linearly; the result is clamped to the record.
 */
export function totalsAt(rows: readonly YearTotals[], year: number): YearTotals {
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) throw new Error("No yearly totals");
  if (year <= first.year) return first;
  if (year >= last.year) return last;
  const index = rows.findIndex((row) => row.year > year);
  const before = rows[index - 1] as YearTotals;
  const after = rows[index] as YearTotals;
  const t = (year - before.year) / (after.year - before.year);
  return {
    year,
    buildings: Math.round(before.buildings + (after.buildings - before.buildings) * t),
    footprintKm2: before.footprintKm2 + (after.footprintKm2 - before.footprintKm2) * t,
  };
}
