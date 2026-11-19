# Matterborn: build status

_Updated 19 Nov 2026, 14:52 IST. **Deadline: 19 Nov 2026, 4:30 p.m. IST (6:00 a.m. EST).** Aholo credits expired 19 Nov 10:59 a.m. ET._

## Current state (14:52 IST)
- Game complete and verified at 14:00–14:06: typecheck, build, `npm test` (11/11) pass; all **10** scripted routes pass
  (altar, pound, push, charge, aqueduct, fire, glass, trial, colossus, escape → finale); production build boots with no
  console errors and plays its audio. Zip rebuilt 14:06 (`deliverables/matterborn-web.zip`, 192 files, 36 MB).
- Team **DarkArtsAsh** (Aswin Vinod, solo). The user also has a team code for the form (in chat; not written to files).
- **Hosted** (14:40): https://modelscope.ai/studios/DarkArtsAsh/matterborn (public ModelScope Studio, static SDK, free
  CPU; full-window view `?mode=full`). Report regenerated with the play link (video: "in our X post") and copied to
  `deliverables/`. Not done: the X post and the form (the user does both). The user may report more bugs: fix,
  re-run routes, rebuild, rezip, and push the new `dist/` to the Studio (see "Hosting" below).
- **Source** (15:07): public at https://github.com/AswinWebDev/Matterborn (`main`, pushed over SSH as AswinWebDev).
  `.claude/`, `NEXT_SESSION_PROMPT.md` and the placeholder report are gitignored. The report links the X post.
- The newest round ("Fifth playtest note") is directly below; the day's earlier rounds follow it.

## Hosting on ModelScope (19 Nov, 14:15–14:50 IST)
- Account **DarkArtsAsh** on modelscope.ai (Google sign-in by the user; username chosen by the user). Studio
  `DarkArtsAsh/matterborn`: public, Apache 2.0, description, cover = `docs/report/img/report_cover.jpg` (1280 px).
- The game is served from `https://darkartsash-matterborn.ms.fun/` inside the Studio page; opening that host directly
  redirects to the Studio page (`?mode=full`), so share the Studio link. Checked without cookies: Studio page, index,
  bundles, the 8 MB splat and audio all return 200; in the browser pane the game loads to its title screen inside the
  Studio. Synthetic clicks could not reach the cross-origin game frame from the pane's tools, so play was not driven
  there (the user should click into it once).
