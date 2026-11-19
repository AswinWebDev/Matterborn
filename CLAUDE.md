# Matterborn: project rules

Hackathon entry for the Manycore Aholo Global 3D AI Hackathon. Hard deadline: **19 Nov 2026, 6:00 a.m. EST
(4:30 p.m. IST)**. Rules and scoring are in `docs/HACKATHON_BRIEF.md`; current state and next steps are in `docs/STATUS.md`.

## Invariants
- **Aholo Lux3D must stay central** (30% of the score). Prefer Lux3D-generated assets over hand-made ones; Blender is
  only for clean-up, optimisation and report renders, never for modelling core assets.
- **The game must never hard-fail on missing assets.** Every model has a procedural fallback; keep it that way.
- **Secrets:** API keys live only in `.env` (gitignored). Never print them, pass them as command arguments, write them to
  other files, or ask the user to paste them in chat.
- **Paid generation:** run `npm run gen -- <job> --dry` first, keep `--max-new` small, and never re-create a job that
  already has a task id in `pipeline/manifest.json` (rerun to resume, or use `--reclassify` to re-download for free).
- Do not touch `backups/` (the 2.5D fallback build).
- **No free camera** (the user's request): each area is seen only from its authored zone in `level1.ts`; never re-add
  mouse or right-stick orbit. Camera fixes go into the zones (pitch/distance/yaw) or `CameraRig`.
- **Puzzles must not be skippable:** `L.wall` auto-caps walls far above their top, `L.invisible` guards reach +30, gates
  get a lintel or `L.cap`, and wall jumps only chain between facing walls (`Player.canWallJump`). New barriers follow
  the same rules; check with a climbing bot.
- **Audio** is ElevenLabs (`pipeline/eleven.mjs`, key `ELEVENLABS_API_KEY` in `.env`): `--dry` first, it is
  resume-safe, and never run two generator processes at once (they overwrite `pipeline/audio-manifest.json`). Every
  sound must keep its procedural fallback in `audio/Audio.ts`.

## Working conventions
- Before calling a change done: `npm run typecheck` and `npm run build` must pass.
- The in-app browser pane is often hidden, which throttles requestAnimationFrame to about 1 fps. Test gameplay through
  `window.game.debug` (`step`, `play`, `move`, `hold`, `tap`, `teleport`, `skip`, `state`); use `play()` (async) for
  anything involving cutscenes, because synchronous `step()` never lets cutscene promises resume.
- Level geometry is axis-aligned boxes in `game/src/level/level1.ts`; after layout edits, re-run the scripted route
  for the affected section.
- Regression check after any gameplay or render change: run every `shots` route (altar, pound, push, charge, aqueduct,
  fire, glass, trial, colossus, escape) through `capture()` without video and check its outcome (see `docs/STATUS.md`).
- Look at changes as exact frames: `cap.snap(name)` / `cap.still(name)` write PNGs to `capture/`; screenshots of a hidden
  pane lag one frame behind. Editing a file under `game/` reloads the page, so never edit while a capture is running.
- Dev builds are silent; the production build plays audio. Close any production preview tab when done.
- Captures record sound only with `capture({ ..., audio: true })` (synced, rendered offline in `dev/AudioMix.ts`).

## Rendering invariants (each one cost a debugging session)
- Keep N8AO's transparency detection off (`autoDetectTransparency = false`): it re-renders the scene and empties the
  sun shadow map that the volumetric pass and dust read.
- Never use three's `transmission` on materials: it produced NaN frames that bloom spread to a black screen. Glass is a
  fresnel shell (`addRim`/`glassShell` in `actors/HeroVisual.ts`).
- Level lights are `VLight`s (`render/LightPool.ts`), never raw `PointLight`s, so the shaded light count stays fixed.
- The Aholo World splat backdrop only reads well from z ≤ ~15 around the valley (its near splats fill the frame closer).
- Entities that position themselves in `update()` must also be placed at load (the title screen does not run updates).
