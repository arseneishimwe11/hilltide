/**
 * Reader for the Hilltide asset container (`HLT1`).
 *
 * Layout (little-endian): magic "HLT1", uint32 header length, a JSON header
 * padded to an 8-byte boundary, then gzip-compressed sections back to back.
 * The format is defined in pipeline/src/hilltide_pipeline/container.py.
 */

import { decodeDelta16, decodeDelta32, decodePlane16 } from "./codecs";

export type DtypeName = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32";
export type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array;

export interface SectionEntry {
  readonly name: string;
  /** Type and element count of the decoded array. */
  readonly dtype: DtypeName;
  readonly count: number;
  /** Type and element count as stored, before the encoding is undone. */
  readonly storedDtype: DtypeName;
  readonly storedCount: number;
  readonly encoding: "raw" | "plane16" | "delta16" | "delta32";
  readonly offset: number;
  readonly length: number;
  readonly compression: "gzip" | "none";
}

export interface ContainerHeader<Meta = Record<string, unknown>> {
  readonly kind: string;
  readonly version: number;
  readonly meta: Meta;
  readonly sections: readonly SectionEntry[];
}

const MAGIC = [0x48, 0x4c, 0x54, 0x31]; // "HLT1"

const BYTES_PER_ELEMENT: Record<DtypeName, number> = {
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  f32: 4,
};

function typedView(dtype: DtypeName, bytes: Uint8Array): TypedArray {
  // Copy so the view is aligned and owns its memory, whatever the source offset was.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  switch (dtype) {
    case "u8":
      return new Uint8Array(buffer);
    case "i8":
      return new Int8Array(buffer);
    case "u16":
      return new Uint16Array(buffer);
    case "i16":
      return new Int16Array(buffer);
    case "u32":
      return new Uint32Array(buffer);
    case "i32":
      return new Int32Array(buffer);
    case "f32":
      return new Float32Array(buffer);
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An opened asset: its header, and sections decoded on request. */
export class Container<Meta = Record<string, unknown>> {
  private constructor(
    readonly header: ContainerHeader<Meta>,
    private readonly body: Uint8Array,
  ) {}

  static parse<Meta = Record<string, unknown>>(data: ArrayBuffer): Container<Meta> {
    const bytes = new Uint8Array(data);
    if (bytes.length < 8 || MAGIC.some((value, index) => bytes[index] !== value)) {
      throw new Error("Not a Hilltide asset (bad magic)");
    }
    const headerLength = new DataView(data).getUint32(4, true);
    if (8 + headerLength > bytes.length) {
      throw new Error("Hilltide asset is cut short (header)");
    }
    const headerText = new TextDecoder().decode(bytes.subarray(8, 8 + headerLength));
    const header = JSON.parse(headerText) as ContainerHeader<Meta>;
    return new Container(header, bytes.subarray(8 + headerLength));
  }

  get kind(): string {
    return this.header.kind;
  }

  get meta(): Meta {
    return this.header.meta;
  }

  /** Fails with a clear message when an asset is not what the caller expects. */
  expect(kind: string, version: number): this {
    if (this.header.kind !== kind || this.header.version !== version) {
      throw new Error(
        `Expected a "${kind}" asset version ${version}, got "${this.header.kind}" version ${this.header.version}`,
      );
    }
    return this;
  }

  private entry(name: string): SectionEntry {
    const entry = this.header.sections.find((section) => section.name === name);
    if (entry === undefined) {
      throw new Error(`Asset "${this.header.kind}" has no section "${name}"`);
    }
    return entry;
  }

  /**
   * Decompresses and decodes one section. `shape` is needed for 2D encodings
   * ("plane16"), as [height, width].
   */
  async section(name: string, shape?: readonly [number, number]): Promise<TypedArray> {
    const entry = this.entry(name);
    if (entry.offset + entry.length > this.body.length) {
      throw new Error(`Section "${name}" runs past the end of the asset`);
    }
    const packed = this.body.subarray(entry.offset, entry.offset + entry.length);
    const raw = entry.compression === "gzip" ? await gunzip(packed) : packed;
    if (raw.length !== entry.storedCount * BYTES_PER_ELEMENT[entry.storedDtype]) {
      throw new Error(`Section "${name}" has the wrong size after decompression`);
    }
    let decoded: TypedArray;
    switch (entry.encoding) {
      case "raw":
        decoded = typedView(entry.storedDtype, raw);
        break;
      case "plane16": {
        if (shape === undefined) throw new Error(`Section "${name}" needs a [height, width]`);
        decoded = decodePlane16(raw, shape[0], shape[1]);
        break;
      }
      case "delta16":
        decoded = decodeDelta16(raw);
        break;
      case "delta32":
        decoded = decodeDelta32(raw);
        break;
    }
    if (decoded.length !== entry.count) {
      throw new Error(`Section "${name}": expected ${entry.count} values, got ${decoded.length}`);
    }
    return decoded;
  }

  async u8(name: string): Promise<Uint8Array> {
    return this.typed(name, Uint8Array);
  }

  async u16(name: string, shape?: readonly [number, number]): Promise<Uint16Array> {
    return this.typed(name, Uint16Array, shape);
  }

  async i32(name: string): Promise<Int32Array> {
    return this.typed(name, Int32Array);
  }

  private async typed<T extends TypedArray>(
    name: string,
    type: { new (length: number): T; readonly name: string },
    shape?: readonly [number, number],
  ): Promise<T> {
    const data = await this.section(name, shape);
    if (!(data instanceof type)) {
      throw new Error(`Section "${name}" is not a ${type.name}`);
    }
    return data;
  }
}
