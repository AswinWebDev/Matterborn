// World restoration shader. Every world material belongs to a category (stone, wood, glass,
// life). Until Loam restores a category, its surfaces render as dull faded clay. Restoring
// sends a glowing wave outward from a point, bringing colour and the real material back.

import * as THREE from 'three';

export type FadeCategory = 'stone' | 'wood' | 'glass' | 'life' | 'none';

export interface FadeUniforms {
  uFade: { value: number }; // 1 = clay, 0 = fully restored everywhere
  uOrigin: { value: THREE.Vector3 };
  uRadius: { value: number }; // restoration wave radius in metres
  uRim: { value: number }; // glow strength of the wave front
  uRimColor: { value: THREE.Color };
}

const CLAY = new THREE.Color(0x9a918a);

const categories: Record<Exclude<FadeCategory, 'none'>, FadeUniforms> = {
  stone: mk(0xffc27a),
  wood: mk(0xffb067),
  glass: mk(0x8ff3ff),
  life: mk(0xc6ff9a),
};

function mk(rim: number): FadeUniforms {
  return {
    uFade: { value: 1 },
    uOrigin: { value: new THREE.Vector3() },
    uRadius: { value: 0 },
    uRim: { value: 0 },
    uRimColor: { value: new THREE.Color(rim) },
  };
}

export function fadeUniforms(c: Exclude<FadeCategory, 'none'>) {
  return categories[c];
}

/** Clock for restoration waves; the game points it at game time so pause and capture stay in sync. */
export const fxClock = { now: () => performance.now() / 1000 };
interface Wave {
  u: (typeof categories)[keyof typeof categories];
  start: number;
  dur: number;
  max: number;
  resolve: () => void;
}
const waves: Wave[] = [];

/** Start a restoration wave for a category from a world position (advanced by updateRestoreWaves). */
export function restore(c: Exclude<FadeCategory, 'none'>, origin: THREE.Vector3, durationSec = 4, maxRadius = 140) {
  const u = categories[c];
  u.uOrigin.value.copy(origin);
  u.uRadius.value = 0;
  u.uRim.value = 2.2;
  for (let i = waves.length - 1; i >= 0; i--)
    if (waves[i].u === u) {
      waves[i].resolve();
      waves.splice(i, 1);
    }
  return new Promise<void>((resolve) => waves.push({ u, start: fxClock.now(), dur: Math.max(0.001, durationSec), max: maxRadius, resolve }));
}

/** Advance running restoration waves; call once per rendered frame. */
export function updateRestoreWaves() {
  const now = fxClock.now();
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    const k = Math.min(1, Math.max(0, (now - w.start) / w.dur));
    const e = k * k * (3 - 2 * k);
    w.u.uRadius.value = e * w.max;
    w.u.uRim.value = 2.2 * (1 - k * 0.6);
    if (k >= 1) {
      w.u.uFade.value = 0;
      w.u.uRim.value = 0;
      waves.splice(i, 1);
      w.resolve();
    }
  }
}

export function setRestored(c: Exclude<FadeCategory, 'none'>, restored: boolean) {
  const u = categories[c];
  u.uFade.value = restored ? 0 : 1;
  u.uRadius.value = restored ? 1e5 : 0;
  u.uRim.value = 0;
}

const patched = new WeakSet<THREE.Material>();

/** Inject the clay-fade logic into a MeshStandard/Physical material. */
export function applyFade<T extends THREE.Material>(mat: T, c: FadeCategory): T {
  if (c === 'none' || patched.has(mat)) return mat;
  const u = categories[c];
  patched.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, u, { uClay: { value: CLAY } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fadeW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fadeW = instanceMatrix * fadeW;
        #endif
        vFadeWorld = (modelMatrix * fadeW).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFadeWorld;
        uniform float uFade; uniform vec3 uOrigin; uniform float uRadius; uniform float uRim; uniform vec3 uRimColor; uniform vec3 uClay;
        float fadeAmount() {
          float d = distance(vFadeWorld, uOrigin);
          float restored = 1.0 - smoothstep(uRadius - 3.0, uRadius, d);
          return uFade * 0.72 * (1.0 - restored);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float fadeK = fadeAmount();
        float lumF = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 clayCol = uClay * lumF * 1.45;
        diffuseColor.rgb = mix(diffuseColor.rgb, clayCol, fadeK);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.92, fadeK);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.0, fadeK);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= (1.0 - fadeK * 0.85);
        float dW = distance(vFadeWorld, uOrigin);
        float rim = smoothstep(uRadius - 2.2, uRadius - 0.4, dW) * (1.0 - smoothstep(uRadius - 0.4, uRadius + 0.6, dW));
        totalEmissiveRadiance += uRimColor * rim * uRim;`,
      );
  };
  // Make sure three compiles a distinct program for patched materials.
  const key = `fade-${c}`;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key;
  mat.needsUpdate = true;
  return mat;
}

/** Patch every mesh material under an object. */
export function applyFadeDeep(obj: THREE.Object3D, c: FadeCategory) {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach((mm) => applyFade(mm, c));
    else applyFade(m, c);
  });
}
