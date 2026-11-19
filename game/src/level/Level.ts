// Level building blocks in 3D: terrain, walls, water, puzzle objects (blocks, plates, gates,
// cracks, light beams), hazards, checkpoints, altars, triggers and decoration props.

import * as THREE from 'three';
import { World3D, Collider, Body, makeBody, boxOverlap, Box } from '../physics/World3D';
import { Player, Pushable, Transmutable } from '../actors/Player';
import { FORMS, Form } from '../actors/forms';
import { Particles } from '../render/Particles';
import { makeRockBox, rockMaterial } from '../render/Terrain';
import { makeStoneTexture, makeSoftDot } from '../render/noise';
import { applyFade, applyFadeDeep, FadeCategory, fadeUniforms } from '../render/MaterialFX';
import { loadModel, instantiate, loadNamedTexture } from '../core/Assets';
import { formMaterial, glassShell } from '../actors/HeroVisual';
import { VLight } from '../render/LightPool';
import { Foliage } from '../render/Foliage';
import { CameraRig } from '../camera/CameraRig';

export interface LevelContext {
  scene: THREE.Scene;
  world: World3D;
  fx: Particles;
  player: Player;
  rig: CameraRig;
  time: number;
  sfx(name: string, opts?: { x?: number; z?: number; volume?: number; pitch?: number }): void;
  onTrigger(id: string, data?: unknown): void;
  /** Show (or with null, clear) a hint; `owner` lets one zone's exit never clear another zone's hint. */
  showHint(text: string | null, owner?: unknown): void;
}

// --------------------------------------------------------------------------- shared materials
const procStone = makeStoneTexture(256, [150, 140, 128]);
const procDark = makeStoneTexture(256, [96, 92, 96]);
export const MAT = {
  rock: rockMaterial(procStone, 'stone', 'rock'),
  rockDark: rockMaterial(procDark, 'stone', 'rockDark'),
  stone: applyFade(new THREE.MeshStandardMaterial({ map: procStone, color: 0xb8b0a4, roughness: 0.9 }), 'stone'),
  stoneDark: applyFade(new THREE.MeshStandardMaterial({ map: procDark, color: 0x9a96a0, roughness: 0.9 }), 'stone'),
  wood: applyFade(new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.8 }), 'wood'),
  iron: applyFade(new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.55, metalness: 0.7 }), 'stone'),
  rune: new THREE.MeshStandardMaterial({ color: 0x221000, emissive: 0xffa040, emissiveIntensity: 2.5 }),
  crystal: applyFade(new THREE.MeshPhysicalMaterial({ color: 0x9ff3ff, roughness: 0.1, clearcoat: 1, emissive: 0x3fd6ff, emissiveIntensity: 1.6 }), 'glass'),
};

export async function upgradeMaterials() {
  const stone = await loadNamedTexture('stone');
  if (stone) {
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    (MAT.rock as THREE.MeshStandardMaterial).map = stone;
    (MAT.rock as THREE.MeshStandardMaterial).bumpMap = stone;
    (MAT.rock as THREE.MeshStandardMaterial).needsUpdate = true;
    const dark = stone.clone();
    dark.needsUpdate = true;
    (MAT.rockDark as THREE.MeshStandardMaterial).map = dark;
    (MAT.rockDark as THREE.MeshStandardMaterial).bumpMap = dark;
    (MAT.rockDark as THREE.MeshStandardMaterial).color.setHex(0x8a8790);
    MAT.stone.map = stone;
    MAT.stone.needsUpdate = true;
    MAT.stoneDark.map = dark;
    MAT.stoneDark.needsUpdate = true;
  }
  const wood = await loadNamedTexture('wood');
  if (wood) {
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    MAT.wood.map = wood;
    MAT.wood.color.setHex(0xffffff);
    MAT.wood.needsUpdate = true;
  }
}

export interface Entity {
  update(dt: number, ctx: LevelContext): void;
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 });

