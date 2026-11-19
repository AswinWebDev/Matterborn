// Scripted shots for the trailer, report stills and a smoke test of every highlight (dev only).
// Each shot puts the world into the state a real playthrough would have at that point, places
// Loam, and drives the real controls through the debug API, one frame at a time.
//
//   const cap = await capture({ width: 1280, height: 720, fps: 30 });
//   const S = await shots();
//   await S.review(cap, 'pound');          // records capture/shot_pound.mp4 + stills
//   await S.trailer(await capture());       // the edited trailer -> capture/trailer.mp4

import type { Capture, Caption } from './Capture';
import type { Form } from '../actors/forms';
import { setRestored } from '../render/MaterialFX';

type Cat = 'stone' | 'wood' | 'glass' | 'life';
const RESTORED_AFTER: Record<Form, Cat[]> = { clay: [], stone: ['stone'], wood: ['stone', 'wood', 'life'], glass: ['stone', 'wood', 'life', 'glass'] };
const FORMS_AFTER: Record<Form, Form[]> = { clay: ['clay'], stone: ['clay', 'stone'], wood: ['clay', 'stone', 'wood'], glass: ['clay', 'stone', 'wood', 'glass'] };

/** Put the world in the state reached after taking `progress`'s altar, and place Loam. */
async function setup(cap: Capture, progress: Form, at: [number, number, number], form: Form = 'clay', settle = 0.6) {
  const g = cap.game;
  const p = g.player;
  if (g.state === 'title') g.startGame();
  g.director.skip();
  g.debug.resetFlow();
  g.debug.release();
  g.debug.stop();
  for (const c of ['stone', 'wood', 'glass', 'life'] as const) setRestored(c, RESTORED_AFTER[progress].includes(c));
  for (const f of FORMS_AFTER[progress]) p.unlock(f);
  for (const [f, altar] of Object.entries(g.hooks.altars)) altar.reset(FORMS_AFTER[progress].includes(f as Form));
  p.dead = false;
  p.control = true;
  p.setForm(form, true);
  g.hero.setForm(form);
  g.debug.teleport(...at);
  p.respawn = { x: at[0], y: at[1], z: at[2] };
  await cap.skip(settle);
}

/** Steer toward a world point (call every frame). Returns true once within `r`. */
function steer(cap: Capture, x: number, z: number, r = 0.25, speed = 1) {
  const p = cap.game.player;
  const dx = x - p.cx;
  const dz = z - p.cz;
  const l = Math.hypot(dx, dz);
  if (l < r) {
    cap.game.debug.stop();
    return true;
  }
  cap.game.debug.move((dx / l) * speed, (dz / l) * speed);
  return false;
}

const S = (cap: Capture) => cap.game.debug.state();

