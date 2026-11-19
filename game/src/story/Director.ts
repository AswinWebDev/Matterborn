// Cutscene runner. Scripts are plain async functions that await game-time waits and tweens,
// so pausing the game pauses cutscenes, and holding "skip" fast-forwards a script to its end
// state (every wait/tween resolves instantly) instead of leaving the world half-configured.

import * as THREE from 'three';
import { CameraRig } from '../camera/CameraRig';

interface Pending {
  until: number;
  resolve: () => void;
}
interface Tween {
  start: number;
  dur: number;
  fn: (k: number) => void;
  resolve: () => void;
}

export type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  sine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export class Director {
  time = 0;
  running = false;
  skipping = false;
  private waits: Pending[] = [];
  private tweens: Tween[] = [];
  private skipHold = 0;
  onSkipProgress: (k: number) => void = () => {};
  /** Called the moment a skip begins, before the script fast-forwards. */
  onSkip: () => void = () => {};

  constructor(public rig: CameraRig) {}

  update(dt: number, skipHeld: boolean) {
    this.time += dt;
    if (this.running && !this.skipping) {
      this.skipHold = skipHeld ? this.skipHold + dt : Math.max(0, this.skipHold - dt * 2);
      this.onSkipProgress(Math.min(1, this.skipHold / 0.8));
      if (this.skipHold >= 0.8) {
        this.skipping = true;
        this.onSkip();
        this.flush();
      }
    } else this.onSkipProgress(0);
    for (const tw of [...this.tweens]) {
      const k = Math.min(1, (this.time - tw.start) / tw.dur);
      tw.fn(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.resolve();
      }
    }
    for (const w of [...this.waits]) {
      if (this.time >= w.until) {
        this.waits.splice(this.waits.indexOf(w), 1);
        w.resolve();
      }
    }
  }

  /** Fast-forward the running script to its end state. */
  skip() {
    if (!this.running) return;
    this.skipping = true;
    this.onSkip();
    this.flush();
  }

  private flush() {
    for (const tw of this.tweens) {
      tw.fn(1);
      tw.resolve();
    }
    this.tweens = [];
    for (const w of this.waits) w.resolve();
    this.waits = [];
  }

  wait(sec: number): Promise<void> {
    if (this.skipping || sec <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waits.push({ until: this.time + sec, resolve }));
  }

  tween(dur: number, fn: (k: number) => void, e: Ease = ease.inOut): Promise<void> {
    if (this.skipping || dur <= 0) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => this.tweens.push({ start: this.time, dur, fn: (k) => fn(e(k)), resolve }));
  }

  /** Move the cinematic camera to a pose over `dur` seconds. */
  camTo(pos: THREE.Vector3Like, look: THREE.Vector3Like, fov: number, dur: number, e: Ease = ease.inOut) {
    const r = this.rig;
    const p0 = r.cinPos.clone();
    const l0 = r.cinLook.clone();
    const f0 = r.cinFov;
    const p1 = new THREE.Vector3(pos.x, pos.y, pos.z);
    const l1 = new THREE.Vector3(look.x, look.y, look.z);
    return this.tween(
      dur,
      (k) => {
        r.cinPos.lerpVectors(p0, p1, k);
        r.cinLook.lerpVectors(l0, l1, k);
        r.cinFov = f0 + (fov - f0) * k;
      },
      e,
    );
  }

  /** Put the cinematic camera exactly where the follow camera currently is. */
  syncFromCamera() {
    const cam = this.rig.camera;
    this.rig.cinPos.copy(cam.position);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this.rig.cinLook.copy(cam.position).addScaledVector(dir, 15);
    this.rig.cinFov = cam.fov;
  }

  async run(script: () => Promise<void>) {
    this.running = true;
    this.skipping = false;
    this.skipHold = 0;
    try {
      await script();
    } finally {
      this.running = false;
      this.skipping = false;
      this.onSkipProgress(0);
    }
  }
}