// --------------------------------------------------------------------------- blocks
export class Block implements Pushable, Transmutable, Entity {
  readonly body: Body;
  readonly collider: Collider;
  form: Form;
  readonly group = new THREE.Group();
  readonly home: { x: number; y: number; z: number; form: Form };
  private visuals = new Map<Form, THREE.Object3D>();
  private flash = 0;
  private flashLight: VLight;
  private prev = { x: 0, y: 0, z: 0 };
  constructor(private world: World3D, x: number, y: number, z: number, form: Form, readonly size = 1.2) {
    const s = size;
    this.body = makeBody(x - s / 2, y, z - s / 2, s, s, s);
    this.collider = world.add(new Collider(x - s / 2, y, z - s / 2, s, s, s, 'solid'));
    this.collider.owner = this;
    this.body.self = this.collider;
    this.form = form;
    this.home = { x, y, z, form };
    this.flashLight = new VLight(0xffffff, 0, 5, 2);
    this.flashLight.position.set(0, s / 2, 0);
    this.group.add(this.flashLight);
    this.applyForm(form, true);
  }
  get aabb(): Box {
    return this.body;
  }
  private visualFor(f: Form): THREE.Object3D {
    let v = this.visuals.get(f);
    if (!v) {
      // Stone, Clay and Glass share the Lux3D block geometry; Wood is its Lux3D material transfer.
      // Glass is rendered by a shader (Lux3D is unreliable on transparent materials).
      const id = f === 'wood' ? 'obj_block_wood' : 'obj_block';
      const mat = new THREE.MeshPhysicalMaterial();
      formMaterial(f, mat);
      const fallback = new THREE.Mesh(new THREE.BoxGeometry(this.size, this.size, this.size, 2, 2, 2), mat);
      fallback.position.y = this.size / 2;
      fallback.castShadow = fallback.receiveShadow = true;
      const holder = new THREE.Group();
      holder.add(fallback);
      v = holder;
      loadModel(id).then((g) => {
        if (!g) return;
        const m = instantiate(g, this.size * 1.04);
        if (f === 'glass' || f === 'clay') {
          m.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mm = mesh.material as THREE.MeshStandardMaterial;
            if (f === 'glass') {
              // keep the carved surface (normal map) but not the sandstone colour
              mesh.material = glassShell(new THREE.MeshPhysicalMaterial({
                color: 0xcff6ff,
                normalMap: mm.normalMap ?? null,
                roughness: 0.05,
                metalness: 0,
                clearcoat: 1,
                clearcoatRoughness: 0.04,
                transparent: true,
                opacity: 0.42,
                depthWrite: false,
                emissive: 0x1a6f80,
                emissiveIntensity: 0.5,
              }));
              mesh.castShadow = false;
            } else {
              const c = mm.clone();
              c.color = new THREE.Color(0xe39a6a); // terracotta tint over the carved stone
              mesh.material = c;
            }
          });
        }
        holder.remove(fallback);
        holder.add(m);
      });
      this.visuals.set(f, v);
      this.group.add(v);
    }
    return v;
  }
  private applyForm(f: Form, instant = false) {
    this.form = f;
    this.collider.blocksLight = !FORMS[f].passesLight;
    for (const [k, v] of this.visuals) v.visible = k === f;
    this.visualFor(f).visible = true;
    if (!instant) {
      this.flash = 1;
      this.flashLight.color.setHex(FORMS[f].emissive);
    }
  }
  setForm(f: Form) {
    this.applyForm(f);
  }
  reset() {
    this.body.x = this.home.x - this.size / 2;
    this.body.y = this.home.y;
    this.body.z = this.home.z - this.size / 2;
    this.body.vx = this.body.vy = this.body.vz = 0;
    if (this.form !== this.home.form) this.applyForm(this.home.form, true);
  }
  get heavy() {
    return this.form === 'stone';
  }
  push(axis: 'x' | 'z', delta: number, pusherHeavy: boolean) {
    if (this.form === 'stone' && !pusherHeavy) return 0;
    if (!this.body.grounded && !this.world.waterAt(this.body)) return 0;
    const b = this.body;
    if (axis === 'x') {
      const before = b.x;
      this.world.moveX(b, delta);
      this.collider.x = b.x;
      return b.x - before;
    }
    const before = b.z;
    this.world.moveZ(b, delta);
    this.collider.z = b.z;
    return b.z - before;
  }
  update(dt: number, ctx: LevelContext) {
    const b = this.body;
    const water = this.world.waterAt(b);
    if (water && this.form === 'wood') {
      const target = water.y + water.h - this.size * 0.55;
      b.vy += ((target - b.y) * 30 - b.vy * 5) * dt;
    } else if (water) {
      b.vy -= this.world.gravity * 0.3 * dt;
      b.vy = Math.max(b.vy, -2.5);
    } else {
      b.vy -= this.world.gravity * dt;
      b.vy = Math.max(b.vy, -25);
    }
    b.vx *= Math.exp(-dt * 6);
    b.vz *= Math.exp(-dt * 6);
    this.prev = { x: b.x, y: b.y, z: b.z };
    this.world.move(b, b.vx * dt, b.vy * dt, b.vz * dt);
    if (b.grounded && b.vy < 0) {
      if (b.vy < -12) {
        const c = center(b);
        ctx.fx.soft.emit({ x: c.x, y: b.y, z: c.z, count: 14, spreadX: b.w, spreadZ: b.d, speed: 3, dirY: 0.3, color: 0xcbb8a0, life: 0.8, size: 0.5, alpha: 0.5, drag: 3 });
        ctx.sfx('thud', { x: c.x, z: c.z, volume: 0.6 });
        ctx.rig.shake(0.15);
      }
      b.vy = 0;
    }
    if (b.y < -60) this.reset();
    this.collider.x = b.x;
    this.collider.y = b.y;
    this.collider.z = b.z;
    // carry the player when riding on top
    const p = ctx.player;
    if (p.body.grounded && p.body.groundCollider === this.collider) {
      const dx = b.x - this.prev.x;
      const dy = b.y - this.prev.y;
      const dz = b.z - this.prev.z;
      if (dx || dz) {
        this.world.moveX(p.body, dx);
        this.world.moveZ(p.body, dz);
      }
      if (dy > 0) p.body.y += dy;
      else if (dy < 0) this.world.moveY(p.body, dy);
    }
    const floating = water && this.form === 'wood';
    const bob = floating ? Math.sin(ctx.time * 1.6 + b.x) * 0.03 : 0;
    this.group.position.set(b.x + b.w / 2, b.y + bob, b.z + b.d / 2);
    this.group.rotation.set(floating ? Math.sin(ctx.time * 1.1 + b.z) * 0.04 : 0, 0, floating ? Math.sin(ctx.time * 1.2 + b.x) * 0.04 : 0);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 1.6);
      this.flashLight.intensity = this.flash * 30;
      this.group.scale.setScalar(1 + Math.sin(this.flash * Math.PI) * 0.08);
    }
  }
}

export class Plate implements Entity {
  pressed = false;
  readonly group = new THREE.Group();
  private rune: THREE.Mesh;
  private glow = 0;
  readonly area: Box;
  constructor(readonly x: number, readonly y: number, readonly z: number, private blocks: Block[], readonly size = 1.5) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.55, size * 0.62, 0.18, 28), MAT.stoneDark);
    base.position.y = 0.05;
    base.receiveShadow = true;
    this.rune = new THREE.Mesh(new THREE.TorusGeometry(size * 0.32, 0.035, 8, 32), MAT.rune.clone());
    this.rune.rotation.x = Math.PI / 2;
    this.rune.position.y = 0.15;
    this.group.add(base, this.rune);
    this.group.position.set(x, y, z);
    this.area = { x: x - size * 0.45, y: y - 0.05, z: z - size * 0.45, w: size * 0.9, h: 0.6, d: size * 0.9 };
  }
  update(dt: number, ctx: LevelContext) {
    const p = ctx.player;
    const playerOn = p.spec.heavy && p.body.grounded && boxOverlap(p.body, this.area);
    const blockOn = this.blocks.some((b) => b.heavy && boxOverlap(b.body, this.area));
    const now = playerOn || blockOn;
    if (now !== this.pressed) {
      this.pressed = now;
      ctx.sfx(now ? 'plateDown' : 'plateUp', { x: this.x, z: this.z });
      if (now) ctx.fx.glow.emit({ x: this.x, y: this.y + 0.15, z: this.z, count: 24, spreadX: this.size, spreadZ: this.size, speed: 2, dirY: 1, color: 0xffb860, life: 0.7, size: 0.18 });
    }
    this.glow += ((this.pressed ? 1 : 0) - this.glow) * (1 - Math.exp(-dt * 8));
    (this.rune.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + this.glow * 5;
    this.group.position.y = this.y - this.glow * 0.08;
  }
}