// ------------------------------------------------------------------------------- the shots
export const shots: Record<string, (cap: Capture) => Promise<void>> = {
  /** Title, then the opening cutscene up to the MATTERBORN title card. */
  async intro(cap) {
    const g = cap.game;
    if (g.state !== 'title') throw new Error('intro must start from the title screen (reload first)');
    await cap.run(2.5);
    g.startGame();
    await cap.run(24);
  },

  /** The stone altar: Loam takes the first material and colour washes back over the hall. */
  async altar(cap) {
    await setup(cap, 'clay', [19, 4.85, -4]);
    let t = 0;
    while (!cap.game.director.running && t < 4) {
      steer(cap, 24, -6, 0.1);
      await cap.frame();
      t += 1 / cap.fps;
    }
    cap.game.debug.stop();
    await cap.run(8.5);
  },

  /** Stone pound through the cracked balcony floor into the chamber below. */
  async pound(cap) {
    await setup(cap, 'stone', [32.2, 4.85, -6], 'stone', 1.2);
    const d = cap.game.debug;
    await cap.run(1.1, () => void steer(cap, 34.5, -6, 0.12, 0.7));
    d.stop();
    await cap.run(0.25);
    d.hold('jump');
    await cap.run(0.3);
    d.hold('jump', false);
    d.tap('pound');
    await cap.run(2.6);
  },

  /** Only Stone can shove stone: push the block east to the lip, then south onto the plate. */
  async push(cap) {
    await setup(cap, 'stone', [35.9, -3, -6.5], 'stone');
    await cap.run(5.2, () => void cap.game.debug.move(1, 0));
    // round the block to its north side, then shove it south onto the plate
    const b = cap.game.level.blocks.find((k) => Math.abs(k.home.x - 37.5) < 0.1)!;
    const bx = () => b.body.x + b.body.w / 2;
    let phase = 0;
    await cap.run(9, () => {
      const p = cap.game.player;
      if (phase === 0 && steer(cap, p.cx, -8.6, 0.2)) phase = 1;
      else if (phase === 1 && steer(cap, bx(), -8.6, 0.12)) phase = 2;
      else if (phase === 2) cap.game.debug.move(0, 1);
    });
    // the second block: around it (never through it), shove it east to the lip, then north onto plate two
    const b2 = cap.game.level.blocks.find((k) => Math.abs(k.home.x - 44.5) < 0.1)!;
    const b2x = () => b2.body.x + b2.body.w / 2;
    const b2z = () => b2.body.z + b2.body.d / 2;
    let leg = 0;
    await cap.run(16, () => {
      if (leg === 0 && steer(cap, 47.5, 4.2, 0.2)) leg = 1;
      else if (leg === 1 && steer(cap, 43.0, 4.2, 0.2)) leg = 2;
      else if (leg === 2 && steer(cap, 43.0, b2z(), 0.1)) leg = 3;
      else if (leg === 3) {
        cap.game.debug.move(1, 0);
        if (b2x() > 50.7) leg = 4;
      } else if (leg === 4 && steer(cap, b2x() - 1.4, 3.7, 0.15)) leg = 5;
      else if (leg === 5 && steer(cap, b2x(), 3.7, 0.1)) leg = 6;
      else if (leg === 6) cap.game.debug.move(0, -1);
    });
  },

  /** Stone charge (Shift) through the cracked corridor wall. */
  async charge(cap) {
    await setup(cap, 'stone', [62.9, -3, 0.2], 'stone');
    const d = cap.game.debug;
    await cap.run(0.4, () => d.move(1, 0));
    d.hold('dash');
    await cap.run(1.0, () => d.move(1, 0));
    d.hold('dash', false);
    await cap.run(1.6, () => d.move(1, 0));
  },

  /** Stone sinks and walks under the aqueduct wall; Wood floats back up and swims out. */
  async aqueduct(cap) {
    await setup(cap, 'wood', [103, 2.4, 1], 'stone', 0.2);
    const d = cap.game.debug;
    await cap.run(2.4, () => d.move(0.4, 0));
    await cap.run(3.2, () => d.move(1, 0));
    d.tap('form3');
    await cap.run(2.4, () => d.move(0.3, 0));
    const jump = jumper(cap);
    await cap.run(4.5, () => {
      d.move(1, 0);
      if (cap.game.player.cx > 121.6) jump.double();
      jump.tick();
    });
  },

  /** Wood burns: a quick lesson at the fire trough. */
  async fire(cap) {
    await setup(cap, 'wood', [126.8, 4.25, 0.5], 'wood');
    await cap.run(2.8, () => cap.game.debug.move(1, 0));
  },

  /** The Prism Door: weigh the shutter plate, shove a block into the beam, turn it to Glass. */
  async glass(cap) {
    await setup(cap, 'glass', [160.3, 8.05, 5.2], 'stone');
    const g = cap.game;
    const d = g.debug;
    const blk = (hx: number) => g.level.blocks.find((k) => Math.abs(k.home.x - hx) < 0.1)!;
    const cx = (b: { body: { x: number; w: number } }) => b.body.x + b.body.w / 2;
    const cz = (b: { body: { z: number; d: number } }) => b.body.z + b.body.d / 2;
    const weight = blk(158.6);
    const lens = blk(165.2);
    // 1. the weight goes west until the lip stops it on the shutter plate
    await cap.run(4.5, () => (cx(weight) > 152.75 ? d.move(-1, 0) : d.stop()));
    // 2. round to the south of the other block and shove it north into the beam
    let leg = 0;
    await cap.run(10, () => {
      if (leg === 0 && steer(cap, 159.5, 7.0, 0.2)) leg = 1;
      else if (leg === 1 && steer(cap, cx(lens), 7.0, 0.15)) leg = 2;
      else if (leg === 2 && steer(cap, cx(lens), 5.25, 0.08, 0.5)) leg = 3;
      else if (leg === 3) {
        if (cz(lens) > -1.05) d.move(0, -1);
        else {
          d.stop();
          leg = 4;
        }
      }
    });
    d.stop();
    // 3. become Glass and pass it on: the light now goes through glass to the door
    d.tap('form4');
    await cap.run(0.4);
    d.tap('interact');
    await cap.run(2.0);
    leg = 0;
    await cap.run(5, () => {
      if (leg === 0 && steer(cap, cx(lens), 1.6, 0.25)) leg = 1;
      else if (leg === 1 && steer(cap, 172, 1.6, 0.3)) leg = 2;
    });
  },

  /** The Maker's Trial: charge, pound, swim as Wood, cross the fire as Clay, light the door with Glass. */
  async trial(cap) {
    await setup(cap, 'glass', [178.6, 8.05, 0], 'stone');
    const g = cap.game;
    const d = g.debug;
    const p = g.player;
    await cap.run(0.5, () => d.move(1, 0));
    d.hold('dash');
    await cap.run(0.9, () => d.move(1, 0));
    d.hold('dash', false);
    await cap.run(2.5, () => void steer(cap, 189.5, 0, 0.2));
    d.stop();
    d.hold('jump');
    await cap.run(0.25);
    d.hold('jump', false);
    d.tap('pound');
    await cap.run(1.6);
    // sink the floating crate onto the well's plate (Stone, then E beside the well): the far gate opens
    await cap.run(2.5, () => void steer(cap, 189.2, 3.15, 0.08, 0.6));
    d.stop();
    d.tap('interact');
    await cap.run(1.8);
    d.tap('form3');
    await cap.run(0.3);
    const jump = jumper(cap);
    await cap.run(10, () => {
      if (p.cx > 207.2 && p.body.y > 7.9) return void d.stop();
      d.move(1, 0);
      if ((p.cx > 198.4 && p.cx < 200.5 && p.body.y < 3) || (p.cx > 202.4 && p.cx < 206.2 && p.body.y < 7.9)) jump.double();
      jump.tick();
    });
    d.release();
    d.tap('form1');
    await cap.run(1.8, () => d.move(1, 0));
    let leg = 0;
    await cap.run(4, () => {
      if (leg === 0 && steer(cap, 213.6, 2.2, 0.2)) leg = 1;
      else if (leg === 1 && steer(cap, 216.55, 0, 0.06, 0.5)) leg = 2;
    });
    d.stop();
    d.tap('form4');
    await cap.run(0.5);
    d.tap('interact');
    await cap.run(2.0);
    leg = 0;
    await cap.run(5, () => {
      if (leg === 0 && steer(cap, 216.4, 2.4, 0.2)) leg = 1;
      else if (leg === 1 && steer(cap, 228, 1.5, 0.3)) leg = 2;
    });
  },

  /** The colossus wakes and the escape run begins. */
  async colossus(cap) {
    await setup(cap, 'glass', [230, 8.05, 0], 'clay');
    await cap.run(1.2, () => cap.game.debug.move(1, 0));
    cap.game.debug.stop();
    await cap.run(9.5);
  },

  /** The whole escape: gap, stone charge, wood swim, glass corridor, then the finale. */
  async escape(cap) {
    await setup(cap, 'glass', [230, 8.05, 0], 'clay');
    const g = cap.game;
    const d = g.debug;
    await cap.run(1.2, () => d.move(1, 0));
    d.stop();
    let t = 0;
    while (g.director.running || t < 0.5) {
      await cap.frame();
      t += 1 / cap.fps;
      if (t > 15) break;
    }
    await runEscape(cap, 40);
  },
};

