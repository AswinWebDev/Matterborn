// Dev only: jump to a named spot of the level in the state a real playthrough would have there,
// settle the camera and lighting, and leave the frame on screen for a look (works with the
// browser pane hidden).   await view('aqueduct')   ·   view('hall', { restored: false })

import type { Game } from '../Game';
import type { Form } from '../actors/forms';
import { setRestored } from '../render/MaterialFX';

type Cat = 'stone' | 'wood' | 'glass' | 'life';
const RESTORED_AFTER: Record<Form, Cat[]> = { clay: [], stone: ['stone'], wood: ['stone', 'wood', 'life'], glass: ['stone', 'wood', 'life', 'glass'] };
const FORMS_AFTER: Record<Form, Form[]> = { clay: ['clay'], stone: ['clay', 'stone'], wood: ['clay', 'stone', 'wood'], glass: ['clay', 'stone', 'wood', 'glass'] };

export const SPOTS: Record<string, { at: [number, number, number]; progress: Form; form?: Form; heading?: number }> = {
  atelier: { at: [2, 0.02, 2], progress: 'clay' },
  kiln: { at: [-6, 0.02, -2.5], progress: 'clay', heading: Math.PI },
  balcony: { at: [22, 4.87, -4], progress: 'stone' },
  court: { at: [44, -2.98, -2], progress: 'stone', form: 'stone' },
  plate: { at: [50, -2.98, 2], progress: 'stone', form: 'stone' },
  corridor: { at: [64, -2.98, 0], progress: 'stone', form: 'stone' },
  shaft: { at: [71.5, -2.98, 0], progress: 'stone' },
  aqueduct: { at: [84, 8.02, 1], progress: 'wood' },
  lake: { at: [99, 2.25, 1], progress: 'wood', form: 'wood' },
  under: { at: [106, -2.98, 0], progress: 'wood', form: 'stone' },
  fire: { at: [127, 4.22, 0.5], progress: 'wood' },
  hall: { at: [152, 8.02, 1], progress: 'glass', form: 'glass' },
  door: { at: [170, 8.02, 1], progress: 'glass' },
  causeway: { at: [243, 8.02, 0], progress: 'glass' },
  glasscause: { at: [296, 10.52, 0], progress: 'glass', form: 'glass' },
  valley: { at: [364, 0.02, 2], progress: 'glass' },
};

export async function view(g: Game, name: string, opts: { restored?: boolean; settle?: number } = {}) {
  const s = SPOTS[name];
  if (!s) throw new Error(`unknown view ${name}; one of ${Object.keys(SPOTS).join(', ')}`);
  const p = g.player;
  if (g.state === 'title') g.startGame();
  g.director.skip();
  g.debug.resetFlow();
  g.debug.release();
  g.debug.stop();
  g.rig.setCinematic(false);
  g.rig.cinematic = 0;
  g.renderer.setDof(false);
  g.ui.letterbox(false);
  const progress = opts.restored === false ? 'clay' : s.progress;
  for (const c of ['stone', 'wood', 'glass', 'life'] as const) setRestored(c, RESTORED_AFTER[progress].includes(c));
  for (const f of FORMS_AFTER[s.progress]) p.unlock(f);
  for (const [f, altar] of Object.entries(g.hooks.altars)) altar.reset(FORMS_AFTER[progress].includes(f as Form));
  p.dead = false;
  p.control = true;
  const form = s.form ?? 'clay';
  p.setForm(form, true);
  g.hero.setForm(form);
  g.debug.teleport(...s.at);
  if (s.heading !== undefined) p.heading = s.heading;
  p.respawn = { x: s.at[0], y: s.at[1], z: s.at[2] };
  g.mood.snap();
  g.debug.step(opts.settle ?? 1.2);
  // let the browser present the new frame (screenshots otherwise show the previous one)
  // (rAF never fires while the pane is hidden, so a timer caps the wait)
  await new Promise<void>((r) => {
    const t = setTimeout(r, 400);
    requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(t), r())));
  });
  return g.debug.state();
}