export class Gate implements Entity {
  readonly collider: Collider;
  readonly group = new THREE.Group();
  private openK = 0;
  private latched = false;
  constructor(
    private world: World3D,
    readonly box: Box,
    private isOpen: () => boolean,
    private latch = false,
    style: 'portcullis' | 'door' = 'portcullis',
  ) {
    const b = box;
    this.collider = world.add(new Collider(b.x, b.y, b.z, b.w, b.h, b.d, 'solid'));
    this.collider.blocksLight = style !== 'portcullis';
    const along = b.w >= b.d ? 'x' : 'z';
    const span = along === 'x' ? b.w : b.d;
    if (style === 'portcullis') {
      const bars = Math.max(2, Math.round(span / 0.32));
      for (let i = 0; i < bars; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, b.h, 0.1), MAT.iron);
        const off = -span / 2 + (i + 0.5) * (span / bars);
        bar.position.set(along === 'x' ? off : 0, b.h / 2, along === 'z' ? off : 0);
        bar.castShadow = true;
        this.group.add(bar);
      }
      for (const yy of [0.2, b.h * 0.5, b.h - 0.2]) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? span : 0.14, 0.12, along === 'z' ? span : 0.14), MAT.iron);
        cross.position.set(0, yy, 0);
        this.group.add(cross);
      }
    } else {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d, 4, 8, 4), MAT.stoneDark);
      slab.position.y = b.h / 2;
      slab.castShadow = slab.receiveShadow = true;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(Math.min(span, b.h) * 0.2, 24, 16), MAT.crystal);
      lens.scale.set(along === 'x' ? 1 : 0.35, 1, along === 'z' ? 1 : 0.35);
      lens.position.set(0, Math.min(1.2, b.h * 0.3), 0);
      this.group.add(slab, lens);
    }
    this.group.position.set(b.x + b.w / 2, b.y, b.z + b.d / 2);
  }
  update(dt: number, ctx: LevelContext) {
    const want = this.latched || this.isOpen();
    if (want && this.latch) this.latched = true;
    const before = this.openK;
    const closingBlocked = !want && boxOverlap(ctx.player.body, this.box);
    if (!closingBlocked) this.openK += ((want ? 1 : 0) - this.openK) * (1 - Math.exp(-dt * (want ? 3 : 5)));
    const c = center(this.box);
    if (Math.abs(this.openK - before) > 0.004 && Math.random() < 0.3) ctx.fx.soft.emit({ x: c.x, y: this.box.y, z: c.z, count: 2, spreadX: this.box.w, spreadZ: this.box.d, speed: 1, color: 0xb8a690, life: 0.6, size: 0.4, alpha: 0.4 });
    if (before < 0.05 && this.openK >= 0.05) {
      ctx.sfx('gate', { x: c.x, z: c.z });
      ctx.rig.shake(0.12);
    }
    const lift = this.openK * (this.box.h + 0.2);
    this.collider.y = this.box.y + lift;
    this.collider.enabled = this.openK < 0.92;
    this.group.position.y = this.box.y + lift;
  }
}

export class Crack {
  readonly collider: Collider;
  readonly mesh: THREE.Object3D;
  broken = false;
  private rock!: THREE.Object3D;
  private slabParts: THREE.Object3D | null = null; // Lux3D part split of the slab, fitted to this crack
  private debris: { obj: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3; ground: number; t: number }[] = [];
  constructor(private world: World3D, readonly box: Box, readonly mode: 'floor' | 'wall') {
    const b = box;
    this.collider = world.add(new Collider(b.x, b.y, b.z, b.w, b.h, b.d, 'solid'));
    this.collider.tag = 'crack';
    this.collider.owner = this;
    const rock = makeRockBox(b.x, b.y, b.z, b.x + b.w, b.y + b.h, b.z + b.d, MAT.rockDark, { moss: false, seed: b.x * 3.1 + b.z, wall: mode === 'wall' });
    const lines = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const len = 0.4 + Math.random() * 0.9;
      const l = new THREE.Mesh(new THREE.BoxGeometry(mode === 'floor' ? len : 0.05, mode === 'floor' ? 0.04 : len, mode === 'floor' ? 0.05 : 0.05), MAT.rune);
      const c = center(b);
      if (mode === 'floor') l.position.set(c.x + (Math.random() - 0.5) * b.w * 0.7, b.y + b.h + 0.02, c.z + (Math.random() - 0.5) * b.d * 0.7);
      else {
        const onX = b.w < b.d; // thin along x: faces point along x
        l.position.set(onX ? b.x - 0.03 : c.x + (Math.random() - 0.5) * b.w * 0.7, c.y + (Math.random() - 0.5) * b.h * 0.6, onX ? c.z + (Math.random() - 0.5) * b.d * 0.7 : b.z + b.d + 0.03);
      }
      l.rotation.set(0, Math.random() * Math.PI, mode === 'floor' ? 0 : (Math.random() - 0.5) * 1.2);
      lines.add(l);
    }
    const g = new THREE.Group();
    g.add(rock, lines);
    this.mesh = g;
    this.rock = rock;
    void this.loadLux3d();
  }

  /** Fit a model non-uniformly into this crack's box (slabs lie flat; walls stand it on edge). */
  private fit(src: THREE.Object3D) {
    const b = this.box;
    const inner = new THREE.Group();
    inner.add(src);
    if (this.mode === 'wall') {
      if (b.w < b.d) inner.rotation.z = Math.PI / 2; // thin along x
      else inner.rotation.x = Math.PI / 2; // thin along z
    }
    const holder = new THREE.Group();
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
    holder.scale.set(b.w / Math.max(size.x, 1e-3), b.h / Math.max(size.y, 1e-3), b.d / Math.max(size.z, 1e-3));
    holder.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(holder);
    holder.position.set(b.x - bb.min.x, b.y - bb.min.y, b.z - bb.min.z);
    holder.updateMatrixWorld(true);
    return holder;
  }

  /** The Lux3D cracked slab replaces the procedural rock; its part split becomes the debris. */
  private async loadLux3d() {
    const slab = await loadModel('obj_crack_slab');
    if (!slab || this.broken) return;
    const vis = this.fit(slab.scene.clone(true));
    vis.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    applyFadeDeep(vis, 'stone');
    this.mesh.remove(this.rock);
    this.mesh.add(vis);
    const parts = await loadModel('obj_crack_slab_parts');
    if (parts) this.slabParts = this.fit(parts.scene.clone(true));
  }

  update(dt: number) {
    for (const d of this.debris) {
      d.t += dt;
      if (d.t > 6) continue; // settled
      d.v.y -= 22 * dt;
      d.obj.position.addScaledVector(d.v, dt);
      d.obj.rotation.x += d.w.x * dt;
      d.obj.rotation.y += d.w.y * dt;
      d.obj.rotation.z += d.w.z * dt;
      if (d.obj.position.y < d.ground) {
        d.obj.position.y = d.ground;
        d.v.y = Math.abs(d.v.y) > 2 ? -d.v.y * 0.25 : 0;
        d.v.x *= 0.55;
        d.v.z *= 0.55;
        d.w.multiplyScalar(0.5);
      }
    }
  }

  /** Throw the Lux3D part-split pieces out of the slab. */
  private burstParts(ctx: LevelContext) {
    const parts = this.slabParts;
    if (!parts) return false;
    const c = center(this.box);
    const origin = new THREE.Vector3(c.x, c.y, c.z);
    const p = ctx.player;
    const push = new THREE.Vector3(p.body.vx, 0, p.body.vz);
    if (push.lengthSq() > 0.01) push.normalize();
    ctx.scene.add(parts);
    parts.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    parts.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      // re-centre each piece on its own middle so it tumbles about itself
      const geo = mesh.geometry.clone();
      geo.computeBoundingBox();
      const mid = geo.boundingBox!.getCenter(new THREE.Vector3());
      const worldMid = mid.clone().applyMatrix4(mesh.matrixWorld);
      const worldOrigin = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      ctx.scene.attach(mesh);
      geo.translate(-mid.x, -mid.y, -mid.z);
      mesh.geometry = geo;
      mesh.position.add(worldMid.clone().sub(worldOrigin));
      mesh.castShadow = true;
      const out = worldMid.clone().sub(origin);
      out.y = 0;
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize();
      const v =
        this.mode === 'floor'
          ? out.multiplyScalar(1.5 + Math.random() * 2.5).setY(1 + Math.random() * 3)
          : push.clone().multiplyScalar(5 + Math.random() * 4).add(out.multiplyScalar(1.5)).setY(1.5 + Math.random() * 3);
      const hit = this.world.raycast(worldMid.x, worldMid.y - 0.05 - (this.mode === 'floor' ? this.box.h : 0), worldMid.z, 0, -1, 0, 40, false);
      const ground = hit ? hit.y + 0.15 : worldMid.y - 30;
      this.debris.push({ obj: mesh, v, w: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9), ground, t: 0 });
    }
    ctx.scene.remove(parts);
    return meshes.length > 0;
  }

  shatter(ctx: LevelContext) {
    if (this.broken) return;
    this.broken = true;
    this.collider.enabled = false;
    this.mesh.visible = false;
    const lux = this.burstParts(ctx);
    const c = center(this.box);
    ctx.fx.rocks.burst(c.x, c.y, lux ? 12 : 30, lux ? 0.35 : 0.55, 9, 0x8f877f, this.box.y - 10, Math.max(this.box.w, this.box.d), c.z);
    ctx.fx.soft.emit({ x: c.x, y: c.y, z: c.z, count: 45, spreadX: this.box.w, spreadY: this.box.h, spreadZ: this.box.d, speed: 4, color: 0xcbb8a0, life: 1.4, size: 0.9, alpha: 0.45, drag: 2.5, grow: 2 });
    ctx.fx.glow.emit({ x: c.x, y: c.y, z: c.z, count: 30, spreadX: this.box.w, spreadZ: this.box.d, speed: 6, color: 0xffb050, life: 0.6, size: 0.15, gravity: 10 });
    ctx.sfx('crumble', { x: c.x, z: c.z, volume: 1 });
    ctx.rig.shake(0.55);
  }
}