/**
 * Jumps the way a player presses them: hold for the full height, release, then press again near
 * the apex for the double jump. Call double() to request one, tick() every frame.
 */
function jumper(cap: Capture) {
  const d = cap.game.debug;
  let phase = 0; // 0 idle, 1 holding first, 2 airborne, 3 holding second, 4 done
  let held = 0;
  return {
    double() {
      const p = cap.game.player;
      if (phase === 0 && (p.grounded || p.submerged > 0.2)) {
        phase = 1;
        held = 0;
        d.hold('jump');
      }
    },
    tick() {
      const p = cap.game.player;
      held += 1 / cap.fps;
      if (phase === 1 && held > 0.28) {
        d.hold('jump', false);
        phase = 2;
      } else if (phase === 2 && p.body.vy < 1.2) {
        d.hold('jump');
        phase = 3;
        held = 0;
      } else if (phase === 3 && held > 0.28) {
        d.hold('jump', false);
        phase = 4;
      } else if (phase === 4 && (p.grounded || p.submerged > 0.2)) phase = 0;
    },
    get busy() {
      return phase !== 0;
    },
  };
}

/** Drive Loam along the escape route until the finale starts (or `limit` seconds pass). */
async function runEscape(cap: Capture, limit: number) {
  const g = cap.game;
  const d = g.debug;
  const jump = jumper(cap);
  let t = 0;
  while (t < limit && !g.director.running && g.state === 'play') {
    const p = g.player;
    const x = p.cx;
    d.move(1, -p.cz * 0.4); // run east, drift back to the centre line
    if (x > 246.4 && x < 249) jump.double(); // the gap to the next ledge
    if (x > 256 && x < 264 && p.form !== 'stone' && !jump.busy) d.tap('form2');
    if (x > 259.5 && x < 262.2 && p.form === 'stone') d.hold('dash');
    else d.hold('dash', false);
    if (x > 264 && x < 272 && p.form === 'stone') d.tap('form1');
    if (x > 272 && x < 286 && p.form !== 'wood') d.tap('form3');
    if (x > 285.6 && x < 288.5) jump.double(); // out of the water onto the glass causeway
    if (x > 288.5 && p.form !== 'glass') d.tap('form4');
    jump.tick();
    await cap.frame();
    t += 1 / cap.fps;
  }
  d.stop();
  d.release();
}

