// Point-light budget. three.js shades every lit pixel against every point light in the scene, so
// 30+ level lights made each fragment loop through all of them. Level code now creates VLights
// (cheap placeholders with the PointLight fields it uses) and a fixed pool of real PointLights
// follows the most relevant ones each frame. The real light count never changes, so no shader is
// ever recompiled when lights come and go, and lights fade in and out instead of popping.

import * as THREE from 'three';

const registry = new Set<VLight>();

/** A light the level can have any number of; only the most relevant ones are rendered. */
export class VLight extends THREE.Object3D {
  readonly isVLight = true;
  color: THREE.Color;
  intensity: number;
  distance: number;
  decay: number;
  /** Lights that matter more (story beats, the hero) win ties. */
  priority = 1;
  constructor(color: THREE.ColorRepresentation = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super();
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    registry.add(this);
  }
  dispose() {
    registry.delete(this);
  }
}

interface Slot {
  light: THREE.PointLight;
  src: VLight | null;
  fade: number;
}

const tmp = new THREE.Vector3();
const sphere = new THREE.Sphere();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

/** Is the light attached to the scene and visible all the way up? */
function live(o: THREE.Object3D) {
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    if ((n as THREE.Scene).isScene) return true;
    n = n.parent;
  }
  return false;
}

export class LightPool {
  /** Global brightness of level lights (lanterns, fires, crystals) relative to their authored values. */
  static gain = 2.6;
  private slots: Slot[] = [];
  /** Number of VLights considered last frame (debug). */
  candidates = 0;

  constructor(scene: THREE.Scene, readonly size = 8) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      light.castShadow = false;
      light.name = `pool${i}`;
      scene.add(light);
      this.slots.push({ light, src: null, fade: 0 });
    }
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const scored: { v: VLight; score: number }[] = [];
    for (const v of registry) {
      if (v.intensity <= 0.01 || !live(v)) continue;
      v.updateWorldMatrix(true, false);
      tmp.setFromMatrixPosition(v.matrixWorld);
      const range = v.distance > 0 ? v.distance : 25;
      const d = tmp.distanceTo(focus);
      if (d > range + 30) continue;
      const seen = frustum.intersectsSphere(sphere.set(tmp, range));
      const k = d / (range + 6);
      const score = (v.intensity * v.priority * (seen ? 1 : 0.12)) / (1 + k * k * 6);
      scored.push({ v, score });
    }
    this.candidates = scored.length;
    scored.sort((a, b) => b.score - a.score);
    const want = new Set(scored.slice(0, this.size).map((s) => s.v));
    // lights just outside the top N keep their slot (hysteresis against flicker)
    const keep = new Set(scored.slice(0, this.size + 2).map((s) => s.v));
    const held = new Set<VLight>();
    for (const s of this.slots) {
      if (s.src && keep.has(s.src)) {
        held.add(s.src);
        s.fade = Math.min(1, s.fade + dt * 4);
      } else if (s.src) {
        // fading out; fast when a more important light is waiting
        s.fade = Math.max(0, s.fade - dt * 6);
        if (s.fade <= 0) s.src = null;
      }
    }
    for (const v of want) {
      if (held.has(v)) continue;
      const free = this.slots.find((s) => !s.src);
      if (!free) break;
      free.src = v;
      free.fade = 0;
      held.add(v);
    }
    for (const s of this.slots) {
      const l = s.light;
      if (!s.src) {
        l.intensity = 0;
        continue;
      }
      const v = s.src;
      l.position.setFromMatrixPosition(v.matrixWorld);
      l.color.copy(v.color);
      l.intensity = v.intensity * s.fade * s.fade * LightPool.gain;
      l.distance = v.distance;
      l.decay = v.decay;
    }
  }
}
