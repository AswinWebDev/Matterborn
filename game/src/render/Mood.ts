// Lighting moods. Each area of the journey has its own sky, sun, air and colour grade, and the
// game blends between them as Loam travels, so the level reads as one continuous night:
// golden dusk in the Atelier, blue dusk over the Stone court, teal moonlight and mist on the
// aqueduct, crisp silver beams in the Hall of light, fire and dust in the escape, and a warm
// sunrise over the valley at the end.

import * as THREE from 'three';

export interface Mood {
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  skySun: number;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
  fogFalloff: number;
  fogBase: number;
  fogMax: number;
  sunGlow: number;
  sunColor: number;
  sunIntensity: number;
  /** Direction toward the sun (normalised on use). */
  sunFrom: [number, number, number];
  vol: number;
  volOutside: number;
  volFalloff: number;
  volBase: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  rimColor: number;
  rimIntensity: number;
  exposure: number;
  saturation: number;
  contrast: number;
  shadowTint: number;
  highTint: number;
  split: number;
  bloom: number;
  bloomThreshold: number;
  vignette: number;
  envIntensity: number;
}

const atelier: Mood = {
  skyTop: 0x0b1530,
  skyMid: 0x2a3c66,
  skyHorizon: 0xf0a060,
  skySun: 0xffc27a,
  fogNear: 0x1d2236,
  fogFar: 0x4a5170,
  fogDensity: 0.018,
  fogFalloff: 0.09,
  fogBase: 0,
  fogMax: 0.85,
  sunGlow: 0x7a4a22,
  sunColor: 0xffc48a,
  sunIntensity: 3.6,
  sunFrom: [-0.22, 0.74, -0.64],
  vol: 0.9,
  volOutside: 0.04,
  volFalloff: 0.05,
  volBase: 0,
  hemiSky: 0x6478b4,
  hemiGround: 0x33231a,
  hemiIntensity: 0.8,
  rimColor: 0x86c4ff,
  rimIntensity: 0.9,
  exposure: 1.05,
  saturation: 1.08,
  contrast: 1.06,
  shadowTint: 0x6a7ca6,
  highTint: 0xa08466,
  split: 0.32,
  bloom: 1.15,
  bloomThreshold: 0.72,
  vignette: 0.6,
  envIntensity: 0.35,
};

const court: Mood = {
  ...atelier,
  skyTop: 0x080f26,
  skyMid: 0x1e2c55,
  skyHorizon: 0xb46a7a,
  skySun: 0xff9a8a,
  fogNear: 0x141a2e,
  fogFar: 0x2f3a5c,
  fogDensity: 0.02,
  fogFalloff: 0.07,
  fogBase: -3,
  sunGlow: 0x4a3050,
  sunColor: 0xffb4a0,
  sunIntensity: 2.6,
  sunFrom: [-0.3, 0.8, -0.6],
  vol: 0.75,
  volBase: -3,
  hemiSky: 0x6476b8,
  hemiGround: 0x2e2020,
  hemiIntensity: 1.0,
  rimColor: 0x9fb8ff,
  rimIntensity: 1.0,
  exposure: 1.28,
  shadowTint: 0x5e6ea8,
  highTint: 0xa88070,
  split: 0.36,
  bloom: 1.25,
};

const aqueduct: Mood = {
  ...atelier,
  skyTop: 0x06141f,
  skyMid: 0x123848,
  skyHorizon: 0x5aa0a0,
  skySun: 0xbfefff,
  fogNear: 0x0f2a33,
  fogFar: 0x2c5e68,
  fogDensity: 0.03,
  fogFalloff: 0.18,
  fogBase: 2.4,
  fogMax: 0.8,
  sunGlow: 0x2a5a60,
  sunColor: 0xa8dcff,
  sunIntensity: 2.4,
  sunFrom: [-0.25, 0.82, -0.52],
  vol: 0.75,
  volOutside: 0.04,
  volFalloff: 0.06,
  volBase: 0,
  hemiSky: 0x3f8494,
  hemiGround: 0x10221e,
  hemiIntensity: 0.7,
  rimColor: 0x8ff3e4,
  rimIntensity: 1.1,
  exposure: 1.15,
  saturation: 1.14,
  contrast: 1.07,
  shadowTint: 0x4f8a96,
  highTint: 0x9aa486,
  split: 0.34,
  bloom: 1.3,
  bloomThreshold: 0.68,
};

