// Loads the processed Lux3D models from public/assets. Missing files resolve to null so the
// game can always fall back to procedural stand-ins and never hard-fails during judging.

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

const gltfCache = new Map<string, Promise<GLTF | null>>();
const texCache = new Map<string, Promise<THREE.Texture | null>>();

// `?assets=<folder>` points the game at another asset folder under public/ (used to test the
// post-process output); only plain folder names are accepted.
function assetFolder() {
  try {
    const q = new URLSearchParams(location.search).get('assets');
    if (q && /^[a-z0-9_-]+$/i.test(q)) return q;
  } catch {
    // no location (tests): default folder
  }
  return 'assets';
}
export const BASE = `${import.meta.env.BASE_URL}${assetFolder()}/`;

export interface AssetManifest {
  models: Record<string, { file: string; height?: number; category?: string }>;
  anims?: Record<string, string>; // clip name -> file
  textures?: Record<string, string>;
  pano?: string;
  /** Aholo World Gaussian splat files (.spz) by world key. */
  splats?: Record<string, string>;
}

let manifest: AssetManifest = { models: {} };

export async function loadManifest() {
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (res.ok) manifest = await res.json();
  } catch {
    // no manifest yet: every model falls back to procedural geometry
  }
  return manifest;
}
export function getManifest() {
  return manifest;
}
export function hasModel(id: string) {
  return Boolean(manifest.models[id]);
}

export function loadGLTF(url: string): Promise<GLTF | null> {
  let p = gltfCache.get(url);
  if (!p) {
    p = loader.loadAsync(url).catch((err) => {
      console.warn('model failed to load', url, err);
      return null;
    });
    gltfCache.set(url, p);
  }
  return p;
}

/**
 * Wait until every model requested so far has loaded (or failed), reporting progress 0..1; gives up
 * after `timeoutMs` so a slow or broken network can never hold the game on the loading screen.
 */
export async function waitForLoads(onProgress?: (k: number) => void, timeoutMs = 15000) {
  const all = [...gltfCache.values()];
  if (!all.length) return;
  let done = 0;
  const each = all.map((p) => p.finally(() => onProgress?.(++done / all.length)));
  await Promise.race([Promise.all(each), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export async function loadModel(id: string): Promise<GLTF | null> {
  const entry = manifest.models[id];
  if (!entry) return null;
  return loadGLTF(BASE + entry.file);
}

export function loadTexture(url: string, srgb = true): Promise<THREE.Texture | null> {
  let p = texCache.get(url);
  if (!p) {
    p = texLoader
      .loadAsync(url)
      .then((t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      })
      .catch(() => null);
    texCache.set(url, p);
  }
  return p;
}

export async function loadNamedTexture(id: string, srgb = true) {
  const f = manifest.textures?.[id];
  return f ? loadTexture(BASE + f, srgb) : null;
}

/**
 * Clone a loaded model, normalise it so its bounding box sits on y=0, is centred in x/z and
 * has the requested height (metres). Returns a group you can position freely.
 */
export function instantiate(gltf: GLTF, height: number, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}) {
  const src = gltf.scene;
  const clone = SkeletonUtils.clone(src) as THREE.Object3D;
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const s = height / Math.max(size.y, 1e-3);
  const holder = new THREE.Group();
  clone.scale.multiplyScalar(s);
  const box2 = new THREE.Box3().setFromObject(clone);
  const c = box2.getCenter(new THREE.Vector3());
  clone.position.x -= c.x;
  clone.position.z -= c.z;
  clone.position.y -= box2.min.y;
  holder.add(clone);
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = opts.castShadow ?? true;
      m.receiveShadow = opts.receiveShadow ?? true;
    }
  });
  holder.userData.size = new THREE.Vector3(size.x * s, height, size.z * s);
  return holder;
}
