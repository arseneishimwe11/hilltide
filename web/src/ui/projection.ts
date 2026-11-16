/**
 * Projects a point in the scene to pixel coordinates.
 *
 * `viewProjection` is the camera's projection matrix times its view matrix,
 * as 16 numbers in column-major order (the layout three.js uses).
 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** False when the point is behind the camera or outside the view. */
  readonly visible: boolean;
}

export function projectToScreen(
  viewProjection: ArrayLike<number>,
  point: readonly [number, number, number],
  width: number,
  height: number,
): ScreenPoint {
  const m = viewProjection;
  const [x, y, z] = point;
  const at = (i: number): number => m[i] as number;
  const clipX = at(0) * x + at(4) * y + at(8) * z + at(12);
  const clipY = at(1) * x + at(5) * y + at(9) * z + at(13);
  const clipW = at(3) * x + at(7) * y + at(11) * z + at(15);
  if (clipW <= 0) return { x: 0, y: 0, visible: false };
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
  };
}
