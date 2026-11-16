/**
 * How many buildings each tile draws.
 *
 * Tiles store their buildings largest first, so drawing the first N of a
 * tile keeps the buildings that matter most at that distance. Near tiles
 * draw everything; far tiles draw a share that shrinks with distance; and
 * if the total still exceeds the device's budget, every tile is scaled down
 * together.
 */

export interface TileDemand {
  /** Buildings in the tile. */
  readonly count: number;
  /** Distance from the camera to the tile's centre, in metres. */
  readonly distance: number;
  /** False when the tile is outside the view. */
  readonly visible: boolean;
}

export interface BudgetOptions {
  /** Most buildings drawn in one frame. */
  readonly budget: number;
  /** Within this distance a tile draws all of its buildings. */
  readonly fullDetailDistance: number;
  /** Smallest share of a visible tile that is ever drawn. */
  readonly minShare: number;
}

/** Share of a tile's buildings wanted at a distance, before the budget is applied. */
export function shareAtDistance(distance: number, options: BudgetOptions): number {
  if (distance <= options.fullDetailDistance) return 1;
  // Buildings shrink on screen with the square of distance.
  const share = (options.fullDetailDistance / distance) ** 2;
  return Math.max(share, options.minShare);
}

/** Buildings to draw per tile, in the order of `tiles`. */
export function allocateInstances(tiles: readonly TileDemand[], options: BudgetOptions): number[] {
  const wanted = tiles.map((tile) =>
    tile.visible ? Math.ceil(tile.count * shareAtDistance(tile.distance, options)) : 0,
  );
  const total = wanted.reduce((sum, value) => sum + value, 0);
  if (total <= options.budget) return wanted;
  const scale = options.budget / total;
  return wanted.map((value) => Math.floor(value * scale));
}