/** Record frames while a black cut fades in (k: 0 → 1) or out. */
async function fadeCut(cap: Capture, sec: number, to: 0 | 1) {
  const from = cap.cut;
  await cap.run(sec, (t) => {
    cap.cut = from + (to - from) * Math.min(1, t / sec);
  });
  cap.cut = to;
}

/** Fade in from black over the first `sec` of whatever records next (works across a shot's setup). */
function fadeInNext(cap: Capture, sec = 0.35) {
  cap.cut = 1;
  const orig = cap.frame.bind(cap);
  cap.frame = async () => {
    cap.cut = Math.max(0, cap.cut - 1 / (cap.fps * sec));
    await orig();
    if (cap.cut <= 0) cap.frame = orig;
  };
}

/** Caption helper on the capture clock (seconds from now). */
function caption(cap: Capture, text: string, sub: string | undefined, from: number, dur: number, pos: Caption['pos'] = 'low', size?: number) {
  cap.captions.push({ text, sub, from: cap.clock + from, to: cap.clock + from + dur, pos, size });
}

/** The valley at sunrise, slowly drifting: the cold open and the closing shot. */
async function valleyShot(cap: Capture, sec: number, from: [number, number, number], to: [number, number, number], look: [number, number, number]) {
  const g = cap.game;
  g.player.heading = -Math.PI * 0.8;
  g.rig.setCinematic(true);
  g.rig.cinematic = 1;
  g.rig.cinFov = 48;
  g.renderer.setDof(true, g.rig.cinLook);
  g.hero.forceAnim('idle');
  g.rig.cinLook.set(...look);
  await cap.run(sec, (t) => {
    const k = t / sec;
    const e = k * k * (3 - 2 * k);
    g.rig.cinPos.set(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e);
  });
}

/**
 * The trailer: a cold open on the valley, the story, the material abilities, the colossus escape
 * and the finale, captioned with the Aholo pipeline behind each piece. Start from a fresh page on
 * the title screen:
 *   const cap = await capture({width:1920,height:1080,fps:30}); await (await shots()).trailer(cap)
 * `short` makes a ~60 s cut for social posts (no push/charge, shorter story and finale).
 */
