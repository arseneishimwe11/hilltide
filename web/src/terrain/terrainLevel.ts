import * as THREE from "three/webgpu";
import type { GridSpec } from "../data/grid";
import { gridXMax, gridYMin } from "../data/grid";

/**
 * GPU resources of one terrain level: the texel texture (height, slopes,
 * land-cover class) and the numbers the shader needs to address it.
 */
export class TerrainLevel {
  readonly texture: THREE.DataTexture;
  /** (xMin, yMax, cell, 0): where the grid sits in local metres. */
  readonly placement: THREE.Vector4;
  /** (width, height) in cells. */
  readonly size: THREE.Vector2;
  /** (xMin, yMin, xMax, yMax) of the area the mesh covers: cell centres of the outer cells. */
  readonly extent: THREE.Vector4;

  constructor(
    readonly grid: GridSpec,
    texels: Float32Array,
  ) {
    if (texels.length !== grid.width * grid.height * 4) {
      throw new Error(`Terrain texels do not match grid "${grid.name}"`);
    }
    this.texture = new THREE.DataTexture(
      texels,
      grid.width,
      grid.height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    // Read with exact texel fetches and blended in the shader, so no float
    // filtering support is needed from the device.
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;

    this.placement = new THREE.Vector4(grid.xMin, grid.yMax, grid.cell, 0);
    this.size = new THREE.Vector2(grid.width, grid.height);
    const half = grid.cell / 2;
    this.extent = new THREE.Vector4(
      grid.xMin + half,
      gridYMin(grid) + half,
      gridXMax(grid) - half,
      grid.yMax - half,
    );
  }

  dispose(): void {
    this.texture.dispose();
  }
}
