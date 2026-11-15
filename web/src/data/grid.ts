/**
 * A north-up raster grid in Hilltide's local metres (transverse Mercator
 * centred on 30 E). x grows east, y grows north; row 0 is the northern edge.
 * Mirrors Grid in pipeline/src/hilltide_pipeline/grid.py.
 */
export interface GridSpec {
  readonly name: string;
  readonly xMin: number;
  readonly yMax: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
}

export function gridXMax(grid: GridSpec): number {
  return grid.xMin + grid.width * grid.cell;
}

export function gridYMin(grid: GridSpec): number {
  return grid.yMax - grid.height * grid.cell;
}

/** Local (x, y) of the centre of cell (row, col). */
export function cellCentre(grid: GridSpec, row: number, col: number): [number, number] {
  return [grid.xMin + (col + 0.5) * grid.cell, grid.yMax - (row + 0.5) * grid.cell];
}

/** Fractional (row, col) of a local position; cell centres are at .5. */
export function cellOf(grid: GridSpec, x: number, y: number): [number, number] {
  return [(grid.yMax - y) / grid.cell, (x - grid.xMin) / grid.cell];
}
