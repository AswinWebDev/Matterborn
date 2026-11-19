// Living things: wind-swept grass, glowing flowers and fireflies. They belong to the "life"
// category, so until the wood altar restores living things they are short, grey and still; the
// restoration wave makes them grow, colour and start to sway as it passes.

import * as THREE from 'three';
import { applyFade, fadeUniforms } from './MaterialFX';
import { makeSoftDot, mulberry32 } from './noise';
import { SUN } from './SharedLight';

export interface Patch {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  /** Blades per square metre. */
  density?: number;
}

const time = { value: 0 };
/** Advance the shared foliage clock (wind). */
export function updateFoliage(t: number) {
  time.value = t;
}

/** A blade: a tapered, slightly curved strip with uv.y = 0 at the root and 1 at the tip. */
function bladeGeometry() {
  const segs = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.03 * (1 - t * 0.9);
    const bend = t * t * 0.12;
    pos.push(-w, t, bend, w, t, bend);
    uv.push(0, t, 1, t);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // up-facing normals: blades take the light like the ground they grow from (no dark backsides)
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((segs + 1) * 2).fill(0).flatMap(() => [0, 1, 0]), 3));
  g.setIndex(idx);
  return g;
}

/** Shared vertex logic: wind sway that grows toward the tip, and growth with the life wave. */
function windPatch(mat: THREE.MeshStandardMaterial, sway: number, key: string) {
  const life = fadeUniforms('life');
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, { uWindTime: time, uLF: life.uFade, uLO: life.uOrigin, uLR: life.uRadius, uSunDir: SUN.dir, uSunCol: SUN.color });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime; uniform float uLF; uniform vec3 uLO; uniform float uLR;\nvarying float vTip;\nvarying vec3 vWorldPosT;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 iBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 wBase = (modelMatrix * vec4(iBase, 1.0)).xyz;
        float alive = (1.0 - uLF) + uLF * (1.0 - smoothstep(uLR - 4.0, uLR, distance(wBase, uLO)));
        float tip = uv.y;
        vTip = tip;
        transformed.y *= mix(0.3, 1.0, alive);
        float gust = sin(uWindTime * 0.6 + wBase.x * 0.05) * 0.5 + 0.5;
        float w = sin(uWindTime * 1.9 + wBase.x * 0.37 + wBase.z * 0.23) * 0.6 + sin(uWindTime * 3.3 + wBase.x * 1.1 - wBase.z * 0.7) * 0.25;
        float bendK = tip * tip * ${sway.toFixed(3)} * alive * (0.4 + gust);
        transformed.x += w * bendK;
        transformed.z += (w * 0.5 + 0.35 * gust) * bendK;`,
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPosT = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTip;\nvarying vec3 vWorldPosT;\nuniform vec3 uSunDir; uniform vec3 uSunCol;')
      // two-sided blades keep their up-facing normal on the back face too (no dark backsides)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.6, 1.25, vTip);')
      // light shining through thin blades when Loam looks toward the sun (backlit glow on the tips)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 vdW = normalize(cameraPosition - vWorldPosT);
        float back = pow(max(dot(-vdW, normalize(uSunDir)), 0.0), 4.0);
        totalEmissiveRadiance += uSunCol * diffuseColor.rgb * back * vTip * vTip * 0.55;`,
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key;
}

export class Foliage {
  readonly group = new THREE.Group();
  private fireflies: THREE.Points[] = [];
  private flyMat: THREE.ShaderMaterial;