export async function trailer(cap: Capture, opts: { name?: string; short?: boolean; bitrate?: number } = {}) {
  const g = cap.game;
  const short = !!opts.short;
  if (g.state !== 'title') throw new Error('start the trailer from the title screen (reload first)');
  for (let i = 0; i < 200 && !g.splatWorld.loaded; i++) await new Promise((r) => setTimeout(r, 100));
  await cap.begin(opts.name ?? (short ? 'teaser.mp4' : 'trailer.mp4'), opts.bitrate ?? 10_000_000);
  cap.showHints = false;
  cap.captions = [];
  const small = Math.round(cap.H * 0.034);
  try {
    // ---- cold open: the restored valley under an Aholo World sky
    g.startGame();
    g.director.skip();
    cap.showHud = false;
    await setup(cap, 'glass', [362, 0.05, 2], 'clay', 0.3);
    g.ui.titleCardShow('MATTERBORN', 'Play in 3D · Create with Aholo');
    g.audio.titleMusic(true);
    g.audio.play('titleBoom');
    await valleyShot(cap, short ? 3.6 : 4.4, [371, 3.2, 14], [368, 3.6, 12], [360, 4.2, -30]);
    g.ui.titleCardShow(null);
    await fadeCut(cap, 0.4, 1);
    // ---- the story: the faded workshop
    await setup(cap, 'clay', [0, 0.02, 0], 'clay', 0.2);
    g.debug.resetFlow();
    g.hero.forceAnim('lying');
    g.rig.setCinematic(true);
    g.rig.cinematic = 1;
    g.renderer.setDof(true, g.rig.cinLook);
    g.rig.cinFov = 44;
    g.rig.cinLook.set(-6, 2.5, -6);
    g.ui.story('Long ago, the Makers shaped the world from living matter.');
    g.audio.setMood('calm', 1.5);
    g.audio.say('vo_intro_1', 'interrupt');
    caption(cap, 'Every character, creature and prop is generated with Aholo Lux3D', undefined, 0.5, short ? 3.2 : 4.2, 'high', small);
    fadeInNext(cap, 0.5);
    await cap.run(short ? 3.6 : 4.6, (t) => void g.rig.cinPos.set(9 - t * 0.9, 9.5 - t * 0.35, 12 - t * 0.2));
    if (!short) {
      g.ui.story('When they vanished, everything they made faded back into clay.');
      g.audio.say('vo_intro_2');
      await cap.run(3.6, (t) => {
        g.rig.cinPos.set(-1 - t * 0.5, 3.6, 5 - t * 0.2);
        g.rig.cinLook.set(-1, 0.6, 0);
      });
    }
    g.ui.story(null);
    // ---- Loam wakes (hero close-up)
    const p = g.player;
    g.hero.forceAnim('wake');
    g.audio.play('loamWake');
    g.rig.cinLook.set(p.cx, 0.8, p.cz);
    caption(cap, 'Loam: Lux3D image → 3D → auto-rig → 30 retargeted animations', undefined, 0.4, short ? 3.4 : 4.4, 'low', small);
    await cap.run(short ? 3.8 : 4.8, (t) => void g.rig.cinPos.set(p.cx + 2.6 - t * 0.15, 1.2 + t * 0.12, p.cz + 2.8 - t * 0.1));
    g.hero.forceAnim(null);
    g.rig.setCinematic(false);
    g.renderer.setDof(false);
    await fadeCut(cap, 0.3, 1);
    cap.showHud = true;
    // ---- the first altar: stone, and the colour wave
    caption(cap, 'Take a material, and the world remembers it', undefined, 2.4, 4, 'high', Math.round(cap.H * 0.036));
    fadeInNext(cap);
    await shots.altar(cap);
    await fadeCut(cap, 0.3, 1);
    // ---- the abilities
    caption(cap, 'Stone pounds through cracked floors', 'debris: the Lux3D part split of the cracked slab', 0.3, 3.4);
    fadeInNext(cap);
    await shots.pound(cap);
    if (!short) {
      caption(cap, 'Only stone can move stone', undefined, 0.6, 4);
      await shots.push(cap);
      caption(cap, 'Charge through cracked walls', undefined, 0.3, 2.6);
      await shots.charge(cap);
    }
    caption(cap, 'Sink as stone · float as wood', 'wood block: Lux3D material transfer', 0.4, 5);
    await shots.aqueduct(cap);
    caption(cap, 'Glass lets the light through', 'pass your material to a block with E', 0.5, 4.6);
    await shots.glass(cap);
    if (!short) {
      // ---- the Maker's Trial: every form in turn
      await fadeCut(cap, 0.3, 1);
      caption(cap, "The Maker's Trial: every form, one after another", undefined, 0.4, 4.2, 'high', small);
      fadeInNext(cap);
      await shots.trial(cap);
    }
    await fadeCut(cap, 0.3, 1);
    // ---- the colossus and the escape
    caption(cap, 'Lux3D articulation: the colossus swings its own shoulder joint', undefined, 4.2, 4.6, 'high', small);
    fadeInNext(cap);
    await shots.escape(cap);
    // ---- the finale plays out in the valley (Aholo World splat backdrop)
    caption(cap, 'The valley beyond: a 3D Gaussian-splat world generated by Aholo World', undefined, 3.4, 5, 'high', Math.round(cap.H * 0.032));
    await cap.run(short ? 10 : 16);
    await fadeCut(cap, 0.4, 1);
    // ---- the Maker's Archive (title screen gallery): the generated assets themselves
    g.director.skip(); // let the finale script run to its end state before taking over
    await cap.skip(0.3);
    g.ui.credits(false);
    g.ui.titleCardShow(null);
    g.ui.story(null);
    g.ui.letterbox(false);
    g.ui.fade(0, 0.01);
    g.state = 'title';
    g.openArchive();
    cap.showHud = false;
    const exhibits: [string, string, string][] = [
      ['hero_rig', "The Maker's Archive: every model in the game is generated with Lux3D", 'Loam · humanoid auto-rig + 30 retargeted animations'],
      ['cr_colossus', 'Lux3D articulation', 'the colossus · URDF shoulder and neck joints'],
      ['cr_moth', 'Lux3D text → 3D + articulation', 'lantern moth · hinged wings'],
    ];
    for (const [i, [id, text, sub]] of exhibits.entries()) {
      const idx = g.archive.indexOf(id);
      if (idx < 0) continue;
      g.archive.index = idx;
      g.archive.next(0);
      await new Promise((r) => setTimeout(r, 600)); // let the model load (cached)
      caption(cap, text, sub, 0.15, short ? 2.1 : 2.7, 'low', small);
      if (i === 0) fadeInNext(cap, 0.4);
      await cap.run(short ? 2.3 : 2.9);
    }
    caption(cap, 'Built with Aholo Lux3D · Aholo World · three.js', 'press G on the title screen to browse the Archive   #Manycorehackathon', 0.1, 3.8, 'center', small);
    await cap.run(3.8);
    await fadeCut(cap, 0.8, 1);
    g.closeArchive();
  } finally {
    await cap.end();
  }
  return { seconds: +cap.clock.toFixed(1) };
}

