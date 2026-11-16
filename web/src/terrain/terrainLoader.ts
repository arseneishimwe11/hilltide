import type { AssetLoader } from "../data/manifest";
import type { DecodeRequest, DecodeResponse } from "../workers/decode";
import { type PreparedTerrain, prepareTerrain, type WaterLines } from "./prepare";

export type LevelName = "country" | "region" | "kigali";

/**
 * Mapped waterways drawn as water on each level: the asset and the kinds
 * used (1 river, 3 canal). Streams and drains are left out: at these cell
 * sizes they would be drawn many times wider than they are.
 */
const WATER_LINES: Readonly<Record<LevelName, { asset: string; kinds: readonly number[] }>> = {
  country: { asset: "water.country", kinds: [1] },
  region: { asset: "water.country", kinds: [1] },
  kigali: { asset: "water.kigali", kinds: [1, 3] },
};

/**
 * Loads terrain levels and prepares them off the main thread, so a level
 * arriving during a scroll never stalls a frame. Falls back to the main
 * thread if the worker cannot start.
 */
export class TerrainLoader {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (terrain: PreparedTerrain) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly assets: AssetLoader) {
    try {
      this.worker = new Worker(new URL("../workers/decode.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
        const entry = this.waiting.get(event.data.id);
        if (entry === undefined) return;
        this.waiting.delete(event.data.id);
        if (event.data.ok) entry.resolve(event.data.terrain);
        else entry.reject(new Error(event.data.error));
      };
      this.worker.onerror = () => this.abandonWorker();
    } catch {
      this.worker = null;
    }
  }

  /** If the worker dies, finish what was asked on the main thread instead. */
  private abandonWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.waiting.values()) {
      entry.reject(new Error("The terrain worker stopped"));
    }
    this.waiting.clear();
  }

  async load(level: LevelName): Promise<PreparedTerrain> {
    const waterSource = WATER_LINES[level];
    const [heights, cover, lines] = await Promise.all([
      this.assets.bytes(`terrain.${level}`),
      this.assets.bytes(`landcover.${level}`),
      this.assets.bytes(waterSource.asset),
    ]);
    const water = (): WaterLines[] => [{ data: lines.slice(0), kinds: waterSource.kinds }];
    const worker = this.worker;
    if (worker === null) return prepareTerrain(heights, cover, water());
    try {
      // Copies are sent so the originals stay usable for the fallback.
      const request: DecodeRequest = {
        id: this.nextId++,
        heights: heights.slice(0),
        cover: cover.slice(0),
        water: water(),
      };
      return await new Promise<PreparedTerrain>((resolve, reject) => {
        this.waiting.set(request.id, { resolve, reject });
        worker.postMessage(request, [
          request.heights,
          request.cover as ArrayBuffer,
          ...request.water.map((entry) => entry.data),
        ]);
      });
    } catch {
      return prepareTerrain(heights, cover, water());
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
