// Pooled CPU particles (soft points) and 3D debris chunks for impacts, shatters and magic.

import * as THREE from 'three';
import { makeSoftDot } from './noise';

export interface EmitOptions {
  x: number;
  y: number;
  z?: number;
  count: number;
  spreadX?: number;
  spreadY?: number;
  spreadZ?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  speed?: number; // random radial speed
  dirX?: number; // bias radial direction
  dirY?: number;
  gravity?: number;
  drag?: number;
  life?: number;
  lifeJitter?: number;
  size?: number;
  sizeJitter?: number;
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: number;
  grow?: number; // size multiplier over life
}

class PointPool {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseAlpha: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  private tmp = new THREE.Color();
  private tmp2 = new THREE.Color();
  private mat!: THREE.ShaderMaterial;
  setViewHeight(h: number) {
    this.mat.uniforms.uViewH.value = h;
  }

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.baseSize = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: makeSoftDot(64) }, uViewH: { value: 1750 }, uBoost: { value: additive ? 2.2 : 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uViewH;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // scale with the drawing-buffer height so sprites look the same at any resolution / DPR
          gl_PointSize = aSize * uViewH * 0.343 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uBoost;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float a = texture2D(uTex, gl_PointCoord).r * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * uBoost, a);
        }`,
    });
    this.mat = mat;
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  emit(o: EmitOptions) {
    const c1 = this.tmp.set(o.color ?? 0xffffff);
    const c2 = this.tmp2.set(o.color2 ?? o.color ?? 0xffffff);
    for (let k = 0; k < o.count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 0) * (0.3 + Math.random() * 0.7);
      let dx = Math.cos(a);
      let dy = Math.sin(a);
      if (o.dirX !== undefined || o.dirY !== undefined) {
        dx = dx * 0.5 + (o.dirX ?? 0);
        dy = dy * 0.5 + (o.dirY ?? 0);
      }
      this.pos[i * 3] = o.x + (Math.random() - 0.5) * (o.spreadX ?? 0);
      this.pos[i * 3 + 1] = o.y + (Math.random() - 0.5) * (o.spreadY ?? 0);
      this.pos[i * 3 + 2] = (o.z ?? 0.4) + (Math.random() - 0.5) * (o.spreadZ ?? 0.4);
      this.vel[i * 3] = (o.vx ?? 0) + dx * sp;
      this.vel[i * 3 + 1] = (o.vy ?? 0) + dy * sp;
      this.vel[i * 3 + 2] = (o.vz ?? 0) + (Math.random() - 0.5) * sp * 0.5;
      const life = (o.life ?? 0.8) * (1 + (Math.random() - 0.5) * (o.lifeJitter ?? 0.4));
      this.life[i] = life;
      this.maxLife[i] = life;
      this.baseSize[i] = (o.size ?? 0.2) * (1 + (Math.random() - 0.5) * (o.sizeJitter ?? 0.5));
      this.grow[i] = o.grow ?? 1;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      this.baseAlpha[i] = o.alpha ?? 1;
      const t = Math.random();
      this.col[i * 3] = c1.r + (c2.r - c1.r) * t;
      this.col[i * 3 + 1] = c1.g + (c2.g - c1.g) * t;
      this.col[i * 3 + 2] = c1.b + (c2.b - c1.b) * t;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fadeIn = Math.min(1, (1 - k) * 8);
      this.alpha[i] = this.baseAlpha[i] * Math.min(fadeIn, k * 1.6);
      this.size[i] = this.baseSize[i] * (1 + (this.grow[i] - 1) * (1 - k));
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Chunk {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  s: number;
  life: number;
  floorY: number;
}

class DebrisPool {
  readonly mesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private cursor = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();

  constructor(n: number, material: THREE.Material) {
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      this.chunks.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 0, life: 0, floorY: -999 });
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  }

  burst(x: number, y: number, count: number, size: number, speed: number, color: THREE.ColorRepresentation, floorY = -999, spreadX = 0.6, z = 0) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.chunks.length;
      const ch = this.chunks[i];
      ch.alive = true;
      ch.p.set(x + (Math.random() - 0.5) * spreadX, y + Math.random() * 0.3, z + (Math.random() - 0.5) * spreadX);
      const a = Math.random() * Math.PI;
      const b = Math.random() * Math.PI * 2;
      ch.v.set(Math.cos(b) * Math.cos(a) * speed * (0.4 + Math.random()), Math.sin(a) * speed * (0.6 + Math.random() * 0.8), Math.sin(b) * Math.cos(a) * speed * (0.4 + Math.random()));
      ch.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      ch.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      ch.s = size * (0.4 + Math.random() * 0.9);
      ch.life = 2.2 + Math.random() * 1.2;
      ch.floorY = floorY;
      const shade = 0.75 + Math.random() * 0.4;
      this.mesh.setColorAt(i, c.clone().multiplyScalar(shade));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.chunks.length; i++) {
      const ch = this.chunks[i];
      if (!ch.alive) continue;
      ch.life -= dt;
      ch.v.y -= 30 * dt;
      ch.p.addScaledVector(ch.v, dt);
      if (ch.p.y < ch.floorY + ch.s * 0.3) {
        ch.p.y = ch.floorY + ch.s * 0.3;
        ch.v.y = Math.abs(ch.v.y) * 0.3;
        ch.v.x *= 0.6;
        ch.v.z *= 0.6;
        ch.w.multiplyScalar(0.6);
      }
      ch.r.x += ch.w.x * dt;
      ch.r.y += ch.w.y * dt;
      ch.r.z += ch.w.z * dt;
      const s = ch.life < 0.6 ? ch.s * Math.max(0, ch.life / 0.6) : ch.s;
      if (ch.life <= 0) ch.alive = false;
      this.q.setFromEuler(ch.r);
      this.sc.setScalar(ch.alive ? s : 0);
      this.m.compose(ch.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  readonly glow = new PointPool(3000, true);
  readonly soft = new PointPool(1500, false);
  readonly rocks: DebrisPool;
  readonly shards: DebrisPool;

  constructor() {
    this.group.add(this.glow.points, this.soft.points);
    this.rocks = new DebrisPool(220, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    this.shards = new DebrisPool(
      160,
      new THREE.MeshPhysicalMaterial({ color: 0xdffaff, roughness: 0.05, clearcoat: 1, emissive: 0x4fd8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 }),
    );
    this.group.add(this.rocks.mesh, this.shards.mesh);
  }

  /** Drawing-buffer height in pixels (keeps sprite sizes resolution independent). */
  setViewHeight(h: number) {
    this.glow.setViewHeight(h);
    this.soft.setViewHeight(h);
  }

  update(dt: number) {
    this.glow.update(dt);
    this.soft.update(dt);
    this.rocks.update(dt);
    this.shards.update(dt);
  }
}