const hall: Mood = {
  ...atelier,
  skyTop: 0x0a1426,
  skyMid: 0x2a4566,
  skyHorizon: 0x9fd0e6,
  skySun: 0xe6f6ff,
  fogNear: 0x16222f,
  fogFar: 0x4d6378,
  fogDensity: 0.016,
  fogFalloff: 0.07,
  fogBase: 8,
  sunGlow: 0x3a5a6a,
  sunColor: 0xe4f4ff,
  sunIntensity: 3.2,
  sunFrom: [-0.28, 0.8, -0.56],
  vol: 1.35,
  volBase: 8,
  hemiSky: 0x5a7eaa,
  hemiGround: 0x1c1c24,
  hemiIntensity: 0.62,
  rimColor: 0x9ff3ff,
  rimIntensity: 1.1,
  exposure: 1.1,
  saturation: 1.06,
  shadowTint: 0x5a7aa0,
  highTint: 0x9c9888,
  bloom: 1.35,
  envIntensity: 0.45,
};

const escape: Mood = {
  ...atelier,
  skyTop: 0x0a0507,
  skyMid: 0x26100c,
  skyHorizon: 0xc8541f,
  skySun: 0xffa060,
  fogNear: 0x1e0f0c,
  fogFar: 0x402016,
  fogDensity: 0.007,
  fogFalloff: 0.04,
  fogBase: 4,
  fogMax: 0.55,
  sunGlow: 0x8a3a12,
  sunColor: 0xff9a5c,
  sunIntensity: 3.0,
  sunFrom: [0.45, 0.62, -0.64],
  vol: 0.4,
  volOutside: 0.04,
  volBase: 6,
  hemiSky: 0x7a4a5a,
  hemiGround: 0x2a120a,
  hemiIntensity: 0.6,
  rimColor: 0xffb070,
  rimIntensity: 1.0,
  exposure: 1.02,
  saturation: 1.12,
  contrast: 1.16,
  shadowTint: 0x5a6a90,
  highTint: 0xb0784e,
  split: 0.4,
  bloom: 1.45,
  bloomThreshold: 0.66,
};

const valley: Mood = {
  ...atelier,
  skyTop: 0x2f5f9e,
  skyMid: 0x86b2dc,
  skyHorizon: 0xffcf96,
  skySun: 0xfff0c8,
  fogNear: 0x8aa3bd,
  fogFar: 0xb9c9dc,
  fogDensity: 0.0024,
  fogFalloff: 0.03,
  fogBase: 0,
  fogMax: 0.45,
  sunGlow: 0xffd7a0,
  sunColor: 0xffe2b4,
  sunIntensity: 3.8,
  sunFrom: [-0.35, 0.42, -0.84],
  vol: 0.12,
  volOutside: 0.02,
  volFalloff: 0.03,
  volBase: 0,
  hemiSky: 0x9cc0ea,
  hemiGround: 0x4a3a22,
  hemiIntensity: 1.15,
  rimColor: 0xfff0d0,
  rimIntensity: 0.8,
  exposure: 0.95,
  saturation: 1.18,
  contrast: 1.12,
  shadowTint: 0x6a80a8,
  highTint: 0xa89070,
  split: 0.28,
  bloom: 0.8,
  bloomThreshold: 0.85,
  vignette: 0.45,
  envIntensity: 0.9,
};

/** The Maker's Archive studio (title screen gallery), far below the level. */
const archive: Mood = {
  ...atelier,
  skyTop: 0x05060a,
  skyMid: 0x0b0d14,
  skyHorizon: 0x1a1612,
  skySun: 0x302418,
  fogNear: 0x0c0d12,
  fogFar: 0x0c0d12,
  fogDensity: 0.012,
  fogFalloff: 0.0,
  fogBase: -400,
  fogMax: 0.9,
  sunGlow: 0x000000,
  sunColor: 0xffe6c8,
  sunIntensity: 2.4,
  sunFrom: [0.45, 0.8, 0.55],
  vol: 0.25,
  volOutside: 0.0,
  volFalloff: 0.0,
  volBase: -400,
  hemiSky: 0x6a7090,
  hemiGround: 0x201a14,
  hemiIntensity: 0.55,
  rimColor: 0x9fc8ff,
  rimIntensity: 1.2,
  exposure: 1.1,
  saturation: 1.08,
  contrast: 1.08,
  split: 0.25,
  bloom: 0.9,
  bloomThreshold: 0.8,
  vignette: 0.7,
  envIntensity: 0.75,
};

