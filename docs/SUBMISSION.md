# Matterborn: submission kit

Everything the submission form and the X post need, in one place. Fill the `TODO` items when they exist.

## Links (must work without sign-in)
- Play: **https://modelscope.ai/studios/DarkArtsAsh/matterborn** (ModelScope Studio, static SDK, public; full-window
  view: https://modelscope.ai/studios/DarkArtsAsh/matterborn?mode=full). Click the game once so it gets the keyboard.
- Demo video: `capture/teaser.mp4` (83 s, for X) and `capture/trailer.mp4` (113 s, full) — real gameplay captured
  frame by frame from the running game (re-record: see docs/STATUS.md). Upload one and paste the link here.
- Source code: **https://github.com/AswinWebDev/Matterborn** (public)
- Report: `deliverables/DarkArtsAsh + Matterborn.pdf` (play link filled in; video given as "in our X post"). Rebuild:
  `python3 docs/report/make_report.py "DarkArtsAsh" "<play link>" "<video link>"`, then copy it to `deliverables/`.

## One-line pitch
Matterborn is a 3D puzzle-platformer where a small clay golem becomes stone, wood or glass, and passes that matter
on to the world around it. Every character, creature and material comes out of an Aholo Lux3D pipeline.

## Short description (form)
The Makers vanished and everything they made faded back into clay. You are Loam, the last golem, and you can change
what you are made of. Stone is heavy: it pounds through cracked floors, charges through walls, sinks in water and
shoves stone blocks. Wood jumps high and floats, but burns. Glass lets light through but shatters on hard landings.
Press E to pass your material to a block: a stone block turned to glass lets a beam of light reach a door. Each altar
restores one kind of matter to the world with a wave of colour. The Maker's Trial then asks for every form in turn
(charge, pound, swim, cross fire, shine), and the run ends with an escape from a waking clay colossus. Fully voiced
narration, sound and music (ElevenLabs).

## How Aholo is used (form: "technology choices")
- **Lux3D image generation** → concept art of Loam → **Lux3D image-to-3D (G1)** → the hero model.
- **Humanoid auto-rig** + **animation retargeting** (30 preset motions) → Loam's run, jump, swim, push, climb, cast
  and story animations, blended live in three.js.
- **Material transfer** with Lux3D-generated stone and wood swatches → Loam's Stone and Wood forms and the wooden
  puzzle block: the game mechanic is literally Lux3D material transfer.
- **Text-to-3D (G1-Turbo)** → props, the colossus and the puzzle blocks; **articulation animation** → the colossus slam.
- **Part split** → the cracked slab that shatters. **Articulation** → URDF joints: the colossus swings its shoulder,
  the lantern moths flap on their wing hinges.
- **Aholo World** → the "Valley of Makers" Gaussian-splat world is rendered (Spark) as the final valley's 3D backdrop,
  and both worlds' panoramas feed the sky.
- Pipeline: `pipeline/gen.mjs` (official `@manycore/aholo-sdk-lux3d`) checks every request against the Lux3D contract,
  resumes tasks instead of paying twice, then `pipeline/process.mjs` optimises the GLBs for the web (meshopt, WebP).
- Sound (not Aholo, for completeness): the narrator, Loam's little voice, ~50 sound effects, five ambience loops and
  the score were generated with **ElevenLabs** (`pipeline/eleven.mjs`, jobs in `pipeline/sound-jobs.mjs`).

## In-game proof of the pipeline
On the title screen press **G** for the **Maker's Archive**: every Lux3D model in the game on a turntable, with the Aholo
operation that made it, its prompt, triangle count and generation time. The rigged hero cycles its retargeted clips,
the colossus swings its articulated shoulder and the moth flaps its hinged wings.

## Controls and setup (form)
- Runs in any desktop browser with WebGL 2 (Chrome, Edge, Firefox, Safari). No install, no sign-in.
- **W A S D** (or arrow keys) move · **Space** jump (again in mid-air to double jump, against walls to
  wall jump) · **Shift** dash, or charge as Stone · **1–4** or **Q** change material · **E** pass your material to a
  block · **C** pound in mid-air as Stone · **Esc** pause · hold **Enter** to skip a cutscene. Gamepad supported.

## Application award preference
Gaming (first choice).

## X post drafts (#Manycorehackathon; video 30–90 s, strongest moment first)
1. A clay golem that becomes stone, wood or glass, and passes that matter to the world. Every model, material and
   animation came out of @Aholo Lux3D. Play it in your browser: LINK #Manycorehackathon
2. What if the puzzle was what things are made of? Stone sinks, wood floats, glass lets light through. Built in a
   day with Aholo Lux3D: image → 3D → auto-rig → 30 animations → material transfer. LINK #Manycorehackathon
