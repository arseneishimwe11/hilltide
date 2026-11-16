/// <reference lib="webworker" />
import { type PreparedTerrain, prepareTerrain } from "../terrain/prepare";

export interface DecodeRequest {
  readonly id: number;
  readonly heights: ArrayBuffer;
  readonly cover: ArrayBuffer | null;
}

export type DecodeResponse =
  | { readonly id: number; readonly ok: true; readonly terrain: PreparedTerrain }
  | { readonly id: number; readonly ok: false; readonly error: string };

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, heights, cover } = event.data;
  try {
    const terrain = await prepareTerrain(heights, cover);
    const response: DecodeResponse = { id, ok: true, terrain };
    self.postMessage(response, [terrain.heights.buffer, terrain.texels.buffer]);
  } catch (error) {
    const response: DecodeResponse = { id, ok: false, error: String(error) };
    self.postMessage(response);
  }
};
