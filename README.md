# Matterborn

A cinematic 3D puzzle-platformer that runs in the browser. Loam, a small clay golem, takes on what the world is made
of (stone, wood and glass) to cross a ruined workshop, escape a waking colossus and bring a valley back to life.

Made by team **DarkArtsAsh** for the Manycore Aholo Global 3D AI Hackathon. #Manycorehackathon

**Play:** https://modelscope.ai/studios/DarkArtsAsh/matterborn

## Built with Aholo
- **Aholo Lux3D** made every character, creature, prop and material in the game: image and text to 3D, material
  transfer (the Stone and Wood looks), humanoid auto-rig with retargeted animations (Loam), articulation (the colossus's
  joints, the moths' wings) and part split (the cracked slabs).
- **Aholo World**: the Valley of Makers as a 3D Gaussian-splat backdrop, and the sky panoramas.
- Voice, sound and music: ElevenLabs. Engine: three.js with custom 3D physics.

On the title screen, press **G** for the Maker's Archive: every Aholo-generated model in the game on a turntable.

## Controls
W A S D move · Space jump (double jump, wall jump) · Shift dash, or charge as Stone · 1-4 or Q change material ·
E pass your material to a block · C pound in mid-air as Stone · Esc pause menu · hold Enter to skip a cutscene.
Gamepad supported.

## Run it locally
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (index.html at the root)
```
The built game needs no keys. To regenerate assets, copy `.env.example` to `.env` and add your own Aholo and
ElevenLabs keys.

## Layout
- `game/`: the game (TypeScript, three.js, Vite). `src/Game.ts` runs the loop and story, `src/level/level1.ts` lays
  out the level, `src/actors/` holds Loam and the creatures, `src/render/` the lighting and effects, `src/audio/` the
  sound.
- `pipeline/`: the Aholo Lux3D asset pipeline (`gen.mjs` generates through the official SDK and resumes tasks instead
  of paying twice; `process.mjs` optimises the GLBs for the web) and the ElevenLabs audio generator (`eleven.mjs`).
- `docs/`: the project report (`docs/report/`), build log and submission notes.
