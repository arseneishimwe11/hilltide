import type { AssetLoader } from "../data/manifest";
import type { DecodeRequest, DecodeResponse } from "../workers/decode";
import { type PreparedTerrain, prepareTerrain } from "./prepare";

export type LevelName = "country" | "region" | "kigali";

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
    const [heights, cover] = await Promise.all([
      this.assets.bytes(`terrain.${level}`),
      this.assets.bytes(`landcover.${level}`),
    ]);
    const worker = this.worker;
    if (worker === null) return prepareTerrain(heights, cover);
    try {
      // Copies are sent so the originals stay usable for the fallback.
      const request: DecodeRequest = {
        id: this.nextId++,
        heights: heights.slice(0),
        cover: cover.slice(0),
      };
      return await new Promise<PreparedTerrain>((resolve, reject) => {
        this.waiting.set(request.id, { resolve, reject });
        worker.postMessage(request, [request.heights, request.cover as ArrayBuffer]);
      });
    } catch {
      return prepareTerrain(heights, cover);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
