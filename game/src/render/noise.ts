// Small deterministic noise helpers and procedural canvas textures.
import * as THREE from 'three';

// --- seeded PRNG ------------------------------------------------------------------------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 3D simplex noise (Stefan Gustavson's reference, compacted) ----------------------------
const grad3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const perm = new Uint8Array(512);
{
  const rnd = mulberry32(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const F3 = 1 / 3;
const G3 = 1 / 6;
export function simplex3(x: number, y: number, z: number): number {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else {
    if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const corner = (gx: number, gy: number, gz: number, g: number) => {
    let tt = 0.6 - gx * gx - gy * gy - gz * gz;
    if (tt < 0) return 0;
    tt *= tt;
    const gi = (g % 12) * 3;
    return tt * tt * (grad3[gi] * gx + grad3[gi + 1] * gy + grad3[gi + 2] * gz);
  };
  const n0 = corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]]);
  const n1 = corner(x1, y1, z1, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]);
  const n2 = corner(x2, y2, z2, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]);
  const n3 = corner(x3, y3, z3, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]);
  return 32 * (n0 + n1 + n2 + n3);
}

export function fbm3(x: number, y: number, z: number, octaves = 4) {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += a * simplex3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return sum;
}

// --- canvas textures ---------------------------------------------------------------------
function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, img: ImageData) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  draw(ctx, img);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable soft cloud noise for fog cards (alpha in the red channel). */
export function makeFogTexture(size = 256, seed = 1) {
  return canvasTex(size, (ctx, img) => {
    const d = img.data;
    const s = seed * 17.3;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // sample on a torus so the texture tiles
        const u = (x / size) * Math.PI * 2;
        const v = (y / size) * Math.PI * 2;
        const n = fbm3(Math.cos(u) * 1.2 + s, Math.sin(u) * 1.2 + Math.cos(v) * 1.2, Math.sin(v) * 1.2 + s, 5);
        const val = Math.max(0, Math.min(1, n * 0.9 + 0.5));
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.pow(val, 1.6) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, false);
}

/** Round soft sprite for particles. */
export function makeSoftDot(size = 64) {
  return canvasTex(size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // close to a gaussian falloff: no visible disc edge when sprites pile up
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }, false);
}

/** Vertical gradient used by light shafts: bright at the top, fading out. */
export function makeShaftTexture(w = 64, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const gv = ctx.createLinearGradient(0, 0, 0, h);
  gv.addColorStop(0, 'rgba(255,255,255,0.9)');
  gv.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gv.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gv;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  const gh = ctx.createLinearGradient(0, 0, w, 0);
  gh.addColorStop(0, 'rgba(0,0,0,0)');
  gh.addColorStop(0.5, 'rgba(0,0,0,1)');
  gh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gh;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Fallback stone albedo until Lux3D swatches are available. */
export function makeStoneTexture(size = 256, tint: [number, number, number] = [128, 122, 112]) {
  const tex = canvasTex(size, (ctx, img) => {
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2;
        const v = (y / size) * Math.PI * 2;
        const n = fbm3(Math.cos(u) * 2, Math.sin(u) * 2 + Math.cos(v) * 2, Math.sin(v) * 2, 5);
        const cracks = Math.abs(simplex3(Math.cos(u) * 4, Math.sin(v) * 4, Math.sin(u) * 4 + Math.cos(v) * 4));
        const crack = cracks < 0.025 ? 0.78 : 1;
        const k = (0.86 + n * 0.22) * crack;
        const i = (y * size + x) * 4;
        d[i] = Math.min(255, tint[0] * k);
        d[i + 1] = Math.min(255, tint[1] * k);
        d[i + 2] = Math.min(255, tint[2] * k);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
