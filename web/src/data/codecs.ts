/**
 * Decoders for the reversible transforms the pipeline applies before
 * compression. Each mirrors an encoder in pipeline/src/hilltide_pipeline/codecs.py.
 */

/** Rebuilds little-endian values of `width` bytes from byte planes (all first bytes, then all second bytes, ...). */
function joinPlanes(planes: Uint8Array, width: 2 | 4): Uint32Array {
  const count = planes.length / width;
  if (!Number.isInteger(count)) {
    throw new Error(`Byte planes of length ${planes.length} do not divide by ${width}`);
  }
  const values = new Uint32Array(count);
  for (let plane = 0; plane < width; plane++) {
    const shift = plane * 8;
    const start = plane * count;
    for (let i = 0; i < count; i++) {
      values[i] = (values[i] as number) | ((planes[start + i] as number) << shift);
    }
  }
  return values;
}

/** Zigzag code to signed integer: 0, 1, 2, 3, ... -> 0, -1, 1, -2, ... */
function unzigzag(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

/** "plane16": a 2D uint16 grid stored as zigzag differences from left + up - upleft. */
export function decodePlane16(planes: Uint8Array, height: number, width: number): Uint16Array {
  const residual = joinPlanes(planes, 2);
  if (residual.length !== height * width) {
    throw new Error(`plane16: expected ${height * width} values, got ${residual.length}`);
  }
  const out = new Uint16Array(height * width);
  for (let row = 0; row < height; row++) {
    const start = row * width;
    let running = 0; // sum of this row's residuals so far
    for (let col = 0; col < width; col++) {
      running += unzigzag(residual[start + col] as number);
      const above = row === 0 ? 0 : (out[start - width + col] as number);
      out[start + col] = above + running; // wraps modulo 65536 like the encoder
    }
  }
  return out;
}

/** "delta16": a uint16 sequence stored as zigzag differences from the previous value. */
export function decodeDelta16(planes: Uint8Array): Uint16Array {
  const residual = joinPlanes(planes, 2);
  const out = new Uint16Array(residual.length);
  let running = 0;
  for (let i = 0; i < residual.length; i++) {
    running += unzigzag(residual[i] as number);
    out[i] = running;
  }
  return out;
}

/** "delta32": an int32 sequence stored as zigzag differences from the previous value. */
export function decodeDelta32(planes: Uint8Array): Int32Array {
  const residual = joinPlanes(planes, 4);
  const out = new Int32Array(residual.length);
  let running = 0;
  for (let i = 0; i < residual.length; i++) {
    running = (running + unzigzag(residual[i] as number)) | 0;
    out[i] = running;
  }
  return out;
}
