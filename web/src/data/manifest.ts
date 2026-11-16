/** The asset index written by the pipeline (web/public/data/manifest.json). */

export interface AssetEntry {
  readonly path: string;
  readonly kind: string;
  readonly version: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly sources: readonly string[];
  readonly info: Readonly<Record<string, unknown>>;
}

export interface SourceEntry {
  readonly name: string;
  readonly publisher: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly url: string;
  /** The credit text the source requires. */
  readonly attribution: string;
}

export interface Manifest {
  readonly version: number;
  readonly totalBytes: number;
  readonly assets: Readonly<Record<string, AssetEntry>>;
  readonly sources: Readonly<Record<string, SourceEntry>>;
}

export const MANIFEST_VERSION = 1;

export function parseManifest(raw: unknown): Manifest {
  const manifest = raw as Manifest;
  if (typeof manifest !== "object" || manifest === null || manifest.version !== MANIFEST_VERSION) {
    throw new Error("Unsupported or missing asset manifest");
  }
  return manifest;
}

/** Looks up an asset by key, with a clear error when the pipeline did not produce it. */
export function assetEntry(manifest: Manifest, key: string): AssetEntry {
  const entry = manifest.assets[key];
  if (entry === undefined) {
    throw new Error(`Asset "${key}" is not in the manifest`);
  }
  return entry;
}

export type Fetcher = (url: string) => Promise<Response>;

/** Calls the browser's fetch. (A bare reference to `fetch` cannot be stored and called later.) */
const browserFetch: Fetcher = (url) => fetch(url);

/** Loads assets relative to the data folder, through the manifest. */
export class AssetLoader {
  constructor(
    readonly manifest: Manifest,
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher = browserFetch,
  ) {}

  static async open(baseUrl: string, fetcher: Fetcher = browserFetch): Promise<AssetLoader> {
    const response = await fetcher(`${baseUrl}manifest.json`);
    if (!response.ok) throw new Error(`Could not load the asset manifest (${response.status})`);
    return new AssetLoader(parseManifest(await response.json()), baseUrl, fetcher);
  }

  /** Cache-safe URL: the content hash is part of it, so a rebuilt asset is refetched. */
  url(key: string): string {
    const entry = assetEntry(this.manifest, key);
    return `${this.baseUrl}${entry.path}?v=${entry.sha256.slice(0, 12)}`;
  }

  async bytes(key: string): Promise<ArrayBuffer> {
    const response = await this.fetcher(this.url(key));
    if (!response.ok) throw new Error(`Could not load asset "${key}" (${response.status})`);
    return response.arrayBuffer();
  }

  async json<T>(key: string): Promise<T> {
    const response = await this.fetcher(this.url(key));
    if (!response.ok) throw new Error(`Could not load asset "${key}" (${response.status})`);
    return (await response.json()) as T;
  }
}
