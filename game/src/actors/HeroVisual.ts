// Visual side of Loam. `ProceduralGolem` is a stand-in built from primitives with fully
// procedural animation; `RiggedHero` (rigged/RiggedHero.ts) swaps in the Lux3D model.

import * as THREE from 'three';
import type { Player, PlayerAnim, PlayerEvent } from './Player';
import { FORMS, Form } from './forms';
import { VLight } from '../render/LightPool';

export interface HeroVisual {
  readonly root: THREE.Object3D;
  setForm(form: Form, instant?: boolean): void;
  update(dt: number, p: Player): void;
  onEvent(e: PlayerEvent, p: Player): void;
  heartPosition(out: THREE.Vector3): THREE.Vector3;
  /** Override the pose for cutscenes ('lying', 'wake', 'sit', 'dance', 'cast'...). */
  forceAnim(a: PlayerAnim | null): void;
  /** Something worth looking at (world space); the rigged hero turns its head toward it. */
  lookAt?: THREE.Vector3 | null;
}

export function formMaterial(form: Form, mat: THREE.MeshPhysicalMaterial) {
  const s = FORMS[form];
  mat.color.setHex(s.color);
  mat.roughness = s.roughness;
  mat.metalness = s.metalness;
  mat.transmission = 0;
  mat.clearcoat = form === 'glass' ? 1 : form === 'wood' ? 0.15 : 0;
  mat.clearcoatRoughness = 0.1;
  mat.transparent = form === 'glass';
  mat.opacity = form === 'glass' ? 0.55 : 1;
  mat.depthWrite = form !== 'glass';
  addRim(mat, form === 'glass' ? 0x8ff0ff : s.emissive, form === 'glass' ? 0.9 : 0.3, form === 'glass' ? 1 : 0);
  mat.needsUpdate = true;
}

export interface RimUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uGlass: { value: number };
}

/**
 * Fresnel rim light: edges facing away from the camera glow in `color`, which lifts characters
 * off dark backgrounds (the luminous storybook look). With `glass` = 1 the surface also turns
 * more opaque at grazing angles, which is how thick glass reads; that replaces three's
 * transmission pass (it produced NaN frames in this pipeline).
 */
export function addRim<T extends THREE.MeshStandardMaterial>(mat: T, color: THREE.ColorRepresentation, strength: number, glass = 0): RimUniforms {
  const existing = mat.userData.rim as RimUniforms | undefined;
  if (existing) {
    existing.uRimColor.value.set(color);
    existing.uRimStrength.value = strength;
    existing.uGlass.value = glass;
    return existing;
  }
  const u: RimUniforms = { uRimColor: { value: new THREE.Color(color) }, uRimStrength: { value: strength }, uGlass: { value: glass } };
  mat.userData.rim = u;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength; uniform float uGlass;')
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), mix(2.6, 2.0, uGlass));
        outgoingLight += uRimColor * rimF * uRimStrength;
        diffuseColor.a = mix(diffuseColor.a, clamp(diffuseColor.a + rimF * 0.6, 0.0, 1.0), uGlass);
        #include <opaque_fragment>`,
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + 'rim';
  mat.needsUpdate = true;
  return u;
}

/** Glossy see-through glass shell (blocks, shards, the Glass form of the procedural golem). */
export function glassShell<T extends THREE.MeshStandardMaterial>(mat: T): T {
  addRim(mat, 0x8ff0ff, 0.9, 1);
  return mat;
}

/** Shared squash/stretch + facing + flip logic used by both hero visuals. */
export class Juice {
  scaleY = 1;
  private vel = 0;
  yaw = Math.PI / 2;
  flip = 0; // radians around z for the double-jump flip
  private flipping = false;
  lean = 0;

  kick(stretch: number) {
    this.vel += stretch;
  }
  startFlip() {
    this.flipping = true;
    this.flip = 0;
  }
  update(dt: number, p: Player) {
    // spring back to 1
    const k = 220;
    const d = 18;
    this.vel += (-(this.scaleY - 1) * k - this.vel * d) * dt;
    this.scaleY += this.vel * dt;
    // face the movement heading
    this.yaw = lerpAngle(this.yaw, p.heading, 1 - Math.exp(-dt * 18));
    // lean forward with speed
    const wantLean = p.grounded ? p.hspeed * 0.03 : p.hspeed * 0.015;
    this.lean += (THREE.MathUtils.clamp(wantLean, 0, 0.3) - this.lean) * (1 - Math.exp(-dt * 8));
    if (this.flipping) {
      this.flip += dt * 15;
      if (this.flip >= Math.PI * 2) {
        this.flip = 0;
        this.flipping = false;
      }
    }
  }
}

