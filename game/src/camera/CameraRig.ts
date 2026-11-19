// Guided third-person camera. Each area of the level authors its yaw/pitch/distance so every
// shot stays composed; there is no free look (no mouse or right-stick orbit), so the player
// only ever sees the level from the angles it was dressed for. The camera pulls in when
// geometry would block the view, shakes on impacts, and blends into cutscene poses.

import * as THREE from 'three';
import { simplex3 } from '../render/noise';
import type { World3D } from '../physics/World3D';

export interface CameraZone {
  x0: number;
  x1: number;
  z0?: number;
  z1?: number;
  y0?: number;
  y1?: number;
  yaw?: number; // radians: 0 = camera on +Z looking toward -Z
  pitch?: number; // radians above the horizon (positive looks down)
  distance?: number;
  fov?: number;
  height?: number; // focus height above the player's feet
  lookAhead?: number;
}

const DEFAULT = { yaw: 0, pitch: 0.55, distance: 12.5, fov: 46, height: 1.3, lookAhead: 1.6 };

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  focus = new THREE.Vector3();
  zones: CameraZone[] = [];
  world: World3D | null = null;
  private cur = { ...DEFAULT };
  private userYaw = 0;
  private userPitch = 0;
  private idleOrbit = 0;
  private ahead = new THREE.Vector3();
  private trauma = 0;
  private time = 0;
  /** Effective yaw used for camera-relative input. */
  yaw = 0;
  cinematic = 0;
  private cinTarget = 0;
  cinPos = new THREE.Vector3();
  cinLook = new THREE.Vector3();
  cinFov = 40;
  roll = 0;
  private dist = DEFAULT.distance;

  constructor(aspect: number, _dom?: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 900);
    this.camera.position.set(0, 5, 12);
  }

  orbit(dYaw: number, dPitch: number) {
    this.userYaw = THREE.MathUtils.clamp(this.userYaw + dYaw, -1.2, 1.2);
    this.userPitch = THREE.MathUtils.clamp(this.userPitch + dPitch, -0.25, 0.45);
    this.idleOrbit = 0;
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  setCinematic(on: boolean) {
    this.cinTarget = on ? 1 : 0;
  }

  private zoneAt(x: number, y: number, z: number) {
    for (const zn of this.zones) {
      if (x < zn.x0 || x > zn.x1) continue;
      if (zn.z0 !== undefined && z < zn.z0) continue;
      if (zn.z1 !== undefined && z > zn.z1) continue;
      if (zn.y0 !== undefined && y < zn.y0) continue;
      if (zn.y1 !== undefined && y > zn.y1) continue;
      return zn;
    }
    return null;
  }

  snap(x: number, y: number, z: number) {
    this.focus.set(x, y + this.cur.height, z);
    this.ahead.set(0, 0, 0);
    this.update(0, x, y, z, 0, 0, 0, true);
  }

  update(dt: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, instant = false) {
    this.time += dt;
    const zone = this.zoneAt(px, py, pz);
    const want = { ...DEFAULT, ...(zone ?? {}) };
    const k = instant ? 1 : 1 - Math.exp(-dt * 1.8);
    this.cur.yaw = lerpAngle(this.cur.yaw, want.yaw, k);
    this.cur.pitch += (want.pitch - this.cur.pitch) * k;
    this.cur.distance += (want.distance - this.cur.distance) * k;
    this.cur.fov += (want.fov - this.cur.fov) * k;
    this.cur.height += (want.height - this.cur.height) * k;
    this.cur.lookAhead += (want.lookAhead - this.cur.lookAhead) * k;

    // ease the manual orbit back to the authored angle after a while
    this.idleOrbit += dt;
    if (this.idleOrbit > 2.5 && Math.hypot(vx, vz) > 1) {
      this.userYaw *= Math.exp(-dt * 0.8);
      this.userPitch *= Math.exp(-dt * 0.8);
    }

    // look ahead along the player's velocity
    const sp = Math.hypot(vx, vz);
    const ax = sp > 0.5 ? (vx / sp) * this.cur.lookAhead * Math.min(1, sp / 6) : 0;
    const az = sp > 0.5 ? (vz / sp) * this.cur.lookAhead * Math.min(1, sp / 6) : 0;
    const ka = instant ? 1 : 1 - Math.exp(-dt * 2.2);
    this.ahead.x += (ax - this.ahead.x) * ka;
    this.ahead.z += (az - this.ahead.z) * ka;

    // frame Loam a little above the centre of the screen: more of the ground between Loam and the
    // camera (the near, southern side) stays in view instead of falling off the bottom of the frame
    const bias = 1.4;
    const fx = px + this.ahead.x + Math.sin(this.cur.yaw) * bias;
    const fz = pz + this.ahead.z + Math.cos(this.cur.yaw) * bias;
    const fy = py + this.cur.height + THREE.MathUtils.clamp(vy * 0.04, -1.0, 0.4);
    const kxz = instant ? 1 : 1 - Math.exp(-dt * 6);
    const ky = instant ? 1 : 1 - Math.exp(-dt * (vy < -12 ? 7 : 3.5));
    this.focus.x += (fx - this.focus.x) * kxz;
    this.focus.z += (fz - this.focus.z) * kxz;
    this.focus.y += (fy - this.focus.y) * ky;

    const yaw = this.cur.yaw + this.userYaw;
    const pitch = THREE.MathUtils.clamp(this.cur.pitch + this.userPitch, 0.05, 1.2);
    this.yaw = yaw;
    const dirX = Math.sin(yaw) * Math.cos(pitch);
    const dirY = Math.sin(pitch);
    const dirZ = Math.cos(yaw) * Math.cos(pitch);

    // pull in if level geometry blocks the line of sight
    let dist = this.cur.distance;
    if (this.world) {
      const hit = this.world.raycast(this.focus.x, this.focus.y, this.focus.z, dirX, dirY, dirZ, dist, 'camera');
      if (hit) dist = Math.max(2.5, hit.dist - 0.6);
    }
    this.dist += (dist - this.dist) * (instant || dist < this.dist ? 1 : 1 - Math.exp(-dt * 2));
    const followPos = new THREE.Vector3(this.focus.x + dirX * this.dist, this.focus.y + dirY * this.dist, this.focus.z + dirZ * this.dist);
    const followLook = this.focus.clone();

    this.cinematic += (this.cinTarget - this.cinematic) * (instant ? 1 : 1 - Math.exp(-dt * 2.6));
    const c = this.cinematic;
    const cam = this.camera;
    cam.position.lerpVectors(followPos, this.cinPos, c);
    const look = new THREE.Vector3().lerpVectors(followLook, this.cinLook, c);
    cam.fov = THREE.MathUtils.lerp(this.cur.fov, this.cinFov, c);

    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.time * 22;
      cam.position.x += simplex3(t, 0, 1) * 0.5 * s;
      cam.position.y += simplex3(0, t, 2) * 0.4 * s;
      cam.position.z += simplex3(2, 1, t) * 0.3 * s;
    }
    cam.lookAt(look);
    if (this.roll || s > 0) cam.rotateZ(this.roll + (s > 0 ? simplex3(0, 4, this.time * 18) * 0.03 * s : 0));
    cam.updateProjectionMatrix();
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