/** Lighting shared by every water surface (set each frame from the area mood). */
export const WATER_LIGHT = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(0xffffff) },
  sky: { value: new THREE.Color(0x6a8aa0) },
  fog: { value: new THREE.Color(0x2c5e68) },
};

export class Water implements Entity {
  readonly group = new THREE.Group();
  private surfaceMat: THREE.ShaderMaterial;
  private causticMat: THREE.ShaderMaterial;
  constructor(world: World3D, readonly box: Box) {
    const b = box;
    world.addWater(b.x, b.y, b.z, b.x + b.w, b.y + b.h, b.z + b.d);
    this.surfaceMat = new THREE.ShaderMaterial({
      transparent: true,
      // the surface writes depth so the screen-space fog and light shafts stop at it instead of
      // being integrated all the way down to the lake bed (which read as milky ice)
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x041a22) },
        uShallow: { value: new THREE.Color(0x15606a) },
        uFoam: { value: new THREE.Color(0xd6f6ff) },
        uSize: { value: new THREE.Vector2(b.w, b.d) },
        uSunDir: WATER_LIGHT.sunDir,
        uSunColor: WATER_LIGHT.sunColor,
        uSky: WATER_LIGHT.sky,
        uFogCol: WATER_LIGHT.fog,
      },
      vertexShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          w.y += sin(w.x * 0.9 + uTime * 1.3) * 0.035 + sin(w.z * 1.3 + uTime * 0.9) * 0.03 + sin((w.x + w.z) * 2.1 + uTime * 2.3) * 0.012;
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec2 uSize;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uFogCol;
        varying vec2 vUv; varying vec3 vW;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        float waves(vec2 p, float t) { return fbm(p + vec2(t, t * 0.6)) * 0.55 + fbm(p * 2.3 - vec2(t * 1.3, -t * 0.8)) * 0.3 + noise(p * 7.0 + vec2(t * 3.0, t * 2.0)) * 0.15; }
        void main() {
          vec2 p = vW.xz * 0.35;
          float t = uTime * 0.22;
          float h = waves(p, t);
          float e = 0.03;
          float hx = waves(p + vec2(e, 0.0), t);
          float hz = waves(p + vec2(0.0, e), t);
          vec3 n = normalize(vec3((h - hx) * 9.0, 1.0, (h - hz) * 9.0));
          vec3 v = normalize(cameraPosition - vW);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 sd = normalize(uSunDir);
          vec3 r = reflect(-v, n);
          float spec = pow(max(dot(r, sd), 0.0), 220.0) * 6.0 + pow(max(dot(r, sd), 0.0), 24.0) * 0.25;
          // distance to the shore (metres) for foam and shallows
          vec2 dEdge = min(vUv, 1.0 - vUv) * uSize;
          float shore = min(dEdge.x, dEdge.y);
          float foam = smoothstep(0.9, 0.0, shore) * (0.55 + 0.45 * noise(vW.xz * 3.0 + uTime * 0.6));
          foam += smoothstep(0.55, 0.85, noise(vW.xz * 1.7 - vec2(uTime * 0.25, uTime * 0.1))) * smoothstep(3.5, 0.4, shore) * 0.35;
          vec3 body = mix(uDeep, uShallow, smoothstep(0.3, 0.85, h) * 0.6 + smoothstep(4.0, 0.0, shore) * 0.4);
          // sky/fog reflection: cooler and brighter at grazing angles
          vec3 refl = mix(uFogCol, uSky, clamp(r.y * 1.5 + 0.3, 0.0, 1.0));
          vec3 col = mix(body, refl, fres * 0.85);
          // glints
          float glint = step(0.985, noise(vW.xz * 9.0 + vec2(uTime * 1.7, -uTime * 1.3))) * (0.5 + fres);
          col += uSunColor * (spec + glint * 0.6) + uFoam * foam * 0.55;
          float a = clamp(0.5 + fres * 0.42 + foam * 0.3, 0.0, 0.96);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d, Math.max(8, Math.round(b.w * 1.5)), Math.max(8, Math.round(b.d * 1.5))), this.surfaceMat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(b.x + b.w / 2, b.y + b.h, b.z + b.d / 2);
    surf.renderOrder = 10;
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshBasicMaterial({ color: 0x06232c, transparent: true, opacity: 0.55, depthWrite: false }));
    body.position.set(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2);
    body.renderOrder = 9;
    // dancing caustic light on the bed, drawn additively just above it
    this.causticMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x7fe0ff) } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec2 vUv;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; varying vec3 vW; varying vec2 vUv;
        vec2 h2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float cells(vec2 p, float t) {
          vec2 i = floor(p); vec2 f = fract(p); float d = 1.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = h2(i + g); o = 0.5 + 0.5 * sin(t + 6.2831 * o);
            d = min(d, length(g + o - f));
          }
          return d;
        }
        void main() {
          float c = pow(1.0 - cells(vW.xz * 0.9, uTime * 0.9), 6.0) + pow(1.0 - cells(vW.xz * 1.6 + 3.1, uTime * 1.2), 8.0) * 0.6;
          float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
          gl_FragColor = vec4(uColor * c * 0.55 * edge, 1.0);
        }`,
    });
    const caustics = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), this.causticMat);
    caustics.rotation.x = -Math.PI / 2;
    caustics.position.set(b.x + b.w / 2, b.y + 0.04, b.z + b.d / 2);
    caustics.renderOrder = 8;
    this.group.add(caustics, body, surf);
  }
  update(dt: number, ctx: LevelContext) {
    this.surfaceMat.uniforms.uTime.value = ctx.time;
    this.causticMat.uniforms.uTime.value = ctx.time;
    const b = this.box;
    if (Math.random() < dt * 4) ctx.fx.glow.emit({ x: b.x + Math.random() * b.w, y: b.y + Math.random() * b.h, z: b.z + Math.random() * b.d, count: 1, vy: 0.8, color: 0x9fe8ff, life: 2, size: 0.08, alpha: 0.6 });
  }
}

export class Receptor {
  static clock = 0;
  readonly collider: Collider;
  litTime = 0;
  lastLit = -1;
  /** Only light that has passed through a glass block counts (the Prism Door). */
  needsGlass = false;
  /** Whether the light that reached it last passed through a glass block. */
  viaGlass = false;
  constructor(world: World3D, box: Box) {
    this.collider = world.add(new Collider(box.x, box.y, box.z, box.w, box.h, box.d, 'solid'));
    this.collider.owner = this;
  }
  isLit() {
    return Receptor.clock - this.lastLit < 0.15 && this.litTime > 0.3 && (!this.needsGlass || this.viaGlass);
  }
}

/** Whether the segment o + dir * [0, len] passes through the box. */
function segmentHitsBox(o: THREE.Vector3, dir: THREE.Vector3, len: number, b: Box) {
  let t0 = 0;
  let t1 = len;
  for (const [oa, da, mn, mx] of [
    [o.x, dir.x, b.x, b.x + b.w],
    [o.y, dir.y, b.y, b.y + b.h],
    [o.z, dir.z, b.z, b.z + b.d],
  ]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < mn || oa > mx) return false;
    } else {
      let a = (mn - oa) / da;
      let c = (mx - oa) / da;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export class Beam implements Entity {
  readonly group = new THREE.Group();
  private core: THREE.Mesh;
  private haze: THREE.Mesh;
  private hitGlow: THREE.Sprite;
  private hitLight: VLight;
  private quat = new THREE.Quaternion();
  len = 0;
  constructor(private world: World3D, readonly o: THREE.Vector3, readonly dir: THREE.Vector3, private maxLen = 40, color = 0x8ff3ff, private blocks: Block[] = []) {
    this.dir.normalize();
    this.core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.haze = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 1, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.hitGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSoftDot(64), color: new THREE.Color(color).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.hitGlow.scale.setScalar(1.6);
    this.hitLight = new VLight(color, 6, 7, 2);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
    for (const m of [this.core, this.haze]) {
      m.quaternion.copy(this.quat);
      this.group.add(m);
    }
    this.group.add(this.hitGlow, this.hitLight);
  }
  update(dt: number, ctx: LevelContext) {
    const p = ctx.player;
    const extras = p.spec.passesLight || p.dead ? [] : [p.body];
    const { o, dir } = this;
    const hit = this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, this.maxLen, true, extras);
    this.len = hit ? hit.dist : this.maxLen;
    const mid = o.clone().addScaledVector(dir, this.len / 2);
    for (const m of [this.core, this.haze]) {
      m.position.copy(mid);
      m.scale.set(1, this.len, 1);
    }
    const end = o.clone().addScaledVector(dir, this.len);
    this.hitGlow.position.copy(end);
    this.hitLight.position.copy(end).addScaledVector(dir, -0.4);
    (this.core.material as THREE.MeshBasicMaterial).opacity = 0.85 * (0.9 + Math.sin(ctx.time * 30) * 0.1);
    // did the light pass through a glass block on its way? (it shines brighter after it does)
    const viaGlass = this.blocks.some((b) => b.form === 'glass' && segmentHitsBox(o, dir, this.len, b.body));
    (this.haze.material as THREE.MeshBasicMaterial).opacity = viaGlass ? 0.42 : 0.22;
    if (hit?.collider?.owner instanceof Receptor) {
      const r = hit.collider.owner;
      if (ctx.time - r.lastLit > 0.15) r.litTime = 0;
      r.litTime += dt;
      r.lastLit = ctx.time;
      r.viaGlass = viaGlass;
    }
    if (Math.random() < dt * 30) ctx.fx.glow.emit({ x: end.x, y: end.y, z: end.z, count: 1, speed: 2.5, color: 0x9ff3ff, life: 0.4, size: 0.1 });
    if (p.spec.passesLight && !p.dead) {
      const t = this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, this.len, true, [p.body]);
      if (t?.extra && Math.random() < dt * 40) ctx.fx.glow.emit({ x: p.cx, y: p.cy, z: p.cz, count: 2, speed: 3, color: 0xc8fbff, life: 0.5, size: 0.12 });
    }
  }
}

/** A trough of fire across a passage: burns Wood, harmless to the other forms. */
// A curtain of procedural flames: scrolling fbm noise shaped to thin out with height.
const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLAME_FRAG = /* glsl */ `
  uniform float uTime; uniform float uSeed; uniform float uLen; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec2 q = vec2(vUv.x * uLen * 1.3 + uSeed, vUv.y * 2.2 - uTime * 1.9);
    float n = fbm(q) * 0.8 + fbm(q * 2.1 + vec2(0.0, -uTime * 1.3)) * 0.35;
    float h = vUv.y;
    float shape = n * (1.2 - h) - h * 0.6;
    float a = smoothstep(0.06, 0.36, shape);
    a *= smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x) * smoothstep(0.0, 0.1, h);
    vec3 col = mix(vec3(0.55, 0.1, 0.02), vec3(1.0, 0.42, 0.07), smoothstep(0.08, 0.35, shape));
    col = mix(col, vec3(1.0, 0.86, 0.5), smoothstep(0.35, 0.75, shape));
    gl_FragColor = vec4(col * 2.2, a);
  }`;

export class Fire implements Entity {
  readonly group = new THREE.Group();
  private lights: VLight[] = [];
  private flames: THREE.ShaderMaterial[] = [];
  private emberMat: THREE.MeshStandardMaterial;
  readonly rect: Box;
  constructor(box: Box) {
    this.rect = { ...box, h: Math.max(box.h, 1.6) };
    const trough = new THREE.Mesh(new THREE.BoxGeometry(box.w, 0.35, box.d), MAT.iron);
    trough.position.set(box.x + box.w / 2, box.y + 0.17, box.z + box.d / 2);
    trough.castShadow = true;
    // glowing coals, deliberately below bloom saturation so the flames read on top of them
    this.emberMat = new THREE.MeshStandardMaterial({ color: 0x1a0602, emissive: 0xff4a12, emissiveIntensity: 1.3, roughness: 0.9 });
    const embers = new THREE.Mesh(new THREE.BoxGeometry(box.w * 0.9, 0.05, box.d * 0.9), this.emberMat);
    embers.position.set(box.x + box.w / 2, box.y + 0.36, box.z + box.d / 2);
    this.group.add(trough, embers);
    // flame curtains along the long side of the trough
    const alongZ = box.d >= box.w;
    const len = alongZ ? box.d : box.w;
    const across = alongZ ? box.w : box.d;
    for (const [i, off] of [-0.28, 0, 0.28].entries()) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 17.3 }, uLen: { value: len } },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.flames.push(mat);
      const h = 1.5 + (i === 1 ? 0.35 : 0);
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.94, h), mat);
      curtain.position.set(box.x + box.w / 2 + (alongZ ? off * across : 0), box.y + 0.36 + h / 2, box.z + box.d / 2 + (alongZ ? 0 : off * across));
      if (alongZ) curtain.rotation.y = Math.PI / 2;
      curtain.renderOrder = 21;
      this.group.add(curtain);
    }
    const n = Math.max(1, Math.round(Math.max(box.w, box.d) / 3));
    for (let i = 0; i < n; i++) {
      const l = new VLight(0xff8a30, 14, 8, 2);
      const k = (i + 0.5) / n;
      l.position.set(box.x + (box.w >= box.d ? box.w * k : box.w / 2), box.y + 1.3, box.z + (box.d > box.w ? box.d * k : box.d / 2));
      this.lights.push(l);
      this.group.add(l);
    }
  }
  update(dt: number, ctx: LevelContext) {
    const r = this.rect;
    for (const m of this.flames) m.uniforms.uTime.value = ctx.time;
    this.emberMat.emissiveIntensity = 1.2 + Math.sin(ctx.time * 9.1) * 0.15 + Math.sin(ctx.time * 23.7) * 0.08;
    for (let i = 0; i < this.lights.length; i++) this.lights[i].intensity = 12 + Math.sin(ctx.time * 17 + i * 2) * 3 + Math.sin(ctx.time * 7.3 + i) * 2;
    const count = Math.ceil(Math.max(r.w, r.d) * 1.2 * dt * 60 * 0.1);
    for (let i = 0; i < count; i++) {
      ctx.fx.glow.emit({ x: r.x + Math.random() * r.w, y: r.y + 0.45, z: r.z + Math.random() * r.d, count: 1, vy: 2.6, speed: 0.6, color: 0xff7a1f, color2: 0xffd27a, life: 0.7, size: 0.34, grow: 0.3, drag: 0.6 });
    }
    if (Math.random() < dt * 8) ctx.fx.glow.emit({ x: r.x + Math.random() * r.w, y: r.y + 1.2, z: r.z + Math.random() * r.d, count: 1, vy: 3, speed: 1.5, color: 0xffb060, life: 1.6, size: 0.06, drag: 0.4 });
  }
}

export class Checkpoint implements Entity {
  readonly group = new THREE.Group();
  active = false;
  private crystal: THREE.Mesh;
  private crystalMat: THREE.MeshPhysicalMaterial;
  private glow: THREE.Sprite;
  private light: VLight;
  constructor(readonly x: number, readonly y: number, readonly z: number, readonly radius = 3) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 7), MAT.stoneDark);
    base.position.y = 0.25;
    base.castShadow = base.receiveShadow = true;
    // a faceted amber shrine crystal: dim until Loam reaches it, then it blazes
    this.crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xffc070, emissive: 0xff8a20, emissiveIntensity: 0.25, roughness: 0.15, clearcoat: 1, flatShading: true });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 1), this.crystalMat);
    this.crystal.position.y = 1.0;
    this.crystal.scale.y = 1.7;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSoftDot(64), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.25 }));
    this.glow.position.y = 1.0;
    this.glow.scale.setScalar(1.1);
    this.light = new VLight(0xffa040, 0.6, 5, 2);
    this.light.position.y = 1.1;
    this.group.add(base, this.crystal, this.glow, this.light);
    this.group.position.set(x, y, z);
  }
  update(dt: number, ctx: LevelContext) {
    this.crystal.rotation.y += dt * (this.active ? 1.5 : 0.3);
    this.crystal.position.y = 1.0 + Math.sin(ctx.time * 2) * 0.06;
    this.glow.position.y = this.crystal.position.y;
    const pulse = 0.85 + Math.sin(ctx.time * 3) * 0.15;
    this.glow.material.opacity = (this.active ? 0.8 : 0.22) * pulse;
    const p = ctx.player;
    // only while standing on the shrine's own floor: never from the water below or mid-air beside it
    // (from the lake's surface the fire shrine used to claim Loam, skipping the float-up puzzle)
    if (!this.active && !p.dead && p.grounded && Math.hypot(p.cx - this.x, p.cz - this.z) < this.radius && Math.abs(p.body.y - this.y) < 1.2) {
      this.active = true;
      p.respawn = { x: this.x + 0.9, y: this.y + 0.05, z: this.z };
      this.crystalMat.emissiveIntensity = 3.2;
      this.light.intensity = 6;
      ctx.fx.glow.emit({ x: this.x, y: this.y + 1, z: this.z, count: 40, speed: 5, color: 0xffb860, life: 1, size: 0.15 });
      ctx.sfx('checkpoint', { x: this.x, z: this.z });
    }
  }
}

export class Altar implements Entity {
  readonly group = new THREE.Group();
  used = false;
  private orb: THREE.Mesh;
  private glow: THREE.Sprite;
  private light: VLight;
  constructor(readonly x: number, readonly y: number, readonly z: number, readonly form: Form) {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 1.0, 8), MAT.stoneDark);
    pedestal.position.y = 0.5;
    pedestal.castShadow = true;
    const mat = new THREE.MeshPhysicalMaterial();
    formMaterial(form, mat);
    mat.emissive.setHex(FORMS[form].emissive);
    mat.emissiveIntensity = 1.8;
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), mat);
    this.orb.position.y = 1.55;
    this.light = new VLight(FORMS[form].emissive, 14, 11, 2);
    this.light.position.set(0, 1.9, 0.4);
    this.light.priority = 2;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSoftDot(64), color: new THREE.Color(FORMS[form].emissive).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
    this.glow.scale.setScalar(1.6);
    this.glow.position.y = 1.55;
    this.group.add(pedestal, this.orb, this.light, this.glow);
    this.group.position.set(x, y, z);
  }
  update(dt: number, ctx: LevelContext) {
    this.orb.rotation.y += dt;
    this.orb.position.y = 1.55 + Math.sin(ctx.time * 1.7) * 0.1;
    this.glow.position.y = this.orb.position.y;
    this.glow.visible = this.orb.visible;
    this.glow.material.opacity = 0.55 + Math.sin(ctx.time * 2.3) * 0.15;
    if (!this.used) {
      if (Math.random() < dt * 12) ctx.fx.glow.emit({ x: this.x, y: this.y + 1.55, z: this.z, count: 1, speed: 1.2, vy: 0.6, color: FORMS[this.form].emissive, life: 1.2, size: 0.12 });
      const p = ctx.player;
      if (!p.dead && p.control && Math.hypot(p.cx - this.x, p.cz - this.z) < 1.6 && Math.abs(p.body.y - this.y) < 1.6) {
        this.used = true;
        ctx.onTrigger(`altar:${this.form}`, this);
      }
    }
  }
  consume() {
    this.orb.visible = false;
    this.light.intensity = 3;
  }
  /** Put the orb back (dev shots that replay a section). */
  reset(used: boolean) {
    this.used = used;
    this.orb.visible = !used;
    this.light.intensity = used ? 3 : 14;
  }
  orbWorldPosition(out = new THREE.Vector3()) {
    return this.orb.getWorldPosition(out);
  }
}

/**
 * A Maker sigil inlaid in the floor: concentric rings, radial ticks and broken glyph arcs drawn
 * procedurally, glowing faintly and breathing; brighter once stone is restored.
 */
export class Sigil implements Entity {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(x: number, y: number, z: number, radius: number, color = 0xffa040, seed = 1) {
    const stone = fadeUniforms('stone');
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uSeed: { value: seed }, uFade: stone.uFade },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uSeed; uniform float uFade; varying vec2 vUv;
        float hash(float n) { return fract(sin(n * 91.345 + uSeed * 17.0) * 47453.5453); }
        float ring(float r, float c, float w) { return smoothstep(w, 0.0, abs(r - c)); }
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x) / 6.2831853 + 0.5;
          float v = ring(r, 0.97, 0.012) + ring(r, 0.9, 0.006) + ring(r, 0.62, 0.008) + ring(r, 0.3, 0.01);
          // radial ticks between the outer rings
          float ticks = step(0.9, fract(a * 48.0)) * step(0.9, r) * step(r, 0.97);
          // broken glyph arcs in the middle band
          float seg = floor(a * 18.0);
          float on = step(0.35, hash(seg));
          float band = smoothstep(0.012, 0.0, abs(r - (0.72 + hash(seg + 3.0) * 0.12))) * on;
          float spokes = smoothstep(0.012, 0.0, abs(fract(a * 6.0) - 0.5) * r * 6.2831853 / 6.0) * step(0.3, r) * step(r, 0.62) * 0.6;
          float glyph = v + ticks * 0.8 + band + spokes;
          float breathe = 0.75 + 0.25 * sin(uTime * 1.3 + uSeed);
          float sweep = smoothstep(0.03, 0.0, abs(fract(a - uTime * 0.05) - 0.5) - 0.47) * 0.6;
          float k = glyph * (0.35 + 0.65 * (1.0 - uFade)) * breathe + glyph * sweep;
          gl_FragColor = vec4(uColor * k * 1.6, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(x, y + 0.02, z);
    this.mesh.renderOrder = 5;
  }
  update(_dt: number, ctx: LevelContext) {
    this.mat.uniforms.uTime.value = ctx.time;
  }
}

export class Trigger implements Entity {
  fired = false;
  constructor(readonly box: Box, readonly id: string, readonly once = true) {}
  update(_dt: number, ctx: LevelContext) {
    if (this.fired && this.once) return;
    if (!ctx.player.dead && boxOverlap(ctx.player.body, this.box)) {
      if (!this.fired) ctx.onTrigger(this.id, this);
      this.fired = true;
    } else if (!this.once) this.fired = false;
  }
}

export class HintZone implements Entity {
  private inside = false;
  constructor(readonly box: Box, readonly text: string, private condition?: () => boolean) {}
  update(_dt: number, ctx: LevelContext) {
    const now = !ctx.player.dead && boxOverlap(ctx.player.body, this.box) && (!this.condition || this.condition());
    if (now !== this.inside) {
      this.inside = now;
      ctx.showHint(now ? this.text : null, this);
    }
  }
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  z: Math.min(z0, z1),
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
  d: Math.abs(z1 - z0),
});

// --------------------------------------------------------------------------- level builder
export class Level {
  readonly root = new THREE.Group();
  readonly entities: Entity[] = [];
  readonly blocks: Block[] = [];
  readonly cracks: Crack[] = [];
  readonly fires: Fire[] = [];
  readonly kills: Box[] = [];
  readonly altars: Altar[] = [];
  readonly receptors: Receptor[] = [];
  readonly props: THREE.Object3D[] = [];
  readonly foliage = new Foliage();

  constructor(readonly world: World3D, readonly scene: THREE.Scene) {
    scene.add(this.root);
    this.root.add(this.foliage.group);
  }

  /** Solid rock box. */
  rock(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, opts: { dark?: boolean; moss?: boolean; wall?: boolean; visual?: boolean; collide?: boolean } = {}) {
    const c = opts.collide === false ? null : this.world.addBox(x0, y0, z0, x1, y1, z1);
    if (opts.visual !== false) {
      const m = makeRockBox(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), opts.dark ? MAT.rockDark : MAT.rock, { moss: opts.moss, wall: opts.wall, seed: x0 * 0.37 + z0 * 1.3 + y0 });
      this.root.add(m);
    }
    return c;
  }
  /** Walkable ground with its top at `top`. */
  floor(x0: number, z0: number, x1: number, z1: number, top: number, depth = 6, opts: { dark?: boolean; moss?: boolean } = {}) {
    return this.rock(x0, top - depth, z0, x1, top, z1, opts);
  }
  /**
   * Tall wall from y0 to y1. Walls bound the play space, so an invisible cap continues each one
   * far above its visible top: no wall can be climbed onto or walked along to skip a puzzle.
   */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, opts: { dark?: boolean; visual?: boolean } = {}) {
    const c = this.rock(x0, y0, z0, x1, y1, z1, { ...opts, wall: true, moss: false });
    this.cap(x0, y1, z0, x1, z1);
    return c;
  }
  /** Invisible collider from `y` up to far above the level (stops climbing over a barrier). */
  cap(x0: number, y: number, z0: number, x1: number, z1: number) {
    const c = this.world.addBox(x0, y, z0, x1, y + 40, z1);
    c.blocksLight = false;
    c.blocksCamera = false;
    return c;
  }
  /**
   * Shadow-only roof: casts the sun's shadow (and so shapes the volumetric light shafts) but is
   * never drawn, so the camera can still look down into the hall from above.
   */
  shadowRoof(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = false;
    m.layers.set(1);
    this.root.add(m);
    return m;
  }
  /**
   * Collision only (keeps the player inside the playable space). Guards always reach far above
   * their nominal top, so no combination of wall jump, double jump and ledge climb gets over one.
   */
  invisible(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const c = this.world.addBox(x0, y0, z0, x1, Math.max(y0, y1) + 30, z1);
    c.blocksLight = false;
    c.blocksCamera = false;
    return c;
  }
  water(x0: number, z0: number, x1: number, z1: number, bottom: number, surface: number) {
    const w = new Water(this.world, box(x0, bottom, z0, x1, surface, z1));
    this.root.add(w.group);
    this.entities.push(w);
    return w;
  }
  block(x: number, y: number, z: number, form: Form) {
    const b = new Block(this.world, x, y, z, form);
    this.root.add(b.group);
    this.entities.push(b);
    this.blocks.push(b);
    return b;
  }
  plate(x: number, y: number, z: number) {
    const p = new Plate(x, y, z, this.blocks);
    this.root.add(p.group);
    this.entities.push(p);
    return p;
  }
  gate(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, open: () => boolean, latch = false, style: 'portcullis' | 'door' = 'portcullis') {
    const g = new Gate(this.world, box(x0, y0, z0, x1, y1, z1), open, latch, style);
    this.root.add(g.group);
    this.entities.push(g);
    return g;
  }
  crack(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mode: 'floor' | 'wall') {
    const c = new Crack(this.world, box(x0, y0, z0, x1, y1, z1), mode);
    this.root.add(c.mesh);
    this.cracks.push(c);
    return c;
  }
  receptor(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const r = new Receptor(this.world, box(x0, y0, z0, x1, y1, z1));
    this.receptors.push(r);
    return r;
  }
  beam(x: number, y: number, z: number, dx: number, dy: number, dz: number, len = 40) {
    const b = new Beam(this.world, new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz), len, 0x8ff3ff, this.blocks);
    this.root.add(b.group);
    this.entities.push(b);
    return b;
  }
  fire(x0: number, z0: number, x1: number, z1: number, y: number) {
    const f = new Fire(box(x0, y, z0, x1, y + 1.6, z1));
    this.root.add(f.group);
    this.entities.push(f);
    this.fires.push(f);
    return f;
  }
  checkpoint(x: number, y: number, z: number) {
    const c = new Checkpoint(x, y, z);
    this.root.add(c.group);
    this.entities.push(c);
    return c;
  }
  altar(x: number, y: number, z: number, form: Form) {
    const a = new Altar(x, y, z, form);
    this.root.add(a.group);
    this.entities.push(a);
    this.altars.push(a);
    return a;
  }
  sigil(x: number, y: number, z: number, radius: number, color?: number, seed = 1) {
    const sg = new Sigil(x, y, z, radius, color, seed);
    this.root.add(sg.mesh);
    this.entities.push(sg);
    return sg;
  }
  trigger(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: string, once = true) {
    const t = new Trigger(box(x0, y0, z0, x1, y1, z1), id, once);
    this.entities.push(t);
    return t;
  }
  hint(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, text: string, condition?: () => boolean) {
    this.entities.push(new HintZone(box(x0, y0, z0, x1, y1, z1), text, condition));
  }
  kill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.kills.push(box(x0, y0, z0, x1, y1, z1));
  }
  light(x: number, y: number, z: number, color: number, intensity: number, distance: number) {
    const l = new VLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    this.root.add(l);
    return l;
  }
  prop(id: string, x: number, y: number, z: number, height: number, opts: { rotY?: number; category?: FadeCategory; fallback?: () => THREE.Object3D; tint?: number; solid?: number } = {}) {
    if (opts.solid) {
      // a square footprint of half-width `solid`: Loam bumps into (or stands on) the prop instead of walking through it
      const c = this.world.addBox(x - opts.solid, y, z - opts.solid, x + opts.solid, y + height, z + opts.solid);
      c.blocksLight = false;
      c.blocksCamera = false;
    }
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = opts.rotY ?? 0;
    let fb: THREE.Object3D | null = null;
    if (opts.fallback) {
      fb = opts.fallback();
      applyFadeDeep(fb, opts.category ?? 'stone');
      fb.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      holder.add(fb);
    }
    loadModel(id).then((g) => {
      if (!g) return;
      const m = instantiate(g, height);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mm = (mesh.material as THREE.MeshStandardMaterial).clone();
          if (opts.tint) mm.color.multiply(new THREE.Color(opts.tint));
          mesh.material = mm;
        }
      });
      applyFadeDeep(m, opts.category ?? 'stone');
      if (fb) holder.remove(fb);
      holder.add(m);
    });
    this.root.add(holder);
    this.props.push(holder);
    return holder;
  }

  update(dt: number, ctx: LevelContext) {
    Receptor.clock = ctx.time;
    for (const e of this.entities) e.update(dt, ctx);
    for (const c of this.cracks) c.update(dt);
  }

  hazardAt(a: Box): 'fire' | 'kill' | null {
    for (const k of this.kills) if (boxOverlap(a, k)) return 'kill';
    for (const f of this.fires) if (boxOverlap(a, f.rect)) return 'fire';
    return null;
  }

  crackFor(c: Collider) {
    return this.cracks.find((k) => k.collider === c) ?? null;
  }

  findTransmutable(p: Player): Block | null {
    const reach = { x: p.body.x - 0.95, y: p.body.y - 0.4, z: p.body.z - 0.95, w: p.body.w + 1.9, h: p.body.h + 0.8, d: p.body.d + 1.9 };
    let best: Block | null = null;
    let bestD = Infinity;
    for (const b of this.blocks) {
      if (!boxOverlap(reach, b.body)) continue;
      const c = center(b.body);
      const d = Math.hypot(c.x - p.cx, c.z - p.cz);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  findPushable(p: Player, axis: 'x' | 'z', dir: -1 | 1): Block | null {
    const pb = p.body;
    for (const b of this.blocks) {
      const bb = b.body;
      const vertical = pb.y < bb.y + bb.h - 0.1 && pb.y + pb.h > bb.y + 0.1;
      if (!vertical) continue;
      if (axis === 'x') {
        const touching = dir > 0 ? Math.abs(bb.x - (pb.x + pb.w)) < 0.07 : Math.abs(bb.x + bb.w - pb.x) < 0.07;
        const lateral = pb.z < bb.z + bb.d - 0.15 && pb.z + pb.d > bb.z + 0.15;
        if (touching && lateral) return b;
      } else {
        const touching = dir > 0 ? Math.abs(bb.z - (pb.z + pb.d)) < 0.07 : Math.abs(bb.z + bb.d - pb.z) < 0.07;
        const lateral = pb.x < bb.x + bb.w - 0.15 && pb.x + pb.w > bb.x + 0.15;
        if (touching && lateral) return b;
      }
    }
    return null;
  }
}
