import {
  attribute,
  clamp,
  cos,
  dot,
  Fn,
  float,
  fract,
  max,
  mix,
  normalGeometry,
  positionGeometry,
  sin,
  smoothstep,
  step,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { hexToLinear } from "../terrain/palette";
import { applyHaze, curvatureDrop, type SceneUniforms } from "../terrain/terrainMaterial";
import { HEIGHT_RANGE, yearWeights } from "./instances";

/** Roof and wall tones: weathered tin, clay tile, pale concrete. sRGB hex. */
const ROOF_TONES = [0xb4b7b1, 0x9a5846, 0xd4cdbc] as const;
/** The warm tint of a building in its first year: dusk light, from the site palette. */
const NEW_TINT = 0xf0a64a;

/** Uniforms that follow the year slider. */
export class YearUniforms {
  /** Weights of the first four and last four yearly heights (see `yearWeights`). */
  readonly weightsA = uniform(new THREE.Vector4(1, 0, 0, 0));
  readonly weightsB = uniform(new THREE.Vector4(0, 0, 0, 0));
  /** The moment shown, as a year index: 0 is the first year of the record, 7 the last. */
  readonly yearIndex = uniform(0);

  set(yearIndex: number): void {
    const weights = yearWeights(yearIndex);
    this.weightsA.value.set(
      weights[0] as number,
      weights[1] as number,
      weights[2] as number,
      weights[3] as number,
    );
    this.weightsB.value.set(
      weights[4] as number,
      weights[5] as number,
      weights[6] as number,
      weights[7] as number,
    );
    this.yearIndex.value = Math.min(Math.max(yearIndex, 0), 7);
  }
}

/**
 * The material for building boxes. Every building is the same unit box
 * (1 x 1 footprint, height 0 to 1); the vertex stage stretches, turns and
 * places it from the per-building attributes, and sets its height from the
 * year. A building that does not exist yet has no height and no footprint.
 */
export function createBuildingMaterial(
  scene: SceneUniforms,
  year: YearUniforms,
): THREE.MeshBasicNodeMaterial {
  const place = attribute("aPlace", "vec4"); // x, y, base z, sink
  const shape = attribute("aShape", "vec4"); // long side, short side, angle, first-year index
  const heightsA = attribute("aHeightsA", "vec4");
  const heightsB = attribute("aHeightsB", "vec4");

  const height = dot(heightsA, year.weightsA).add(dot(heightsB, year.weightsB)).mul(HEIGHT_RANGE);
  // Below a hand's height there is no building: collapse the box to a point underground.
  const exists = step(0.15, height);
  const turnCos = cos(shape.z);
  const turnSin = sin(shape.z);
  const along = positionGeometry.x.mul(shape.x).mul(exists);
  const across = positionGeometry.y.mul(shape.y).mul(exists);
  const groundXY = vec2(
    place.x.add(along.mul(turnCos)).sub(across.mul(turnSin)),
    place.y.add(along.mul(turnSin)).add(across.mul(turnCos)),
  );
  const top = positionGeometry.z.mul(height.add(place.w)).mul(exists);
  const trueHeight = place.z.add(top);
  const drawn = vec3(groundXY, trueHeight.sub(curvatureDrop(groundXY, scene)));

  // `positionGeometry` is the unit box as stored. (`positionLocal` would be the placed
  // position once `positionNode` is set, which is not what the shading below needs.)
  const material = new THREE.MeshBasicNodeMaterial();
  material.positionNode = drawn;

  const worldNormal = varying(
    vec3(
      normalGeometry.x.mul(turnCos).sub(normalGeometry.y.mul(turnSin)),
      normalGeometry.x.mul(turnSin).add(normalGeometry.y.mul(turnCos)),
      normalGeometry.z,
    ),
    "vBuildingNormal",
  );
  const upWall = varying(positionGeometry.z, "vUpWall");
  const drawnPosition = varying(drawn, "vBuildingPosition");
  const heightAboveSea = varying(trueHeight, "vBuildingHeight");
  // A steady pseudo-random number per building, from where it stands.
  const chance = varying(
    fract(sin(dot(place.xy, vec2(12.9898, 78.233))).mul(43758.5453)),
    "vBuildingChance",
  );
  // 1 in a building's first year, fading to 0 a year and a half later; never for buildings
  // that were already there when the record starts.
  const fresh = varying(
    float(1)
      .sub(clamp(year.yearIndex.sub(shape.w).div(1.5), 0, 1))
      .mul(step(0.5, shape.w)),
    "vBuildingFresh",
  );

  material.colorNode = Fn(() => {
    const tin = vec3(...hexToLinear(ROOF_TONES[0]));
    const tile = vec3(...hexToLinear(ROOF_TONES[1]));
    const concrete = vec3(...hexToLinear(ROOF_TONES[2]));
    // About half tin, a third tile or red paint, the rest pale concrete.
    const tone = mix(mix(tin, tile, smoothstep(0.5, 0.58, chance)), concrete, step(0.86, chance));
    const albedo = mix(tone, vec3(...hexToLinear(NEW_TINT)), fresh.mul(0.8));

    const normal = worldNormal.normalize();
    const diffuse = max(dot(normal, scene.lightDirection), 0);
    const skyLight = normal.z.mul(0.45).add(0.55);
    // Walls darken toward the ground, where neighbours and the slope block the sky.
    const contact = mix(float(0.62), float(1), max(upWall, normal.z));
    const lit = albedo
      .mul(scene.lightColour.mul(diffuse).add(scene.ambientColour.mul(skyLight)))
      .mul(contact)
      // New buildings carry a little light of their own, so growth reads even in shade.
      .add(vec3(...hexToLinear(NEW_TINT)).mul(fresh.mul(0.4)));
    return vec4(applyHaze(lit, drawnPosition, heightAboveSea, scene), 1);
  })();

  return material;
}
