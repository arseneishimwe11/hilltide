import { dot, float, max, mix, positionWorldDirection, pow, smoothstep, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { clamp, type Vec3 } from "../core/math";
import type { QualitySettings } from "../core/quality";
import type { Lighting } from "../sky/lighting";
import type { CameraPose } from "../story/cameraPath";
import { PALETTE_SIZE, paletteTexels } from "./palette";
import type { PreparedTerrain } from "./prepare";
import { TerrainLevel } from "./terrainLevel";
import type { LevelName } from "./terrainLoader";
import { createTerrainMaterial, SceneUniforms, type TerrainMaterial } from "./terrainMaterial";

/** Coarsest to finest. A finer level is drawn on top of the coarser ones. */
const LEVEL_ORDER: readonly LevelName[] = ["country", "region", "kigali"];

/** Linear colour of the darkness beyond the mapped land, seen from orbit. */
const VOID_COLOUR = [0.006, 0.01, 0.012] as const;

/** Width in metres of the band where a level follows the coarser level around it. */
const BLEND_BAND: Readonly<Record<LevelName, number>> = { country: 0, region: 3000, kigali: 900 };

interface LoadedLevel {
  readonly name: LevelName;
  readonly terrain: PreparedTerrain;
  readonly level: TerrainLevel;
  shader: TerrainMaterial;
  mesh: THREE.Mesh;
}

/** The land: nested terrain levels, sky, light and camera. */
export class LandScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 100, 1_500_000);
  readonly uniforms = new SceneUniforms();

  private readonly palette: THREE.DataTexture;
  private readonly levels = new Map<LevelName, LoadedLevel>();
  private readonly sunDirection = uniform(new THREE.Vector3(0, 0, 1));
  private readonly sunDisc = uniform(1);
  private quality: QualitySettings;
  private altitudeFactor = 1;

  constructor(quality: QualitySettings) {
    this.quality = quality;
    this.camera.up.set(0, 0, 1);
    this.palette = new THREE.DataTexture(
      paletteTexels(),
      PALETTE_SIZE,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.palette.minFilter = THREE.NearestFilter;
    this.palette.magFilter = THREE.NearestFilter;
    this.palette.needsUpdate = true;
    this.scene.backgroundNode = this.skyNode();
  }

  /** Sky by view direction: zenith to horizon above, haze fading to the void below. */
  private skyNode(): THREE.Node<"vec3"> {
    const u = this.uniforms;
    const direction = positionWorldDirection;
    const up = direction.z;
    const above = mix(u.skyHorizon, u.skyZenith, pow(max(up, 0), 0.45));
    const below = mix(u.skyHorizon, u.voidColour, smoothstep(0, 0.22, up.negate()));
    const sky = mix(below, above, smoothstep(-0.01, 0.01, up));
    const toSun = max(dot(direction, this.sunDirection), 0);
    const disc = smoothstep(0.99985, 0.99995, toSun).mul(6);
    const glow = pow(toSun, 90).mul(0.5).add(pow(toSun, 8).mul(0.12));
    return sky.add(u.lightColour.mul(disc.add(glow)).mul(this.sunDisc)).mul(float(1));
  }

  has(name: LevelName): boolean {
    return this.levels.has(name);
  }

  get loadedLevels(): LevelName[] {
    return LEVEL_ORDER.filter((name) => this.levels.has(name));
  }

  /** Adds a terrain level. Coarser levels must be added before finer ones. */
  addLevel(name: LevelName, terrain: PreparedTerrain): void {
    if (this.levels.has(name)) return;
    const level = new TerrainLevel(terrain.grid, terrain.texels);
    const entry = { name, terrain, level } as LoadedLevel;
    this.levels.set(name, entry);
    this.buildMesh(entry);
    this.linkLevels();
  }

  private parentOf(name: LevelName): LoadedLevel | null {
    for (let i = LEVEL_ORDER.indexOf(name) - 1; i >= 0; i--) {
      const candidate = this.levels.get(LEVEL_ORDER[i] as LevelName);
      if (candidate !== undefined) return candidate;
    }
    return null;
  }

  private buildMesh(entry: LoadedLevel): void {
    if (entry.mesh !== undefined) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.shader.material.dispose();
    }
    const parent = this.parentOf(entry.name);
    entry.shader = createTerrainMaterial(entry.level, this.palette, this.uniforms, {
      parent: parent?.level ?? null,
      blendBand: BLEND_BAND[entry.name],
      shadowSteps: this.quality.shadowSteps,
      fadeAtEdge: parent === null,
    });
    const quads = this.quality.meshQuads;
    entry.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, quads, quads), entry.shader.material);
    // The vertex shader moves the grid, so three.js cannot know its bounds.
    entry.mesh.frustumCulled = false;
    // Finer levels first: they win the depth test where levels overlap.
    entry.mesh.renderOrder = -LEVEL_ORDER.indexOf(entry.name);
    this.scene.add(entry.mesh);
  }

  /** Tells each level which finer level sits on top of it. */
  private linkLevels(): void {
    for (const entry of this.levels.values()) {
      const finer = [...this.levels.values()].find((other) => this.parentOf(other.name) === entry);
      if (finer === undefined) {
        entry.shader.inner.set(0, 0, 0, 0);
      } else {
        entry.shader.inner.copy(finer.level.extent);
        entry.shader.innerBand.value = BLEND_BAND[finer.name];
      }
    }
  }

  /** Applies new quality settings; meshes and shaders are rebuilt only if they changed. */
  setQuality(quality: QualitySettings): void {
    const rebuild =
      quality.meshQuads !== this.quality.meshQuads ||
      quality.shadowSteps !== this.quality.shadowSteps;
    this.quality = quality;
    if (!rebuild) return;
    for (const name of LEVEL_ORDER) {
      const entry = this.levels.get(name);
      if (entry !== undefined) this.buildMesh(entry);
    }
    this.linkLevels();
  }

  setLighting(lighting: Lighting, sunDirection: Vec3): void {
    const u = this.uniforms;
    u.lightDirection.value.set(...lighting.lightDirection);
    u.lightColour.value.set(...lighting.lightColour);
    u.ambientColour.value.set(...lighting.ambientColour);
    u.hazeColour.value.set(...lighting.hazeColour);
    u.skyHorizon.value.set(...lighting.skyHorizon);
    u.skyZenith.value.set(...lighting.skyZenith);
    this.sunDirection.value.set(...sunDirection);
    this.sunDisc.value = lighting.moonlit ? 0 : 1;
    this.updateVoid();
  }

  /** Terrain height under a point, from the finest loaded level that covers it. */
  groundAt(x: number, y: number): number {
    for (let i = LEVEL_ORDER.length - 1; i >= 0; i--) {
      const entry = this.levels.get(LEVEL_ORDER[i] as LevelName);
      if (entry === undefined) continue;
      const { grid, heights } = entry.terrain;
      const col = Math.floor((x - grid.xMin) / grid.cell);
      const row = Math.floor((grid.yMax - y) / grid.cell);
      if (col >= 0 && col < grid.width && row >= 0 && row < grid.height) {
        return heights[row * grid.width + col] as number;
      }
    }
    return 0;
  }

  /** Places the camera and adapts haze, relief shading and depth range to its altitude. */
  setCamera(pose: CameraPose, aspect: number): void {
    const [x, y, z] = pose.position;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    this.camera.aspect = aspect;

    const altitude = Math.max(z - this.groundAt(x, y), 50);
    this.camera.near = clamp(altitude * 0.05, 20, 30_000);
    this.camera.far = clamp(altitude * 6 + 400_000, 400_000, 2_500_000);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const u = this.uniforms;
    u.curveCentre.value.set(x, y);
    // 0 near the ground, 1 from orbit.
    const high = clamp(Math.log(altitude / 3000) / Math.log(120_000 / 3000), 0, 1);
    this.altitudeFactor = high;
    // Thin haze from orbit, thick enough near the ground to give the hills depth.
    u.hazeDensity.value = (0.036 + 0.05 * high) / Math.max(altitude, 2000);
    u.hazeLimit.value = 0.94 - 0.6 * high;
    // From far above, true relief is invisible: strengthen the shading only (never the shape).
    u.reliefBoost.value = 1.3 + 2.3 * high;
    u.glintStrength.value = 0.7 * (1 - high) + 0.04;
    this.updateVoid();
  }

  /**
   * What lies beyond the mapped land: darkness when seen from orbit, and
   * the colour of distant haze when standing among the hills, so the land
   * meets the sky without a dark line at the horizon.
   */
  private updateVoid(): void {
    const haze = this.uniforms.skyHorizon.value;
    const high = this.altitudeFactor;
    this.uniforms.voidColour.value.set(
      haze.x + (VOID_COLOUR[0] - haze.x) * high,
      haze.y + (VOID_COLOUR[1] - haze.y) * high,
      haze.z + (VOID_COLOUR[2] - haze.z) * high,
    );
  }

  dispose(): void {
    for (const entry of this.levels.values()) {
      entry.mesh.geometry.dispose();
      entry.shader.material.dispose();
      entry.level.dispose();
    }
    this.palette.dispose();
  }
}