  constructor() {
    this.flyMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: time,
        uTex: { value: makeSoftDot(64) },
        uViewH: { value: 1080 },
        uLF: fadeUniforms('life').uFade,
      },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uViewH; uniform float uLF;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.25 + aSeed * 0.3) + aSeed * 50.0;
          p += vec3(sin(t) * 1.6 + sin(t * 2.3) * 0.5, sin(t * 1.3 + 1.0) * 0.6, cos(t * 0.9) * 1.6);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float blink = smoothstep(0.2, 1.0, sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 30.0) * 0.5 + 0.5);
          vA = blink * (1.0 - uLF) * smoothstep(60.0, 10.0, -mv.z);
          gl_PointSize = min(uViewH * 0.11 / -mv.z, 18.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying float vA;
        void main() {
          float a = texture2D(uTex, gl_PointCoord).r * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.85, 0.4) * 3.0, a);
        }`,
    });
  }

  setViewHeight(h: number) {
    this.flyMat.uniforms.uViewH.value = h;
  }

  /** Grass over a set of floor patches (one draw call per call of this method). */
  grass(patches: Patch[], opts: { seed?: number; height?: number; color?: number; tipColor?: number; max?: number; heightAt?: (x: number, z: number) => number } = {}) {
    const rnd = mulberry32(opts.seed ?? 11);
    const items: { x: number; y: number; z: number }[] = [];
    for (const p of patches) {
      const area = Math.abs(p.x1 - p.x0) * Math.abs(p.z1 - p.z0);
      const n = Math.round(area * (p.density ?? 9));
      for (let i = 0; i < n; i++) {
        const x = p.x0 + rnd() * (p.x1 - p.x0);
        const z = p.z0 + rnd() * (p.z1 - p.z0);
        // clumps: skip some blades by a cheap noise so the field is not a uniform carpet
        const clump = Math.sin(x * 0.7) * Math.cos(z * 0.9) + Math.sin(x * 0.23 + z * 0.31);
        if (clump < -0.6 && rnd() < 0.8) continue;
        items.push({ x, y: p.y + (opts.heightAt ? opts.heightAt(x, z) : 0), z });
      }
    }
    // shuffled, so drawing only the first N instances (lower quality) thins the field evenly
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    const count = Math.min(items.length, opts.max ?? 40000);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, vertexColors: false });
    windPatch(mat, 0.35, 'grass');
    applyFade(mat, 'life');
    const mesh = new THREE.InstancedMesh(bladeGeometry(), mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    const base = new THREE.Color(opts.color ?? 0x5f8f30);
    const tip = new THREE.Color(opts.tipColor ?? 0xd2dc78);
    const c = new THREE.Color();
    const h = opts.height ?? 0.4;
    for (let i = 0; i < count; i++) {
      const it = items[i];
      e.set((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35);
      q.setFromEuler(e);
      const hh = h * (0.55 + rnd() * 0.9);
      s.set(0.8 + rnd() * 0.8, hh, 1);
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q, s);
      mesh.setMatrixAt(i, m);
      c.copy(base).lerp(tip, rnd() * 0.6).multiplyScalar(0.8 + rnd() * 0.4);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.grassMeshes.push({ mesh, full: count });
    return mesh;
  }

  private grassMeshes: { mesh: THREE.InstancedMesh; full: number }[] = [];
  /** Fraction of grass blades drawn (quality setting). */
  setDensity(f: number) {
    for (const g of this.grassMeshes) g.mesh.count = Math.max(1, Math.floor(g.full * f));
  }

  /** Small glowing flowers scattered through grass patches. */
  flowers(patches: Patch[], opts: { seed?: number; perM2?: number; colors?: number[]; heightAt?: (x: number, z: number) => number } = {}) {
    const rnd = mulberry32(opts.seed ?? 29);
    const colors = (opts.colors ?? [0xff8fb8, 0xffd36a, 0x9fd8ff, 0xffffff, 0xd9a0ff]).map((h) => new THREE.Color(h));
    const pts: { x: number; y: number; z: number }[] = [];
    for (const p of patches) {
      const n = Math.round(Math.abs(p.x1 - p.x0) * Math.abs(p.z1 - p.z0) * (opts.perM2 ?? 0.35));
      for (let i = 0; i < n; i++) {
        const x = p.x0 + rnd() * (p.x1 - p.x0);
        const z = p.z0 + rnd() * (p.z1 - p.z0);
        pts.push({ x, y: p.y + (opts.heightAt ? opts.heightAt(x, z) : 0), z });
      }
    }
    // a flower = a short stem and a bright star-shaped head (two crossed quads)
    const head = new THREE.PlaneGeometry(0.16, 0.16);
    head.rotateX(-Math.PI / 2);
    head.translate(0, 0.28, 0);
    const head2 = head.clone();
    head2.rotateY(Math.PI / 4);
    const geo = mergeGeos([head, head2]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.6, side: THREE.DoubleSide });
    // emissive follows the instance colour so each flower glows in its own hue
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_INSTANCING_COLOR
          totalEmissiveRadiance += vColor * 1.6;
        #endif`,
      );
    };
    mat.customProgramCacheKey = () => 'flower';
    windPatch(mat, 0.15, 'flowerwind');
    applyFade(mat, 'life');
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sc = 0.7 + rnd() * 0.8;
      m.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), new THREE.Vector3(sc, sc, sc));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colors[Math.floor(rnd() * colors.length)]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  /** A cloud of glowing blossoms filling a tree crown (ellipsoid around cx, cy, cz). */
  blossoms(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, seed = 41) {
    const rnd = mulberry32(seed);
    const quad = new THREE.PlaneGeometry(0.22, 0.22);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd0e0, emissive: 0xff9ec4, emissiveIntensity: 0.9, roughness: 0.7, side: THREE.DoubleSide });
    windPatch(mat, 0.0, 'blossom');
    applyFade(mat, 'life');
    const mesh = new THREE.InstancedMesh(quad, mat, count);
    const m = new THREE.Matrix4();
    const tint = [new THREE.Color(0xffe4ee), new THREE.Color(0xffb6d0), new THREE.Color(0xfff1c8)];
    for (let i = 0; i < count; i++) {
      // denser toward the outside of the crown, like real foliage
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 8; k++) {
        x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1;
        const r = x * x + y * y + z * z;
        if (r < 1 && r > 0.25) break;
      }
      const sc = 0.6 + rnd() * 1.1;
      m.compose(new THREE.Vector3(cx + x * rx, cy + y * ry, cz + z * rz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)), new THREE.Vector3(sc, sc, sc));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tint[Math.floor(rnd() * tint.length)]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  /** Fireflies wandering around anchor points (only once life is restored). */
  fireflyCloud(cx: number, cy: number, cz: number, spread: number, count: number, seed = 5) {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const sd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = cx + (rnd() - 0.5) * spread;
      pos[i * 3 + 1] = cy + rnd() * 3;
      pos[i * 3 + 2] = cz + (rnd() - 0.5) * spread * 0.6;
      sd[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const pts = new THREE.Points(g, this.flyMat);
    pts.frustumCulled = false;
    this.fireflies.push(pts);
    this.group.add(pts);
    return pts;
  }
}

function mergeGeos(gs: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of gs) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const u = g.attributes.uv.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) nrm.push(n[i]);
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    const ix = g.index ? g.index.array : [...Array(p.length / 3).keys()];
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
