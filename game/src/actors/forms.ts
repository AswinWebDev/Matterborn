// The four materials Loam can become. Each one changes how the golem moves and what it can do.

export type Form = 'clay' | 'stone' | 'wood' | 'glass';

export interface FormSpec {
  id: Form;
  label: string;
  /** Short line shown when the form is first gained. */
  blurb: string;
  runSpeed: number;
  jumpHeight: number;
  doubleJump: boolean;
  gravityScale: number;
  maxFall: number;
  wallGrip: number; // max slide speed when hugging a wall (0 = cannot wall slide)
  dash: 'roll' | 'charge' | 'none';
  /** In water: 'float' (swims on top), 'sink' (walks the bottom), 'melt' (dissolves). */
  water: 'float' | 'sink' | 'melt';
  heavy: boolean; // presses plates, breaks cracked floors with a ground pound
  burns: boolean;
  passesLight: boolean;
  /** Landing faster than this shatters the golem (glass). */
  shatterSpeed: number;
  /** Look: tint for the procedural/fallback material and the transform flash. */
  color: number;
  emissive: number;
  roughness: number;
  metalness: number;
  transmission: number;
}

export const FORMS: Record<Form, FormSpec> = {
  clay: {
    id: 'clay',
    label: 'Clay',
    blurb: 'Soft clay. Light on its feet, but water melts it.',
    runSpeed: 6.2,
    jumpHeight: 2.35,
    doubleJump: true,
    gravityScale: 1,
    maxFall: 20,
    wallGrip: 2.6,
    dash: 'roll',
    water: 'melt',
    heavy: false,
    burns: false,
    passesLight: false,
    shatterSpeed: Infinity,
    color: 0xc8714a,
    emissive: 0xff9a3c,
    roughness: 0.85,
    metalness: 0,
    transmission: 0,
  },
  stone: {
    id: 'stone',
    label: 'Stone',
    blurb: 'Heavy stone. Pound through cracked floors, hold down switches, sink to the bottom.',
    runSpeed: 4.4,
    jumpHeight: 1.35,
    doubleJump: false,
    gravityScale: 1.4,
    maxFall: 32,
    wallGrip: 0,
    dash: 'charge',
    water: 'sink',
    heavy: true,
    burns: false,
    passesLight: false,
    shatterSpeed: Infinity,
    color: 0x8d8f93,
    emissive: 0xffb347,
    roughness: 0.95,
    metalness: 0,
    transmission: 0,
  },
  wood: {
    id: 'wood',
    label: 'Wood',
    blurb: 'Light wood. Leap higher and float on water, but keep away from fire.',
    runSpeed: 6.7,
    jumpHeight: 2.75,
    doubleJump: true,
    gravityScale: 0.88,
    maxFall: 15,
    wallGrip: 2.0,
    dash: 'roll',
    water: 'float',
    heavy: false,
    burns: true,
    passesLight: false,
    shatterSpeed: Infinity,
    color: 0xb07a45,
    emissive: 0xffc070,
    roughness: 0.7,
    metalness: 0,
    transmission: 0,
  },
  glass: {
    id: 'glass',
    label: 'Glass',
    blurb: 'Clear glass. Light passes straight through you, but hard landings shatter you.',
    runSpeed: 6.4,
    jumpHeight: 2.45,
    doubleJump: true,
    gravityScale: 1,
    maxFall: 20,
    wallGrip: 3.2,
    dash: 'roll',
    water: 'sink',
    heavy: false,
    burns: false,
    passesLight: true,
    shatterSpeed: 23,
    color: 0xbff4ff,
    emissive: 0x7fe9ff,
    roughness: 0.05,
    metalness: 0,
    transmission: 0, // glass is drawn as a glossy translucent shell, not with three's transmission pass
  },
};

export const FORM_ORDER: Form[] = ['clay', 'stone', 'wood', 'glass'];