export class ProceduralGolem implements HeroVisual {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private heart: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private mat: THREE.MeshPhysicalMaterial;
  private glowMat: THREE.MeshStandardMaterial;
  private juice = new Juice();
  private phase = 0;
  private forced: PlayerAnim | null = null;
  private t = 0;
  private heartLight: VLight;

  constructor() {
    this.mat = new THREE.MeshPhysicalMaterial({ color: 0xc8714a, roughness: 0.85 });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xffa040, emissiveIntensity: 4 });
    const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 6, 14);
    this.torso = new THREE.Mesh(cap(0.27, 0.32), this.mat);
    this.torso.position.y = 0.62;
    this.torso.scale.set(1, 1, 0.82);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 18), this.mat);
    this.head.position.y = 1.08;
    this.head.scale.set(1.05, 0.95, 1);
    for (const sx of [-0.09, 0.09]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), this.glowMat);
      e.position.set(sx, 1.1, 0.22);
      e.scale.set(1, 1.3, 0.6);
      this.eyes.push(e);
      this.body.add(e);
    }
    this.heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), this.glowMat);
    this.heart.position.set(0, 0.7, 0.24);
    const mkLimb = (g: THREE.Group, x: number, y: number, r: number, l: number) => {
      g.position.set(x, y, 0);
      const m = new THREE.Mesh(cap(r, l), this.mat);
      m.position.y = -l / 2 - r * 0.6;
      m.castShadow = true;
      g.add(m);
      this.body.add(g);
    };
    mkLimb(this.armL, -0.36, 0.86, 0.085, 0.36);
    mkLimb(this.armR, 0.36, 0.86, 0.085, 0.36);
    mkLimb(this.legL, -0.14, 0.42, 0.1, 0.24);
    mkLimb(this.legR, 0.14, 0.42, 0.1, 0.24);
    this.torso.castShadow = this.head.castShadow = true;
    this.body.add(this.torso, this.head, this.heart);
    this.heartLight = new VLight(0xffa040, 2.5, 4.5, 2);
    this.heartLight.position.set(0, 0.75, 0.6);
    this.body.add(this.heartLight);
    this.root.add(this.body);
  }

  setForm(form: Form) {
    formMaterial(form, this.mat);
    const e = FORMS[form].emissive;
    this.glowMat.emissive.setHex(e);
    this.heartLight.color.setHex(e);
    this.juice.kick(-4);
  }

  forceAnim(a: PlayerAnim | null) {
    this.forced = a;
    this.t = 0;
  }

  heartPosition(out: THREE.Vector3) {
    return this.heart.getWorldPosition(out);
  }

  onEvent(e: PlayerEvent) {
    if (e === 'jump' || e === 'walljump') this.juice.kick(5);
    if (e === 'flip') {
      this.juice.kick(4);
      this.juice.startFlip();
    }
    if (e === 'land') this.juice.kick(-5);
    if (e === 'hardLand' || e === 'poundImpact') this.juice.kick(-9);
    if (e === 'dash') this.juice.kick(-3);
  }

  update(dt: number, p: Player) {
    this.t += dt;
    const j = this.juice;
    j.update(dt, p);
    const anim = this.forced ?? p.anim;
    const speed = Math.abs(p.body.vx);
    this.phase += dt * (2 + speed * 1.55);
    const s = Math.sin(this.phase * 2);
    const c = Math.cos(this.phase * 2);
    // reset pose
    this.armL.rotation.set(0, 0, 0.15);
    this.armR.rotation.set(0, 0, -0.15);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    let squashX = 1;
    switch (anim) {
      case 'run':
      case 'sprint':
      case 'walk':
      case 'wade': {
        const amp = anim === 'walk' || anim === 'wade' ? 0.55 : 0.85;
        this.legL.rotation.x = s * amp;
        this.legR.rotation.x = -s * amp;
        this.armL.rotation.x = -s * amp * 0.8;
        this.armR.rotation.x = s * amp * 0.8;
        this.body.position.y = Math.abs(c) * 0.06;
        this.body.rotation.x = 0.12;
        break;
      }
      case 'idle':
        this.body.position.y = Math.sin(this.t * 2.2) * 0.012;
        this.armL.rotation.z = 0.15 + Math.sin(this.t * 2.2) * 0.04;
        this.armR.rotation.z = -0.15 - Math.sin(this.t * 2.2) * 0.04;
        this.head.rotation.y = Math.sin(this.t * 0.6) * 0.15;
        break;
      case 'jump':
      case 'flip':
        this.legL.rotation.x = -0.9;
        this.legR.rotation.x = -0.3;
        this.armL.rotation.z = 1.4;
        this.armR.rotation.z = -1.4;
        break;
      case 'fall':
        this.legL.rotation.x = -0.25;
        this.legR.rotation.x = 0.2;
        this.armL.rotation.z = 2.0 + Math.sin(this.t * 12) * 0.1;
        this.armR.rotation.z = -2.0 - Math.sin(this.t * 12) * 0.1;
        break;
      case 'wall':
        this.armL.rotation.x = -2.6;
        this.armR.rotation.x = -2.3;
        this.legL.rotation.x = -0.6;
        break;
      case 'dash':
      case 'charge':
        this.body.rotation.x = 0.6;
        this.armL.rotation.x = 1.2;
        this.armR.rotation.x = 1.2;
        this.legL.rotation.x = 0.8;
        this.legR.rotation.x = -0.6;
        squashX = 1.25;
        break;
      case 'pound':
        this.legL.rotation.x = -1.4;
        this.legR.rotation.x = -1.4;
        this.armL.rotation.x = -1.2;
        this.armR.rotation.x = -1.2;
        break;
      case 'push':
        this.body.rotation.x = 0.35;
        this.armL.rotation.x = -1.4;
        this.armR.rotation.x = -1.4;
        this.legL.rotation.x = s * 0.4 - 0.3;
        this.legR.rotation.x = -s * 0.4 - 0.3;
        break;
      case 'swim':
      case 'swimIdle':
        this.body.rotation.x = anim === 'swim' ? 1.1 : 0.3;
        this.armL.rotation.x = -1.5 + Math.sin(this.t * 6) * 1.2;
        this.armR.rotation.x = -1.5 - Math.sin(this.t * 6) * 1.2;
        this.legL.rotation.x = Math.sin(this.t * 8) * 0.5;
        this.legR.rotation.x = -Math.sin(this.t * 8) * 0.5;
        break;
      case 'climb':
        this.armL.rotation.x = -2.8;
        this.armR.rotation.x = -2.8;
        this.legL.rotation.x = -1.0;
        break;
      case 'cast':
      case 'interact':
        this.armL.rotation.set(-1.3, 0, 0.6);
        this.armR.rotation.set(-1.3, 0, -0.6);
        this.body.position.y = 0.05 + Math.sin(this.t * 6) * 0.02;
        break;
      case 'lying':
        this.body.rotation.x = -Math.PI / 2;
        this.body.position.y = 0.25;
        break;
      case 'wake': {
        const k = Math.min(1, this.t / 2.2);
        this.body.rotation.x = -Math.PI / 2 * (1 - easeOutBack(k));
        this.body.position.y = 0.25 * (1 - k);
        break;
      }
      case 'sit':
        this.legL.rotation.x = -1.5;
        this.legR.rotation.x = -1.5;
        this.body.position.y = -0.4;
        break;
      case 'dance':
        this.body.rotation.z = Math.sin(this.t * 6) * 0.2;
        this.armL.rotation.z = 2 + Math.sin(this.t * 6) * 0.5;
        this.armR.rotation.z = -2 + Math.sin(this.t * 6) * 0.5;
        break;
      case 'hurt':
      case 'dead':
        this.body.rotation.x = -0.5;
        break;
    }
    this.root.position.set(p.cx, p.body.y, p.cz);
    this.root.rotation.set(0, j.yaw, 0);
    this.body.rotation.x += j.lean;
    if (anim === 'flip' || j.flip > 0) this.body.rotation.x -= j.flip;
    this.root.scale.set(squashX / Math.sqrt(j.scaleY), j.scaleY, 1 / Math.sqrt(j.scaleY));
    const pulse = 3.2 + Math.sin(this.t * 3) * 0.8 + (anim === 'cast' ? 4 : 0);
    this.glowMat.emissiveIntensity = pulse;
    this.heartLight.intensity = 1.6 + pulse * 0.25;
    this.heart.rotation.y += dt * 1.5;
  }
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