export const MOODS = { atelier, court, aqueduct, hall, escape, valley, archive };
export type MoodName = keyof typeof MOODS;

/** x ranges of the journey (the route runs along +x). */
const BANDS: { x: number; mood: MoodName }[] = [
  { x: -1e9, mood: 'atelier' },
  { x: 16, mood: 'court' },
  { x: 77, mood: 'aqueduct' },
  { x: 140, mood: 'hall' },
  { x: 228, mood: 'escape' },
  { x: 333, mood: 'valley' },
];
const BLEND = 6; // metres over which neighbouring moods cross-fade

const colorKeys = ['skyTop', 'skyMid', 'skyHorizon', 'skySun', 'fogNear', 'fogFar', 'sunGlow', 'sunColor', 'hemiSky', 'hemiGround', 'rimColor', 'shadowTint', 'highTint'] as const;
const numKeys = [
  'fogDensity',
  'fogFalloff',
  'fogBase',
  'fogMax',
  'sunIntensity',
  'vol',
  'volOutside',
  'volFalloff',
  'volBase',
  'hemiIntensity',
  'rimIntensity',
  'exposure',
  'saturation',
  'contrast',
  'split',
  'bloom',
  'bloomThreshold',
  'vignette',
  'envIntensity',
] as const;

export type MoodColors = Record<(typeof colorKeys)[number], THREE.Color>;
export type MoodNums = Record<(typeof numKeys)[number], number>;

/** A blended mood with live THREE colours, eased over time toward the target. */
export class MoodState {
  readonly c = Object.fromEntries(colorKeys.map((k) => [k, new THREE.Color()])) as MoodColors;
  readonly n = Object.fromEntries(numKeys.map((k) => [k, 0])) as MoodNums;
  readonly sunFrom = new THREE.Vector3(0, 1, 0);
  /** When set, this mood wins regardless of position (cutscenes). */
  override: MoodName | null = null;
  private first = true;
  private tc = new THREE.Color();
  private target = { c: Object.fromEntries(colorKeys.map((k) => [k, new THREE.Color()])) as MoodColors, n: { ...this.n }, sun: new THREE.Vector3() };

  /** Weights of the bands around x. */
  static weights(x: number): { mood: MoodName; w: number }[] {
    let i = 0;
    while (i + 1 < BANDS.length && x >= BANDS[i + 1].x) i++;
    const cur = BANDS[i];
    const next = BANDS[i + 1];
    // cross-fade over BLEND metres on either side of every band edge (k = 0.5 exactly at the edge)
    if (next && x > next.x - BLEND) {
      const k = THREE.MathUtils.smoothstep(x, next.x - BLEND, next.x + BLEND);
      return [
        { mood: cur.mood, w: 1 - k },
        { mood: next.mood, w: k },
      ];
    }
    if (i > 0 && x < cur.x + BLEND) {
      const k = THREE.MathUtils.smoothstep(x, cur.x - BLEND, cur.x + BLEND);
      return [
        { mood: BANDS[i - 1].mood, w: 1 - k },
        { mood: cur.mood, w: k },
      ];
    }
    return [{ mood: cur.mood, w: 1 }];
  }

  update(dt: number, x: number) {
    const ws = this.override ? [{ mood: this.override, w: 1 }] : MoodState.weights(x);
    const t = this.target;
    for (const k of colorKeys) t.c[k].setRGB(0, 0, 0);
    for (const k of numKeys) t.n[k] = 0;
    t.sun.set(0, 0, 0);
    for (const { mood, w } of ws) {
      const m = MOODS[mood];
      for (const k of colorKeys) t.c[k].add(this.tc.setHex(m[k]).multiplyScalar(w));
      for (const k of numKeys) t.n[k] += m[k] * w;
      t.sun.add(new THREE.Vector3(...m.sunFrom).normalize().multiplyScalar(w));
    }
    t.sun.normalize();
    const k = this.first ? 1 : 1 - Math.exp(-dt * 1.6);
    this.first = false;
    for (const key of colorKeys) this.c[key].lerp(t.c[key], k);
    for (const key of numKeys) this.n[key] += (t.n[key] - this.n[key]) * k;
    this.sunFrom.lerp(t.sun, k).normalize();
  }

  /** Jump straight to the target (teleports, cuts). */
  snap() {
    this.first = true;
  }
}
