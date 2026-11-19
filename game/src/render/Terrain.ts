// Organic rock platforms built around the rectangular colliders. The walkable top stays
// within a few centimetres of the collider so landings look honest; sides and the front
// edge get noisy, chunky displacement so nothing reads as a box.

import * as THREE from 'three';
import { fbm3, simplex3 } from './noise';
import { applyFade, FadeCategory, fadeUniforms } from './MaterialFX';

/**
 * Surface detail for the level rock, layered on the standard PBR shader:
 *   - a second, larger-scale sample of the same texture blended by noise so tiling never reads
 *   - broad colour variation and darker crevices
 *   - moss on upward faces that only grows back once living things are restored (the "life"
 *     restoration wave), so the world visibly comes alive as Loam progresses
 * Normals get bump detail from the texture's luminance (three's bumpMap).
 */
function addTerrainDetail(mat: THREE.MeshStandardMaterial) {
  const life = fadeUniforms('life');
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, {
      uLifeFade: life.uFade,
      uLifeOrigin: life.uOrigin,
      uLifeRadius: life.uRadius,
      uMoss: { value: new THREE.Color(0x3f5a22) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrW;\nvarying vec3 vTerrN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTerrW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrW;
        varying vec3 vTerrN;
        uniform float uLifeFade; uniform vec3 uLifeOrigin; uniform float uLifeRadius; uniform vec3 uMoss;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float tFbm(vec2 p) { return tNoise(p) * 0.55 + tNoise(p * 2.13 + 7.1) * 0.3 + tNoise(p * 4.7 - 3.3) * 0.15; }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        #ifdef USE_MAP
          // a second, larger and rotated sample of the texture breaks up visible tiling
          vec2 tUv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.31 + vec2(0.37, 0.71);
          vec3 tMacro = texture2D(map, tUv2).rgb;
          float tMix = smoothstep(0.35, 0.75, tFbm(vTerrW.xz * 0.11 + vTerrW.y * 0.05));
          vec3 tBase = texture2D(map, vMapUv).rgb;
          diffuseColor.rgb *= mix(vec3(1.0), clamp(tMacro / max(tBase, vec3(0.04)), 0.4, 2.5), tMix * 0.5);
        #endif
        float tVar = tFbm(vTerrW.xz * 0.045 + vec2(vTerrW.y * 0.03));
        diffuseColor.rgb *= mix(0.78, 1.14, tVar);
        // moss creeps over upward faces once life is restored
        float tUp = smoothstep(0.55, 0.92, normalize(vTerrN).y);
        float tPatch = smoothstep(0.5, 0.74, tFbm(vTerrW.xz * 0.19 + 3.0)) * smoothstep(0.25, 0.6, tFbm(vTerrW.xz * 0.05 - 11.0));
        float tLifeD = distance(vTerrW, uLifeOrigin);
        float tAlive = (1.0 - uLifeFade) + uLifeFade * (1.0 - smoothstep(uLifeRadius - 3.0, uLifeRadius, tLifeD));
        float tMossK = tUp * tPatch * tAlive * 0.7;
        float tLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float tMossVar = tNoise(vTerrW.xz * 1.9) * 0.5 + tNoise(vTerrW.xz * 5.3) * 0.5;
        diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.45 + tLum * 0.9) * mix(0.6, 1.35, tMossVar), tMossK);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.97, tMossK);`,
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + 'terrain';
  mat.needsUpdate = true;
}

export interface RockOptions {
  zFront?: number; // how far the block extends toward the camera
  zBack?: number; // how far it extends into the background
  seed?: number;
  moss?: boolean;
  texScale?: number;
  roughTop?: number;
  material?: THREE.Material;
  /** Walls: lighter with height instead of dark below the top lip. */
  wall?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

export function rockMaterial(albedo: THREE.Texture, category: FadeCategory = 'stone', key = 'rock') {
  const k = `${key}:${category}:${albedo.uuid}`;
  let m = cache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: albedo, bumpMap: albedo, bumpScale: 2.2, vertexColors: true, roughness: 0.9, metalness: 0 });
    addTerrainDetail(m);
    applyFade(m, category);
    cache.set(k, m);
  }
  return m;
}

export function makeRock(x: number, y: number, w: number, h: number, mat: THREE.Material, opts: RockOptions = {}) {
  const zFront = opts.zFront ?? 1.25;
  const zBack = opts.zBack ?? 2.8;
  const depth = zFront + zBack;
  const seed = opts.seed ?? x * 0.37 + y * 1.7;
  const texScale = opts.texScale ?? 0.35;
  const segW = Math.max(2, Math.min(64, Math.round(w * 2.2)));
  const segH = Math.max(2, Math.min(48, Math.round(h * 2.2)));
  const segD = Math.max(2, Math.min(48, Math.round(depth * 2)));
  const geo = new THREE.BoxGeometry(w, h, depth, segW, segH, segD);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const hw = w / 2;
  const hh = h / 2;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const wx = v.x + x + hw;
    const wy = v.y + y + hh;
    const wz = v.z + (zFront - zBack) / 2;
    // projected UVs by face direction (world space, so textures line up between blocks)
    if (Math.abs(n.y) > 0.5) uv.setXY(i, wx * texScale, wz * texScale);
    else if (Math.abs(n.x) > 0.5) uv.setXY(i, wz * texScale, wy * texScale);
    else uv.setXY(i, wx * texScale, wy * texScale);

    const isTop = v.y > hh - 1e-3;
    const nearTop = (v.y - (hh - 0.6)) / 0.6; // 0..1 within 0.6 m of the top
    const big = fbm3(wx * 0.35 + seed, wy * 0.35, wz * 0.35, 4);
    const fine = simplex3(wx * 1.7, wy * 1.7 + seed, wz * 1.7) * 0.5;
    let disp = big * 0.55 + fine * 0.18;
    if (isTop) {
      // keep the walking surface flat-ish, only lift the edges a touch
      const edge = Math.max(Math.abs(v.x) - (hw - 0.4), 0) + Math.max(Math.abs(v.z) - (depth / 2 - 0.6), 0);
      v.y += (opts.roughTop ?? 0.04) * fine - edge * 0.25;
    } else {
      const k = nearTop > 0 ? 1 - nearTop * 0.6 : 1;
      v.x += n.x * disp * k * 0.9;
      v.z += n.z * disp * k * 0.9 + (n.z > 0.5 ? disp * 0.4 : 0);
      if (n.y < -0.5) v.y += disp * 0.6;
      // bulge the sides outward a little in the middle for a chunky silhouette
      v.x += Math.sign(v.x) * Math.max(0, 0.18 * (1 - Math.abs(v.y / hh))) * (Math.abs(n.x) > 0.5 ? 1 : 0.3);
    }
    pos.setXYZ(i, v.x, v.y, v.z);

    // vertex colour: ambient occlusion toward the bottom, moss on top faces
    // lit lip along the walkable top, mass below sinks into shadow (silhouette look)
    const below = hh - v.y; // metres below the top surface
    const ao = opts.wall
      ? THREE.MathUtils.clamp(0.45 + ((v.y + hh) / Math.max(h, 0.5)) * 0.75, 0.42, 1.08)
      : THREE.MathUtils.clamp(1.06 - below * 0.13, 0.38, 1.06);
    let r = ao;
    let gg = ao;
    let b = ao;
    if (opts.moss !== false && (isTop || nearTop > 0.75) && n.y > -0.2) {
      const m = THREE.MathUtils.clamp(0.55 + simplex3(wx * 0.8, wz * 0.8, seed) * 0.7, 0, 1);
      r *= 1 - m * 0.45;
      gg *= 1 + m * 0.18;
      b *= 1 - m * 0.55;
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = gg;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x + hw, y + hh, (zFront - zBack) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A thin wooden plank platform (one-way) made of a few slightly uneven boards. */
export function makePlanks(x: number, y: number, w: number, mat: THREE.Material, seed = 1) {
  const g = new THREE.Group();
  const boards = Math.max(2, Math.round(w / 0.9));
  const bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const geo = new THREE.BoxGeometry(bw * 0.94, 0.16, 1.6, 2, 1, 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + bw * (i + 0.5), y - 0.08 + Math.sin(i * 7.1 + seed) * 0.015, 0.1);
    m.rotation.z = Math.sin(i * 3.7 + seed) * 0.02;
    m.rotation.y = Math.sin(i * 5.3 + seed) * 0.04;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  // two support beams underneath
  for (const s of [-0.55, 0.55]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.14), mat);
    beam.position.set(x + w / 2, y - 0.22, 0.1 + s);
    beam.castShadow = true;
    g.add(beam);
  }
  return g;
}


/** Rock box spanning world-space corners (x0,y0,z0)-(x1,y1,z1). */
export function makeRockBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material, opts: RockOptions = {}) {
  return makeRock(x0, y0, x1 - x0, y1 - y0, mat, { ...opts, zFront: z1, zBack: -z0 });
}