/** Record one shot to capture/shot_<name>.mp4 with a still every `every` seconds. */
export async function review(cap: Capture, name: string, every = 1.5) {
  const shot = shots[name];
  if (!shot) throw new Error(`unknown shot ${name}`);
  await cap.begin(`shot_${name}.mp4`, 8_000_000);
  const stills: string[] = [];
  let next = 0;
  const orig = cap.frame.bind(cap);
  cap.frame = async () => {
    await orig();
    if (cap.clock >= next) {
      const n = `shot_${name}_${String(stills.length).padStart(2, '0')}`;
      await cap.still(n);
      stills.push(n);
      next += every;
    }
  };
  let error: unknown = null;
  const audit = auditCamera(cap);
  try {
    await shot(cap);
  } catch (err) {
    error = err;
  } finally {
    audit.stop(); // unwrap in reverse order of wrapping
    cap.frame = orig;
  }
  const saved = await cap.end();
  const result = { saved, stills, state: S(cap), error: error ? String(error) : null, occluded: audit.report() };
  // keep results on window too: long reviews can outlive the caller's await
  const w = window as unknown as { __reviews?: Record<string, unknown> };
  (w.__reviews ??= {})[name] = result;
  return result;
}

/**
 * Flags cinematic frames where rock sits between the camera and what it looks at, or the camera
 * is inside a wall. Returns spans of game time (seconds since the audit began).
 */
export function auditCamera(cap: Capture) {
  const g = cap.game;
  const spans: { from: number; to: number; inside: boolean }[] = [];
  let t = 0;
  let open: { from: number; to: number; inside: boolean } | null = null;
  const orig = cap.frame.bind(cap);
  cap.frame = async () => {
    await orig();
    t += 1 / cap.fps;
    const r = g.rig;
    if (r.cinematic < 0.95) {
      open = null;
      return;
    }
    const c = r.camera.position;
    const l = r.cinLook;
    const inside = g.world.colliders.some(
      (k) => k.enabled && k.kind === 'solid' && k.blocksCamera && c.x > k.x && c.x < k.x + k.w && c.y > k.y && c.y < k.y + k.h && c.z > k.z && c.z < k.z + k.d,
    );
    const dx = l.x - c.x;
    const dy = l.y - c.y;
    const dz = l.z - c.z;
    const d = Math.hypot(dx, dy, dz);
    const blocked = inside || (d > 1 && !!g.world.raycast(c.x, c.y, c.z, dx / d, dy / d, dz / d, d - 0.8, 'camera'));
    if (blocked) {
      if (!open) spans.push((open = { from: +t.toFixed(2), to: +t.toFixed(2), inside }));
      open.to = +t.toFixed(2);
    } else open = null;
  };
  return {
    stop: () => (cap.frame = orig),
    report: () => spans,
  };
}

export type { Caption };

/**
 * The X teaser (~28.5 s): a cinematic cut to the ElevenLabs score (tz_score), with the narrator's
 * teaser lines and trailer hits at fixed times, the game's own effects underneath, letterboxed.
 *   const cap = await capture({ width: 1920, height: 1080, fps: 30, audio: true }); await (await shots()).teaser(cap)
 */
