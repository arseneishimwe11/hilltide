import {
  cameraPosition,
  clamp,
  Discard,
  dot,
  exp,
  Fn,
  float,
  floor,
  If,
  int,
  ivec2,
  Loop,
  length,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  pow,
  reflect,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { LandClass } from "../data/landcover";
import type { TerrainLevel } from "./terrainLevel";

type F = THREE.Node<"float">;
type V2 = THREE.Node<"vec2">;
type V3 = THREE.Node<"vec3">;
type V4 = THREE.Node<"vec4">;

/** Mean Earth radius in metres, for the gentle curvature seen from altitude. */
export const EARTH_RADIUS = 6_371_000;

/** Uniforms shared by every terrain level and overlay: light, haze, camera. */
export class SceneUniforms {
  readonly lightDirection = uniform(new THREE.Vector3(0.4, 0.3, 0.86));
  readonly lightColour = uniform(new THREE.Vector3(1.3, 1.2, 1.1));
  readonly ambientColour = uniform(new THREE.Vector3(0.3, 0.34, 0.4));
  readonly hazeColour = uniform(new THREE.Vector3(0.66, 0.74, 0.8));
  readonly skyHorizon = uniform(new THREE.Vector3(0.56, 0.72, 0.86));
  readonly skyZenith = uniform(new THREE.Vector3(0.1, 0.27, 0.6));
  /** Colour of the emptiness beyond the mapped land. */
  readonly voidColour = uniform(new THREE.Vector3(0.006, 0.01, 0.012));
  /** Haze per metre of distance; thinner from high altitude. */
  readonly hazeDensity = uniform(0.00001);
  /** Most haze ever applied, 0 to 1. */
  readonly hazeLimit = uniform(0.75);
  /**
   * Multiplier on slope for lighting only (the shape of the land is never
   * exaggerated): large from orbit, where true relief is invisible, and a
   * mild emphasis near the ground, as on a shaded relief map.
   */
  readonly reliefBoost = uniform(1);
  /** Point on the ground under the camera, the centre of the curvature drop. */
  readonly curveCentre = uniform(new THREE.Vector2(0, 0));
  /** 0 to 1: how far the land fades into the void near the edge of the mapped area. */
  readonly edgeFade = uniform(1);
  /** Strength of the sun's glint on water; small from orbit, where it would cover a whole lake. */
  readonly glintStrength = uniform(0.6);
  /**
   * 0 to 1: how strongly Rwanda is set apart from its neighbours (border
   * line, dimmed surroundings). Full from orbit, none among the hills.
   */
  readonly countryFocus = uniform(1);
  /** Half-width of the border line in km; grows with altitude to stay about as wide on screen. */
  readonly borderWidthKm = uniform(1.2);
}

/** The signed distance to the Rwanda border as a texture, with where it sits on the ground. */
export interface CountryMask {
  readonly texture: THREE.DataTexture;
  /** (xMin, yMax, width in metres, height in metres) of the mask grid. */
  readonly placement: THREE.Vector4;
  readonly zero: number;
  readonly stepsPerKm: number;
}

/** Drop in metres at a ground position caused by the Earth's curvature. */
export function curvatureDrop(xy: V2, scene: SceneUniforms): F {
  const offset = xy.sub(scene.curveCentre);
  return dot(offset, offset).div(2 * EARTH_RADIUS);
}

interface LevelNodes {
  /** Bilinear texel: height, east slope, north slope (class channel is not meaningful here). */
  readonly surface: V4;
  /** Ground colour: the palette colours of the four surrounding cells, blended. */
  readonly colour: V3;
  /** Share of water among the four surrounding cells, 0 to 1. */
  readonly water: F;
}

/** Reads a level at a ground position: four exact texel fetches blended by hand. */
function readLevel(level: TerrainLevel, xy: V2, palette: THREE.DataTexture | null): LevelNodes {
  const placement = uniform(level.placement);
  const size = uniform(level.size);
  const cellPosition = vec2(
    xy.x.sub(placement.x).div(placement.z).sub(0.5),
    placement.y.sub(xy.y).div(placement.z).sub(0.5),
  );
  const clamped = clamp(cellPosition, vec2(0, 0), size.sub(1));
  const base = floor(clamped);
  const blend = clamped.sub(base);
  const next = min(base.add(1), size.sub(1));
  const a = textureLoad(level.texture, ivec2(base));
  const b = textureLoad(level.texture, ivec2(vec2(next.x, base.y)));
  const c = textureLoad(level.texture, ivec2(vec2(base.x, next.y)));
  const d = textureLoad(level.texture, ivec2(next));
  const surface = mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  if (palette === null) return { surface, colour: vec3(0, 0, 0), water: float(0) };

  const colourOf = (texel: V4): V3 => textureLoad(palette, ivec2(int(texel.w), int(0))).rgb;
  const isWater = (texel: V4): F => float(texel.w.equal(LandClass.Water));
  return {
    surface,
    colour: mix(
      mix(colourOf(a), colourOf(b), blend.x),
      mix(colourOf(c), colourOf(d), blend.x),
      blend.y,
    ),
    water: mix(mix(isWater(a), isWater(b), blend.x), mix(isWater(c), isWater(d), blend.x), blend.y),
  };
}

export interface TerrainMaterialOptions {
  /** The coarser level around this one, blended into along the edge. */
  readonly parent: TerrainLevel | null;
  /** Width in metres of the band along the edge where this level follows its parent. */
  readonly blendBand: number;
  /** Steps of the shadow march toward the light; 0 disables terrain shadows. */
  readonly shadowSteps: number;
  /** Fade this level into the void near its edge (the outermost level only). */
  readonly fadeAtEdge: boolean;
}

export interface TerrainMaterial {
  readonly material: THREE.MeshBasicNodeMaterial;
  /**
   * Area of the finer level drawn on top, as (xMin, yMin, xMax, yMax), so
   * this level can step aside there. Zero-sized while no finer level is loaded.
   */
  readonly inner: THREE.Vector4;
  readonly innerBand: { value: number };
}

/** How far a position is inside a rectangle (negative outside), in metres. */
function insideDistance(xy: V2, rect: V4): F {
  return min(min(xy.x.sub(rect.x), rect.z.sub(xy.x)), min(xy.y.sub(rect.y), rect.w.sub(xy.y)));
}

/**
 * The terrain material for one level.
 *
 * Vertex stage: a flat grid is placed over the level and lifted to the
 * terrain height. Fragment stage: slope, colour, light, shadow, water and
 * haze are all computed per pixel from the texel texture, so the picture
 * stays detailed even when the mesh is coarse.
 */
export function createTerrainMaterial(
  level: TerrainLevel,
  palette: THREE.DataTexture,
  scene: SceneUniforms,
  mask: CountryMask | null,
  options: TerrainMaterialOptions,
): TerrainMaterial {
  const extent = uniform(level.extent);
  const inner = new THREE.Vector4(0, 0, 0, 0);
  const innerRect = uniform(inner);
  const innerBand = uniform(1);
  const blendBand = uniform(options.blendBand);

  // The unit plane spans -0.5..0.5; stretch it over the level.
  const unit = positionLocal.xy.add(0.5);
  const groundXY = vec2(mix(extent.x, extent.z, unit.x), mix(extent.y, extent.w, unit.y));

  /** 0 at this level's edge where it must follow its parent, 1 where it stands alone. */
  const ownWeight = (xy: V2): F =>
    options.parent === null
      ? float(1)
      : smoothstep(blendBand, blendBand.mul(2), insideDistance(xy, extent));

  // --- Vertex: lift the grid to the terrain ---------------------------------
  const vertexOwn = readLevel(level, groundXY, null).surface;
  const vertexHeight =
    options.parent === null
      ? vertexOwn.x
      : mix(readLevel(options.parent, groundXY, null).surface.x, vertexOwn.x, ownWeight(groundXY));
  const material = new THREE.MeshBasicNodeMaterial();
  material.positionNode = vec3(groundXY, vertexHeight.sub(curvatureDrop(groundXY, scene)));

  // --- Fragment --------------------------------------------------------------
  // Control flow (If, Loop, Discard) needs a function scope, so the whole stage is one Fn.
  const xy = varying(groundXY, "vGroundXY");
  material.colorNode = Fn(() => {
    const own = readLevel(level, xy, palette);
    const weight = ownWeight(xy).toVar("ownWeight");
    const surface = own.surface.toVar("surface");
    const albedo = own.colour.toVar("albedo");
    const water = own.water.toVar("water");

    if (options.parent !== null) {
      const parent = options.parent;
      If(weight.lessThan(0.999), () => {
        const coarse = readLevel(parent, xy, palette);
        surface.assign(mix(coarse.surface, surface, weight));
        albedo.assign(mix(coarse.colour, albedo, weight));
        water.assign(mix(coarse.water, water, weight));
      });
    }

    // Step aside where a finer level is drawn on top (it overlaps by half a band).
    If(insideDistance(xy, innerRect).greaterThan(innerBand.mul(0.5)), () => {
      Discard();
    });

    const height = surface.x;
    const relief = scene.reliefBoost;
    const normal = normalize(
      vec3(surface.y.mul(relief).negate(), surface.z.mul(relief).negate(), 1),
    );
    const light = scene.lightDirection;

    // Terrain shadow: walk from the pixel toward the light and see whether the land rises above the ray.
    const lit = float(1).toVar("lit");
    if (options.shadowSteps > 0) {
      const placement = uniform(level.placement);
      const size = uniform(level.size);
      const horizontal = normalize(light.xy);
      const rise = light.z.div(max(length(light.xy), 0.0001));
      const reach = placement.z.mul(1.5).toVar("reach");
      Loop(options.shadowSteps, () => {
        const p = xy.add(horizontal.mul(reach));
        const cell = ivec2(
          clamp(
            vec2(p.x.sub(placement.x).div(placement.z), placement.y.sub(p.y).div(placement.z)),
            vec2(0, 0),
            size.sub(1),
          ),
        );
        const ground = textureLoad(level.texture, cell).x;
        const ray = height.add(rise.mul(reach));
        // Soft edge: partly shadowed when the land only just clears the ray.
        const softness = reach.mul(0.06).add(2);
        lit.assign(min(lit, clamp(ray.sub(ground).div(softness).add(1), 0, 1)));
        reach.mulAssign(1.28);
      });
    }

    const diffuse = max(dot(normal, light), 0);
    const skyLight = normal.z.mul(0.4).add(0.6);
    // Valley floors a touch darker, high ground a touch lighter: the land reads as relief.
    const elevationTone = mix(float(0.84), float(1.1), smoothstep(1300, 2700, height));
    // Steep ground a little darker whichever way it faces, as on a shaded relief map,
    // so the hills keep their shape even when the sun is high.
    const steepness = length(surface.yz).mul(relief);
    const tone = elevationTone.mul(float(1).sub(smoothstep(0.04, 0.6, steepness).mul(0.42)));
    const landColour = albedo
      .mul(tone)
      .mul(scene.lightColour.mul(diffuse.mul(lit)).add(scene.ambientColour.mul(skyLight)));

    // Water: dark body, sky reflection that strengthens at grazing angles, and a sun glint.
    const curved = vec3(xy, height.sub(curvatureDrop(xy, scene)));
    const toCamera = normalize(cameraPosition.sub(curved));
    const up = vec3(0, 0, 1);
    const fresnel = pow(float(1).sub(max(dot(toCamera, up), 0)), 4)
      .mul(0.8)
      .add(0.02);
    const glint = pow(max(dot(reflect(toCamera.negate(), up), light), 0), 1400)
      .mul(lit)
      .mul(scene.glintStrength);
    const waterColour = mix(
      albedo.mul(scene.ambientColour.add(scene.lightColour.mul(0.3))),
      scene.skyHorizon,
      fresnel,
    ).add(scene.lightColour.mul(glint));
    const surfaceColour = mix(landColour, waterColour, smoothstep(0.35, 0.65, water));

    // Haze: grows with distance, and gathers in low ground.
    const distance = length(cameraPosition.sub(curved));
    const lowGround = exp(height.sub(1300).div(-900)).mul(0.5).add(0.5);
    const haze = float(1)
      .sub(exp(distance.mul(scene.hazeDensity).mul(lowGround).negate()))
      .mul(scene.hazeLimit);
    // Near haze has its own colour; the farthest land takes the colour of the horizon sky.
    const hazeTint = mix(scene.hazeColour, scene.skyHorizon, smoothstep(0.5, 0.95, haze));
    const hazed = mix(surfaceColour, hazeTint, haze);

    // Rwanda apart from its neighbours, when seen from high above: the surroundings are
    // dimmed and drained of colour, a pale line follows the border, and far land fades out.
    let focused: V3 = hazed;
    if (mask !== null) {
      const place = uniform(mask.placement);
      const uv = vec2(xy.x.sub(place.x).div(place.z), place.y.sub(xy.y).div(place.w));
      const stored = texture(mask.texture, clamp(uv, vec2(0, 0), vec2(1, 1))).x.mul(255);
      const distanceKm = stored.sub(mask.zero).div(mask.stepsPerKm);
      const outside = smoothstep(0, -14, distanceKm).mul(scene.countryFocus);
      const grey = vec3(dot(hazed, vec3(0.2126, 0.7152, 0.0722)));
      const dimmed = mix(hazed, grey, 0.7).mul(0.5);
      const line = float(1)
        .sub(smoothstep(scene.borderWidthKm.mul(0.4), scene.borderWidthKm, distanceKm.abs()))
        .mul(scene.countryFocus);
      const withLine = mix(mix(hazed, dimmed, outside), vec3(0.86, 0.84, 0.74), line.mul(0.42));
      const gone = smoothstep(-9, -24, distanceKm).mul(scene.countryFocus);
      focused = mix(withLine, scene.voidColour, gone);
    }

    let finalColour: V3 = focused;
    if (options.fadeAtEdge) {
      const edge = smoothstep(0, 30_000, insideDistance(xy, extent));
      finalColour = mix(scene.voidColour, focused, mix(float(1), edge, scene.edgeFade));
    }
    return vec4(finalColour, 1);
  })();

  return { material, inner, innerBand };
}
