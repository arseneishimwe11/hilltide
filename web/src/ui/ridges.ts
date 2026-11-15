/**
 * Layered ridge lines for the placeholder page: a small, deterministic
 * drawing of receding hills. Replaced by the live terrain in Phase 2.
 */

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** One ridge profile: heights in [0, 1] at evenly spaced points, from summed sine waves. */
export function ridgeProfile(random: () => number, points: number): number[] {
  const waves = Array.from({ length: 5 }, (_unused, octave) => ({
    frequency: (octave + 1) * (0.8 + random() * 0.9),
    phase: random() * Math.PI * 2,
    amplitude: 1 / (octave + 1.4),
  }));
  const total = waves.reduce((sum, wave) => sum + wave.amplitude, 0);
  return Array.from({ length: points }, (_unused, index) => {
    const x = (index / (points - 1)) * Math.PI * 2;
    const sum = waves.reduce(
      (acc, wave) => acc + Math.sin(x * wave.frequency + wave.phase) * wave.amplitude,
      0,
    );
    return (sum / total + 1) / 2;
  });
}

export interface RidgeLayer {
  /** SVG path data for a filled ridge, in a 1000 x 400 box. */
  readonly path: string;
  /** 0 for the farthest ridge, 1 for the nearest. */
  readonly depth: number;
}

export function ridgeLayers(seed: number, count: number): RidgeLayer[] {
  const random = seededRandom(seed);
  const width = 1000;
  const height = 400;
  const points = 96;
  return Array.from({ length: count }, (_unused, layer) => {
    const depth = count === 1 ? 1 : layer / (count - 1);
    const base = 120 + depth * 210;
    const relief = 70 - depth * 25;
    const profile = ridgeProfile(random, points);
    const line = profile
      .map((value, index) => {
        const x = (index / (points - 1)) * width;
        const y = base - value * relief;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    return { path: `${line} L${width} ${height} L0 ${height} Z`, depth };
  });
}