export async function teaser(cap: Capture, opts: { name?: string } = {}) {
  const g = cap.game;
  const d = g.debug;
  const p = g.player;
  if (g.state !== 'title') throw new Error('start the teaser from the title screen (reload first)');
  for (let i = 0; i < 200 && !g.splatWorld.loaded; i++) await new Promise((r) => setTimeout(r, 100));
  cap.mix = {
    gameVoice: false,
    gameMusic: false,
    sfxScale: 0.75,
    ambScale: 0.3,
    score: { id: 'tz_score', t: 0, level: 1 },
    lines: [
      { id: 'tz_vo1', t: 0.7 },
      { id: 'tz_vo2', t: 6.45 },
      { id: 'tz_vo3', t: 8.75 },
      { id: 'tz_vo4', t: 12.3 },
      { id: 'tz_vo5', t: 13.85 },
      { id: 'tz_vo6', t: 15.1 },
      { id: 'tz_vo7', t: 24.7 },
    ],
    hits: [
      { id: 'tz_boom', t: 6.05, vol: 0.8 },
      { id: 'tz_whoosh', t: 12.05, vol: 0.5 },
      { id: 'tz_riser', t: 13.45, vol: 0.7 },
      { id: 'tz_braam', t: 16.25, vol: 0.9 },
      { id: 'tz_hit', t: 18.2, vol: 0.6 },
      { id: 'tz_hit', t: 20.0, vol: 0.6 },
      { id: 'tz_whoosh', t: 21.65, vol: 0.6 },
      { id: 'tz_final', t: 23.7, vol: 1 },
    ],
  };
  await cap.begin(opts.name ?? 'teaser_x.mp4', 16_000_000);
  cap.showHints = false;
  cap.showHud = false;
  cap.captions = [];
  cap.words = [];
  cap.bars = true;
  /** Record until the capture clock reaches `t`: absolute cut times keep the edit on the score. */
  const until = async (t: number, perFrame?: (k: number) => void) => {
    const t0 = cap.clock;
    while (cap.clock < t - 1e-6) {
      perFrame?.(cap.clock - t0);
      await cap.frame();
    }
  };
  /** Advance the game without recording (setting a shot up). */
  const quiet = async (sec: number, perFrame?: () => void) => {
    for (let i = 0; i < Math.round(sec * cap.fps); i++) {
      perFrame?.();
      await cap.skip(1 / cap.fps);
    }
  };
  const quietUntil = async (cond: () => boolean, max: number, perFrame?: () => void) => {
    for (let i = 0; i < max * cap.fps && !cond(); i++) {
      perFrame?.();
      await cap.skip(1 / cap.fps);
    }
  };
  const word = (text: string, from: number, to: number) => cap.words.push({ text, from, to });
  const cine = (on: boolean) => {
    g.rig.setCinematic(on);
    g.rig.cinematic = on ? 1 : 0;
    if (on) g.renderer.setDof(true, g.rig.cinLook);
    else g.renderer.setDof(false);
  };
  try {
    g.startGame();
    g.director.skip();
    // ---- A: the faded workshop (0 – 6.25)
    await setup(cap, 'clay', [0, 0.02, 0], 'clay', 0.2);
    d.resetFlow();
    g.hero.forceAnim('lying');
    cine(true);
    // the opening's own establishing shot: high and wide over the dark hall, light through the windows
    g.rig.cinFov = 50;
    g.rig.cinLook.set(-2, 3, -6);
    g.rig.cinPos.set(14, 12, 12);
    g.ui.story('Long ago, the Makers shaped everything from living matter.');
    fadeInNext(cap, 1.2);
    await until(6.25, (t) => {
      const e = -(Math.cos(Math.PI * Math.min(1, t / 6.25)) - 1) / 2;
      g.rig.cinPos.set(14 - 8 * e, 12 - 3 * e, 12);
      g.rig.cinLook.set(-2 - 4 * e, 3 - 0.5 * e, -6);
      g.rig.cinFov = 50 - 6 * e;
      if (t > 5.3) g.ui.story(null);
    });
    // ---- B: Loam, lying in the dust (6.25 – 8.6)
    g.ui.story('Then they vanished.');
    g.rig.cinFov = 36;
    await until(8.6, (t) => {
      g.rig.cinPos.set(p.cx + 1.9 - t * 0.12, 0.95 + t * 0.05, p.cz + 2.3 - t * 0.15);
      g.rig.cinLook.set(p.cx, 0.35, p.cz);
    });
    // ---- C: one small spark (8.6 – 12.2)
    g.ui.story('But one small spark remembered.');
    g.hero.forceAnim('wake');
    await until(12.2, (t) => {
      g.rig.cinPos.set(p.cx + 2.6 - t * 0.15, 1.2 + t * 0.12, p.cz + 2.8 - t * 0.1);
      g.rig.cinLook.set(p.cx, 0.8, p.cz);
      if (t < 1.6) g.fx.glow.emit({ x: p.cx + (Math.random() - 0.5) * 0.5, y: 0.4 + Math.random() * 0.7, z: p.cz + (Math.random() - 0.5) * 0.5, count: 2, speed: 0.8, color: 0xffb060, color2: 0xffffff, life: 0.9, size: 0.12 });
      if (t > 3.1) g.ui.story(null);
    });
    g.hero.forceAnim(null);
    g.ui.story(null);
    cine(false);
    // ---- D: STONE, the altar's colour wave (12.2 – 13.8)
    await setup(cap, 'clay', [22.6, 4.85, -5.7], 'clay', 0.1);
    cine(false);
    g.rig.snap(p.cx, p.body.y, p.cz);
    await quietUntil(() => g.director.running, 4, () => void steer(cap, 24, -6, 0.1));
    d.stop();
    await quiet(2.45);
    word('STONE', 12.25, 13.75);
    await until(13.8, () => g.ui.story(null));
    // ---- E: WOOD, a burst of wood and into the glowing water (13.8 – 15.05)
    g.director.skip();
    await setup(cap, 'wood', [94.6, 3.05, 0.3], 'clay', 0.15);
    cine(false);
    g.rig.snap(p.cx, p.body.y, p.cz);
    word('WOOD', 13.85, 15.0);
    let k = 0;
    await until(15.05, () => {
      if (k === 0) d.tap('form3');
      if (k === 6) d.hold('jump');
      if (k === 14) d.hold('jump', false);
      d.move(1, 0);
      k++;
    });
    d.stop();
    d.release();
    // ---- F: GLASS, the light passes through (15.05 – 16.25)
    await setup(cap, 'glass', [216.55, 8.05, 0], 'clay', 0.15);
    cine(false);
    g.rig.snap(p.cx, p.body.y, p.cz);
    p.faceTowards(218.3, 0);
    word('GLASS', 15.1, 16.2);
    k = 0;
    await until(16.25, () => {
      if (k === 0) d.tap('form4');
      if (k === 9) d.tap('interact');
      k++;
    });
    // ---- G: the big hit, Stone pounds through the floor (16.25 – 18.2)
    await setup(cap, 'stone', [34.5, 4.85, -6], 'stone', 0.3);
    cine(false);
    g.rig.snap(p.cx, p.body.y, p.cz);
    d.hold('jump');
    await quiet(0.25);
    d.hold('jump', false);
    d.tap('pound');
    await quiet(0.1);
    await until(18.2);
    // ---- H: the charge through the cracked wall (18.2 – 20.0)
    await setup(cap, 'stone', [63.3, -3, 0.2], 'stone', 0.2);
    cine(false);
    g.rig.snap(p.cx, p.body.y, p.cz);
    await quiet(0.12, () => d.move(1, 0));
    d.hold('dash');
    await until(20.0, () => d.move(1, 0));
    d.hold('dash', false);
    d.stop();
    // ---- I: the colossus rises (20.0 – 21.8)
    await setup(cap, 'glass', [231.2, 8.05, 0], 'clay', 0.2);
    cine(false);
    g.rig.snap(p.cx, p.body.y, p.cz);
    await quietUntil(() => g.director.running, 3, () => d.move(1, 0));
    d.stop();
    await quiet(3.4);
    await until(21.8, () => g.ui.story(null));
    // ---- J: run (21.8 – 24.0)
    await quietUntil(() => !g.director.running, 8);
    const jump = jumper(cap);
    const runStep = () => {
      d.move(1, -p.cz * 0.4);
      if (p.cx > 246.4 && p.cx < 249) jump.double();
      jump.tick();
    };
    await quiet(2.0, runStep);
    await until(24.0, runStep);
    d.stop();
    d.release();
    // ---- K: the title over the restored valley (24.0 – 28.5)
    g.director.skip();
    await setup(cap, 'glass', [362, 0.05, 2], 'clay', 0.3);
    g.ui.story(null);
    g.ui.titleCardShow('MATTERBORN', 'Become what the world needs');
    cap.captions.push({ text: 'Made with Aholo Lux3D and Aholo World', sub: '#Manycorehackathon', from: 25.7, to: 28.5, pos: 'low', size: Math.round(cap.H * 0.03) });
    p.heading = -Math.PI * 0.8;
    cine(true);
    g.rig.cinFov = 48;
    g.hero.forceAnim('idle');
    g.rig.cinLook.set(360, 4.2, -30);
    const from = [371, 3.2, 14];
    const to = [368, 3.6, 12];
    await until(28.5, (t) => {
      const kk = Math.min(1, t / 4.5);
      const e = kk * kk * (3 - 2 * kk);
      g.rig.cinPos.set(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e);
      if (t > 3.9) cap.cut = Math.min(1, (t - 3.9) / 0.6);
    });
  } finally {
    cap.bars = false;
    cap.words = [];
    await cap.end();
    cap.cut = 0;
    cap.mix = {};
  }
  return { seconds: +cap.clock.toFixed(2) };
}
