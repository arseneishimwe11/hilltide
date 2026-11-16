import * as THREE from "three/webgpu";

export type BackendKind = "webgpu" | "webgl2";

export interface RenderContext {
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: BackendKind;
  /** The GPU as the browser describes it, for the performance report. */
  readonly gpu: string;
  /** True when the GPU is a software rasteriser (headless tests, blocked drivers). */
  readonly softwareRenderer: boolean;
}

export interface RendererOptions {
  /** Use WebGL2 even where WebGPU is available (`?backend=webgl2`). */
  readonly forceWebGL?: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

interface WebGPUBackendLike {
  readonly isWebGPUBackend?: boolean;
  readonly device?: { readonly adapterInfo?: GPUAdapterInfoLike };
  readonly adapter?: { readonly info?: GPUAdapterInfoLike };
  readonly gl?: WebGL2RenderingContext;
}

interface GPUAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

function describeGpu(backend: WebGPUBackendLike): string {
  if (backend.isWebGPUBackend) {
    const info = backend.device?.adapterInfo ?? backend.adapter?.info;
    const parts = [info?.vendor, info?.architecture, info?.device, info?.description];
    const text = parts.filter((part) => part !== undefined && part !== "").join(" ");
    return text === "" ? "unknown (WebGPU)" : text;
  }
  const gl = backend.gl;
  if (gl === undefined) return "unknown";
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const name =
    extension === null
      ? gl.getParameter(gl.RENDERER)
      : gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
  return typeof name === "string" ? name : "unknown (WebGL2)";
}

/**
 * Creates the renderer on WebGPU when the browser offers it, otherwise on
 * WebGL2. Rejects when neither is available, so the caller can show a
 * plain message instead of a blank page.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: RendererOptions = {},
): Promise<RenderContext> {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: options.forceWebGL ?? false,
    powerPreference: "high-performance",
  });
  await renderer.init();
  const backendObject = renderer.backend as unknown as WebGPUBackendLike;
  const backend: BackendKind = backendObject.isWebGPUBackend ? "webgpu" : "webgl2";
  const gpu = describeGpu(backendObject);
  renderer.toneMapping = THREE.NoToneMapping;
  return { renderer, backend, gpu, softwareRenderer: SOFTWARE.test(gpu) };
}

/** Whether the browser can run Hilltide at all. */
export function graphicsSupport(): { webgpu: boolean; webgl2: boolean } {
  const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
  let webgl2 = false;
  try {
    webgl2 = document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    webgl2 = false;
  }
  return { webgpu, webgl2 };
}