- Token: `MODELSCOPE_TOKEN` in `.env` (copied from the Studio's git dialog straight to `.env`, never printed).
- **Redeploy after a fix:** `npm run build`, then in a scratch clone of `https://www.modelscope.ai/studios/DarkArtsAsh/matterborn.git`
  (git credential helper that prints `username=oauth2` and `password=` + the token read from `.env` at run time;
  never put the token in a URL or argument): `rsync -a --delete --exclude .git --exclude README.md --exclude .gitattributes dist/ <clone>/`,
  commit, `git push origin master`. ModelScope rebuilds the static Studio by itself (or Manage → Redeploy). The
  repo's `README.md` holds the Studio card front matter (`deployspec.entry_file: index.html`); keep it.

## Fifth playtest note (19 Nov, ~14:00 IST): Esc menu, Prism Door hints
- **Esc did not open the pause menu.** `Game.advance` checked the `pause` press once per rendered frame, but the press
  edge lives for one fixed step (1/120 s) and a 60 Hz frame runs two, so the check saw a cleared edge. The check now
  runs inside `fixedUpdate`, right after `input.update`. Esc (or gamepad Start) now also pauses during cutscenes: the
  menu then shows **Skip scene** instead of **Back to last shrine** (`#pause.cutscene` in `style.css`). Pausing
  suspends the AudioContext (`Audio.setPaused`), so narration and score hold in step with the paused script. Esc no
  longer doubles as "skip" (hold Enter, or gamepad B). Leaving fullscreen with Esc (which the page never sees) opens
  the menu too (`fullscreenchange` in `main.ts`). The title controls list Esc.
- **Prism Door hints.** The user stood by the block in the beam and could not tell what to do. Hint zones over the
  blocks (x 160–176) now say the next step, from the state of the room: free the light (block onto the shutter's
  plate) → shove the other block into the light → become Glass (4) and press E beside it → hold the plate down if
  it was released. They go away once the door is lit. No narrator lines for these (text only).
- **Bug found while testing:** the shutter is a portcullis, and portcullis colliders let light through, so the plate
  did nothing: one glass block in the beam opened the door. The shutter now blocks light (`blocksLight = true` in
  level1), as the room was designed and as the `glass` route plays it.
- Verified: dev (debug API: Esc on 6-step and 60 Hz frames, in play and in a cutscene; Skip scene; all four hint
  stages; shutter holds the beam at 2.5 until the plate lifts it) and the production build with real keys and audio
  (menu, AudioContext suspended/resumed, Skip scene, no console errors). Note: the `aqueduct` route's last seconds
  run Loam (as Wood) into the fire trough, so it ends respawned in the water; that predates this change.

## After the user's playtest (19 Nov, 11:30–11:50 IST)
- **No free camera.** Mouse-drag and right-stick orbit are gone (`camera/CameraRig.ts`); every area is seen only from
  its authored angle. Title screen, first hint and SUBMISSION controls no longer mention the mouse.
- **No climbing over puzzles.** Wall jumps only chain between facing walls (`Player.canWallJump`; the shaft still works,
  single walls and corners don't). Every `L.wall` now has an invisible cap far above it, every `L.invisible` guard
  reaches 30 above its top, and `L.cap()` seals the hall's east rock, the cracked-wall partition (raised to 9), and the
  escape gate; lintels close the portcullis (the block puzzle can no longer be skipped) and the door of light.
  A missing guard on the aqueduct's front lip (x 90–96) let Loam hop out of the level.
- **Props are solid** (`prop(..., { solid })`): kiln, workbench, statues, pillars, crates, scaffold, gear, tree, lake
  pillar and rocks, the hall-of-light emitter.
- **ElevenLabs audio** (key in `.env` as `ELEVENLABS_API_KEY`): `pipeline/eleven.mjs` generated 92 files
  (`pipeline/audio-manifest.json`, ~750 credits): 31 narrator lines (George, `eleven_v4`), 5 Loam vocal sounds, ~50 SFX,
  5 ambience loops, 5 music pieces (`music_v1`). `audio/Audio.ts` plays them with loudness normalisation, a voice bus
  that ducks music/ambience, per-area ambience (`Game.updateAmbience`), mood → recorded track, and the old synth as
  fallback. Narration: intro (3 lines + title), altars, form cards, colossus, "Run!", escape urging, finale, every
  hint the first time it shows, each death type once.
- Verified: typecheck, build, tests (11), all 9 scripted routes; bots confirm the portcullis, cracked wall, door and
  single walls can't be climbed in any form and the shaft still can; production build plays narration, music and
  ambience after a real click. Zip rebuilt (171 files, 34 MB). Teaser/trailer predate this and have no sound.

## Second playtest round (19 Nov, 12:00–12:40 IST)
- **Bug:** the user skipped the wood altar, crossed the lake as Stone, melted as Clay and respawned at the fire shrine
  (past the puzzle). Shrines now activate only while Loam stands on their own floor (`Checkpoint.update`: grounded,
  |dy| < 1.2); the fire shrine moved to x 127.2. A portcullis at x 89.4 (with hint + voice) stays shut until the wood
  altar is taken, so the lake can never be entered without Wood.
- **Longer game:** the stone court portcullis needs **two blocks on two plates** (second block at 44.5,2 → east to the
  lip, north onto the plate at 50.8,-9.3); the hall of light has a **second cradled block** at 167.3 (both to Glass);
  and a new room, **the Maker's Trial** (x 177.5–225.5, between the light door and the causeway): charge a cracked
  wall, pound a cracked floor, swim a deep pool as Wood, cross a fire trough, turn a cradled block to Glass so a beam
  opens the door. The escape and valley moved **+48 in x** (level1 E/F, hooks, Mood bands 228/333, SplatWorld range
  330, moths, petals, escape respawn bands, dev views and routes).
- New narrator lines: vo_h_push2, vo_h_glass2, vo_h_woodgate, vo_trial (96 audio files).
- Routes: `push` now places both blocks, `glass` imprints both blocks, new `trial` route; all 10 pass. Bot checks:
  wood gate holds without Wood, lake death respawns at the shore, fire shrine still activates on its floor.
  Zip rebuilt 12:39 (175 files, 35 MB).

## Skip fix (19 Nov, ~13:55 IST)
- Holding Enter to skip a cutscene left its narration playing (the fast-forwarded script queued every line).
  `Director.onSkip` now hushes the game's audio (`Audio.hushed`: no `say`/`play` while the script fast-forwards) and
  stops the narrator (`Audio.stopVoice`); sound returns the frame the skip ends. Verified in the production build with
  real audio. A hint whose zone was entered during a cutscene is now also read aloud when the cutscene ends (unless
  skipped).

## Fourth playtest note (19 Nov, ~13:50 IST)
- The user could not work out the trial's well. Hint bugs fixed: a zone's exit no longer clears a neighbouring zone's
  hint (`showHint(text, owner)`), and a hint whose zone was entered during a cutscene appears when it ends. The well
  hint now says exactly what to do; a warm light marks the crate; the trial's lower level has a closer camera zone
  (x 186–206, y < 6). All 10 routes pass; zip rebuilt.

## Third playtest round (19 Nov, 13:25–13:40 IST)
- **Camera:** every gameplay zone is higher and a little further out, and the follow camera frames Loam 1.4 m
  toward the camera (`CameraRig` bias) so the near/south side of the play space stays on screen. Contact sheet:
  `capture/review_camera.jpg`.
- **Escape:** the water channel (x 274–288) had open sides below the rails; sinking Loam slipped out "through the
  wall". Its banks now reach the channel floor.
- **Hall of light → the Prism Door:** no pre-placed blocks. The door answers only to light that passed through a
  glass block (`Receptor.needsGlass`, `Beam` checks glass blocks on its path; the beam haze brightens through glass);
  a shutter by the crystal lifts only while its plate is held. Shove the block at 158.6 west onto the plate (lip at
  x 151.6), shove the block at 165.2 north into the beam (lip at z −1.8), turn it to Glass. Loam on the plate or
  Glass-Loam in the beam does not count (bot-checked).
- **Maker's Trial → the well:** a wooden crate floats in a well in the landing above a plate; the far bank's gate
  (x 203.4) opens only while the plate is held: Stone, then E, sinks the crate. Hints and narrator lines for both
  puzzles (vo_h_prism1/2, vo_h_well).
- Routes `glass` and `trial` solve the new puzzles; all 10 routes pass; prod build boots clean. Zip 13:36.

## X teaser (19 Nov, 13:20–13:40 IST)
- `deliverables/matterborn-teaser-x.mp4`: 28.5 s, 1080p30, 57 MB, H.264 + AAC (peak −0.3 dBFS, −14.4 dB RMS). A cinematic
  cut to an ElevenLabs composition-plan score (`tz_score`), narrator George (`tz_vo1`..`tz_vo7`), trailer hits
  (`tz_boom`, `tz_riser`, `tz_braam`, `tz_hit`, `tz_whoosh`, `tz_final`), game effects underneath; letterboxed, with
  STONE / WOOD / GLASS words. Script: `shots.teaser(cap)` (`dev/shots.ts`; absolute cut times on the score).
  Review sheet: `capture/review_teaser_x2.jpg`. The 97 s gameplay teaser moved to `capture/teaser_gameplay_97s.mp4`;
  the 174 s gameplay video is `deliverables/matterborn-gameplay-trailer.mp4`.

## Videos and report (19 Nov, 13:00–13:20 IST)
- `capture({ ..., audio: true })` now records the game's sound in sync: `Audio.recorder` receives every effect, line,
  music and ambience change on the capture clock (`dev/AudioMix.ts`), which is rendered offline with the live mix rules
  (+ makeup gain and a limiter) and muxed as AAC. The live game also got a safety limiter.
- `deliverables/teaser.mp4` (96.8 s, 1080p30, 123 MB, for X) and `deliverables/trailer.mp4` (173.9 s, 221 MB, includes
  the Maker's Trial) re-recorded with narration, effects, ambience and music; peaks −0.7 dBFS, ~−19.5 dB RMS.
  Contact sheets: `capture/review_teaser_sheet.jpg`, `capture/review_trailer_sheet.jpg`.
- Report regenerated for team **DarkArtsAsh** (Aswin Vinod, solo): `deliverables/DarkArtsAsh + Matterborn.pdf`. Rerun
  with links once hosted: `python3 docs/report/make_report.py "DarkArtsAsh" "<play link>" "<video link>"`.
- Hosting: the form recommends a ModelScope Studio link. A static Studio needs a built `index.html` at its root
  (push `dist/` to the Studio's git remote, branch master; files >100 MB need LFS, ours are all smaller).

## Concept (approved by the user)
Cinematic **3D** puzzle-platformer for the Manycore Aholo Global 3D AI Hackathon (theme "Play in 3D, Create with Aholo").
Loam, a small clay golem, changes what things are made of, including itself:
Clay (base, melts in water) · Stone (heavy: pound cracked floors, charge cracked walls, push stone blocks, sink, hold
plates) · Wood (high jump, floats, burns) · Glass (light passes through, shatters on hard landings). **E** imprints
Loam's current material onto blocks. The world starts faded to clay; each altar restores a material category
(stone / wood / glass / life) with a glowing wave. The 2.5D build is archived in `backups/` as a fallback.

## Aholo content in the game (all generated, all in use)
- **All 34 Lux3D/World jobs are done** (`pipeline/manifest.json`), processed by `npm run process` into
  `game/public/assets` (24 models, 32 animation entries, 2 tiling textures, panoramas, 1 splat world).
- Hero: image → 3D → humanoid auto-rig → 30 retargeted clips; Stone/Wood forms are Lux3D material transfers.
- Props: 14 text-to-3D environment props, block (+ wood material transfer), cracked slab + its **part split** (debris).
- Creatures: colossus and moth with **articulation** (URDF joints: the colossus swings its shoulder; moths flap on hinges).
- Worlds: **Aholo World "Valley of Makers"** is rendered as a real 3D Gaussian-splat backdrop (Spark) behind the final
  valley (`render/SplatWorld.ts`); both world panoramas feed the sky. The hall world's splats are not shipped (unused).

## Rendering (rebuilt 19 Nov night, all verified in screenshots)
Pipeline in `render/Renderer.ts`: scene → **N8AO** ambient occlusion → **AirEffect** (exposure + depth-reconstructed
exponential height fog with sun glow, `render/PostEffects.ts`) → **VolumetricPass** (ray-marched sunlight through the sun's
shadow map: real light shafts from windows/pillars, `render/VolumetricPass.ts`) → cinematic **depth of field** (cutscenes and
title only) → bloom, AgX tone mapping, **GradeEffect** (saturation, split tone, contrast), vignette, chromatic aberration,
grain → SMAA. Adaptive quality (high/medium/low; `?quality=` pins it) drops pixel ratio, AO samples and volumetric
resolution if frames run slow (ignores the first 240 frames and throttled background frames).
- **Moods** (`render/Mood.ts`): per-area sky, sun direction/colour, fog, shafts, fill, grade and bloom, blended along x:
  golden dusk Atelier → blue dusk Stone court → teal moonlit aqueduct → silver Hall of light → fiery escape → sunrise valley.
- **LightPool** (`render/LightPool.ts`): level code creates `VLight`s; 8 real PointLights follow the most relevant ones
  (was 33 lights shaded per pixel). `LightPool.gain` scales all level lights.
- Shadow-only roofs (`Level.shadowRoof`, layer 1) make the Atelier an interior so sun enters only through the windows.
- Terrain material: bump from the Lux3D stone texture, tiling break-up, colour variation, moss that grows back with life.
- Water: depth-writing surface, sun glints, fresnel sky reflection, shore foam, caustics on the bed.
- Foliage (`render/Foliage.ts`): ~90k instanced wind-swept grass blades, glowing flowers, a blossoming valley tree, fireflies;
  all grow and colour with the life restoration wave. Valley has rolling hills (`valleyHeight` in level1.ts).
- Hero: fresnel rim light per form, glowing heart sprite + pooled heart light (the old black-patch bug is gone),
  Glass is a fresnel glass shell (three's transmission pass blacked out frames in this pipeline; NaN guard added).
- Image-based lighting (`render/Environment.ts`), dust motes that only glitter inside sunbeams, restoration ring + sparks +
  colour swell at altars (`Game.restoreBurst`), petals in the valley, spores over the aqueduct.

## Story, animation and game polish (19 Nov night)
- Narrative lines at each altar and when the colossus wakes; the finale returns Loam to clay and its cameras keep the
  Aholo World backdrop in its sweet spot (cameras must stay at z ≤ ~15 in the valley, see `SplatWorld` placement).
- Glowing Maker sigils on the floors (`Level.sigil`): Loam wakes in the Atelier's; the court and hall have their own.
- Rigged hero: head turns toward unused altar orbs (and glances at the camera after standing still), banks into turns,
  and sits down after ~9 s idle (Lux3D Sitting clips), standing back up on input.
- Restoration moment: ring + sparks riding the colour wave, saturation/bloom swell (`Game.restoreBurst`).
- Escape: billowing dust-wall shader (`render/DustWall.ts`) instead of a black box; darker, higher-contrast sky;
  a danger pulse (vignette closes in, highlights warm) when the collapse is within ~8 m (`Game.danger`). The recorded
  videos predate this pulse.
- Title screen bug fixed: blocks and beams used to sit stacked at the world origin until play began (now placed at load).
- Pause menu: Graphics (Auto/High/Medium/Low, remembered in localStorage) and Fullscreen. Grass density follows quality.
- All Lux3D models are preloaded behind the loading bar (`waitForLoads`, 15 s cap) so nothing pops in on the title.
- **Maker's Archive** (`ui/Archive.ts`, press **G** on the title screen): every Lux3D model on a turntable in a studio set
  at y = -400 with the Aholo operation, prompt, triangles, version/style and generation time (from the provenance that
  `process.mjs` now writes into the manifest). The rigged hero cycles retargeted clips (label shows the clip), the colossus
  swings its URDF shoulder, the moth flaps. A/D or arrows browse, Esc returns.

## Verified overnight (19 Nov, 03:53 IST; superseded by "Current state" above)
- `npm run typecheck`, `npm run build`, `npm test` (11) pass.
- All scripted routes pass (`dev/shots.ts`): altar, pound, push, charge, aqueduct, fire, glass, colossus, full escape to the
  finale; plus a title → intro skip → step → double jump → balcony → altar run with real inputs.
- Every area reviewed in a 16-view contact sheet; intro, altar, colossus, escape and finale reviewed frame by frame.
- Frame cost on this Mac ≈ 2–3 ms at 1920×1080 on high (the escape test ran 657 frames in 4 s at 960×540).

## Deliverables prepared
- `deliverables/matterborn-teaser-x.mp4` (28.5 s, the X video) — `shots.teaser(cap)` with
  `capture({width:1920,height:1080,fps:30,audio:true})`. `deliverables/matterborn-gameplay-trailer.mp4` (174 s, optional
  gameplay video, `shots.trailer(cap)`), also recorded with sound. Both from a fresh page on the title screen; captures
  predate the Prism Door / well puzzles (re-record only if wanted).
- `deliverables/DarkArtsAsh + Matterborn.pdf` (also in `docs/report/`): 9-page report. Regenerate with links once hosted:
  `python3 docs/report/make_report.py "DarkArtsAsh" "<play link>" "<video link>"`, then copy it to `deliverables/`.
  Asset gallery renders: `await gallery()` in dev (writes `capture/gallery_*.png`).
- `docs/SUBMISSION.md`: form text, Aholo usage, controls, X post drafts.
- `deliverables/matterborn-web.zip`: the production build (`dist/`), index.html at the zip root, ready for any static host.

## Architecture (game/src)
- `physics/World3D.ts`: swept-box collision, wall probes, raycast with `blocksLight` / `blocksCamera`.
- `actors/Player.ts`: camera-relative controller and all material abilities. `actors/RiggedHero.ts` loads the Lux3D
  rig + clips when the manifest lists `hero_rig`, else `ProceduralGolem`. `actors/Colossus.ts`, `actors/Moths.ts`.
- `camera/CameraRig.ts`, `level/Level.ts` (entities), `level/level1.ts` (layout, camera zones, foliage, valley land),
  `Game.ts` (loop, moods, cutscenes, escape, debug API), `story/Director.ts`, `render/*`, `audio/Audio.ts`, `ui/UI.ts`.

## How to run and test
```
npm install
npm run dev          # http://localhost:5173 (preview server "matterborn"); add ?quality=high to pin quality
npm run typecheck && npm run build && npm test
npm run process      # after generation: cache -> game/public/assets + manifest.json
```
Debug API (`window.game.debug`): `play(sec)` async, `step(sec)`, `move(x,z)`/`stop()`, `hold/tap/release(action)`,
`teleport`, `unlockAll`, `skip`, `resetFlow`, `state`. Dev views: `await view('valley')` (atelier, kiln, balcony, court, plate,
corridor, shaft, aqueduct, lake, under, fire, hall, door, causeway, glasscause, valley); screenshots of a hidden pane need a
second `debug.step` + short wait before they show the new frame.
Capture: `const cap = await capture({width:1280,height:720,fps:30}); const S = await shots(); await S.review(cap,'pound')`.
Add `audio: true` to record the game's sound in sync (AAC track, rendered offline in `dev/AudioMix.ts`).
Audio generation: `node --env-file=.env pipeline/eleven.mjs --dry` then `--only <ids>` (jobs in `pipeline/sound-jobs.mjs`,
record in `pipeline/audio-manifest.json`; never run two generator processes at once — they overwrite the manifest).

## Next steps (in order)
1. Host on **ModelScope Studio** (the form recommends a ModelScope Studio link): the user creates a static Studio on
   modelscope.ai under their account; upload the contents of `dist/` (index.html at the Studio root; no file is over
   100 MB) via the web UI or git push with the user's own token (never in chat). Verify the link loads without sign-in.
2. Regenerate the report with the play link (and video link if any) and copy it to `deliverables/`.
3. The user posts `deliverables/matterborn-teaser-x.mp4` on X with #Manycorehackathon (caption drafts in
   docs/SUBMISSION.md) and fills the form: demo link (ModelScope), report PDF, ecosystem/technologies, application
   track **Gaming**.
