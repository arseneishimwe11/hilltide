import * as THREE from "three/webgpu";
import type { Tier } from "../core/quality";
import { type BuildingStats, decodeBuildingTile, type TileInfo } from "../data/buildings";
import type { AssetLoader } from "../data/manifest";
import type { SceneUniforms } from "../terrain/terrainMaterial";
import { allocateInstances, type BudgetOptions } from "./budget";
import { createBuildingMaterial, YearUniforms } from "./buildingMaterial";
import { buildInstanceArrays, type Ground } from "./instances";

/** Most buildings drawn in a frame, and how far full detail reaches, by quality tier. */
export const BUILDING_BUDGETS: Readonly<Record<Tier, BudgetOptions>> = {
  low: { budget: 150_000, fullDetailDistance: 2_500, minShare: 0.04 },
  medium: { budget: 350_000, fullDetailDistance: 4_500, minShare: 0.08 },
  high: { budget: 1_000_000, fullDetailDistance: 60_000, minShare: 1 },
};

interface LoadedTile {
  readonly info: TileInfo;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly centre: THREE.Vector3;
  readonly sphere: THREE.Sphere;
}

/** The unit box every building is drawn from: four walls and a roof, no floor. */
function unitBox(): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    {
      normal: [0, 0, 1],
      corners: [
        [-0.5, -0.5, 1],
        [0.5, -0.5, 1],
        [0.5, 0.5, 1],
        [-0.5, 0.5, 1],
      ],
    },
    {
      normal: [0, -1, 0],
      corners: [
        [-0.5, -0.5, 0],
        [0.5, -0.5, 0],
        [0.5, -0.5, 1],
        [-0.5, -0.5, 1],
      ],
    },
    {
      normal: [1, 0, 0],
      corners: [
        [0.5, -0.5, 0],
        [0.5, 0.5, 0],
        [0.5, 0.5, 1],
        [0.5, -0.5, 1],
      ],
    },
    {
      normal: [0, 1, 0],
      corners: [
        [0.5, 0.5, 0],
        [-0.5, 0.5, 0],
        [-0.5, 0.5, 1],
        [0.5, 0.5, 1],
      ],
    },
    {
      normal: [-1, 0, 0],
      corners: [
        [-0.5, 0.5, 0],
        [-0.5, -0.5, 0],
        [-0.5, -0.5, 1],
        [-0.5, 0.5, 1],
      ],
    },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, index) => {
    for (const corner of face.corners) {
      positions.push(...corner);
      normals.push(...face.normal);
    }
    const first = index * 4;
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint16Array.from(indices),
  };
}

/**
 * Kigali's buildings: one instanced draw per 3.84 km tile, with heights
 * driven by the year. Tiles load nearest-first; each frame, tiles outside
 * the view are skipped and the rest share the device's building budget.
 */
export class BuildingLayer {
  readonly year = new YearUniforms();
  private readonly material: THREE.MeshBasicNodeMaterial;
  private readonly group = new THREE.Group();
  private readonly tiles: LoadedTile[] = [];
  private readonly box = unitBox();
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private loadedBuildings = 0;
  /** Buildings drawn in the latest frame. */
  drawn = 0;

  constructor(
    scene: THREE.Scene,
    uniforms: SceneUniforms,
    private readonly stats: BuildingStats,
  ) {
    this.material = createBuildingMaterial(uniforms, this.year);
    scene.add(this.group);
  }

  get totalBuildings(): number {
    return this.stats.footprints.dated;
  }

  get loaded(): number {
    return this.loadedBuildings;
  }

  get complete(): boolean {
    return this.tiles.length === this.stats.tiles.list.length;
  }

  /**
   * Loads every tile, those nearest `focus` first, one at a time so no
   * frame waits long. `onTile` is called after each tile is on screen.
   */
  async loadAll(
    assets: AssetLoader,
    groundAt: (x: number, y: number) => Ground,
    focus: readonly [number, number],
    onTile: () => void,
  ): Promise<void> {
    const half = this.stats.tiles.size / 2;
    const order = [...this.stats.tiles.list].sort((a, b) => {
      const da = Math.hypot(a.origin[0] + half - focus[0], a.origin[1] + half - focus[1]);
      const db = Math.hypot(b.origin[0] + half - focus[0], b.origin[1] + half - focus[1]);
      return da - db;
    });
    for (const info of order) {
      const data = await assets.bytes(`buildings.tile.${info.col}.${info.row}`);
      const tile = await decodeBuildingTile(data);
      this.addTile(info, buildInstanceArrays(tile, groundAt), groundAt);
      onTile();
      // Let a frame through before the next tile.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private addTile(
    info: TileInfo,
    arrays: ReturnType<typeof buildInstanceArrays>,
    groundAt: (x: number, y: number) => Ground,
  ): void {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.box.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(this.box.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.box.indices, 1));
    geometry.setAttribute("aPlace", new THREE.InstancedBufferAttribute(arrays.place, 4));
    geometry.setAttribute("aShape", new THREE.InstancedBufferAttribute(arrays.shape, 4));
    geometry.setAttribute(
      "aHeightsA",
      new THREE.InstancedBufferAttribute(arrays.heightsA, 4, true),
    );
    geometry.setAttribute(
      "aHeightsB",
      new THREE.InstancedBufferAttribute(arrays.heightsB, 4, true),
    );
    geometry.instanceCount = 0;

    const size = this.stats.tiles.size;
    const cx = info.origin[0] + size / 2;
    const cy = info.origin[1] + size / 2;
    const centre = new THREE.Vector3(cx, cy, groundAt(cx, cy).height);
    // Generous: the tile's diagonal plus the relief and the tallest building inside it.
    const sphere = new THREE.Sphere(centre, size * 0.75 + 500 + info.maxHeight);

    const mesh = new THREE.Mesh(geometry, this.material);
    // Visibility is decided here each frame, together with the drawing budget.
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    this.tiles.push({ info, mesh, geometry, centre, sphere });
    this.loadedBuildings += arrays.count;
  }

  /** Sets the moment shown, as a year index (0 is the first year of the record). */
  setYear(yearIndex: number): void {
    this.year.set(yearIndex);
  }

  /**
   * Chooses what to draw this frame. `strength` is 0 to 1: buildings are
   * hidden entirely at 0 (from high altitude, where they would be specks).
   */
  update(camera: THREE.PerspectiveCamera, options: BudgetOptions, show: boolean): void {
    if (!show || this.tiles.length === 0) {
      this.group.visible = false;
      this.drawn = 0;
      return;
    }
    this.group.visible = true;
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    const demand = this.tiles.map((tile) => ({
      count: tile.info.count,
      distance: camera.position.distanceTo(tile.centre),
      visible: this.frustum.intersectsSphere(tile.sphere),
    }));
    const counts = allocateInstances(demand, options);
    let drawn = 0;
    this.tiles.forEach((tile, index) => {
      const count = counts[index] as number;
      tile.mesh.visible = count > 0;
      tile.geometry.instanceCount = count;
      drawn += count;
    });
    this.drawn = drawn;
  }

  dispose(): void {
    for (const tile of this.tiles) tile.geometry.dispose();
    this.material.dispose();
  }
}
