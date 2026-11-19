// Every Aholo job Matterborn needs. Values starting with "@job.key" are filled in with an
// output URL of another job (e.g. "@hero_model.glb"); "file:path" sends a local image as a
// data URL. Run with: npm run gen -- <jobId|group>
//
// `post` tells pipeline/process.mjs what the game uses from a finished job:
//   { model: id, tex }   optimised GLB -> game/public/assets/models/<id>.glb (tex = max texture px)
//   { texture: name }    image -> game/public/assets/textures/<name>.jpg (tiling level material)
//   { anims: true }      retargeted clips -> skeleton-only GLBs in assets/anims/
//   { articulated: name } articulation result -> models/<name>.glb + anims entry
//   { pano: name }       World panorama -> assets/pano_<name>.jpg (sky) and, unless splat: false,
//                        its Gaussian splats -> assets/world_<name>.spz (Spark 3D backdrop)
//
// Prompt rules from the official handbook: Lux3D is strong on stone, wood, metal and objects
// with clear contours; it is weak on glass/transparency, faces, dense foliage, intricate
// carvings and many small accessories. So: no rune carvings, a bare tree, a simple face on
// Loam, opaque crystals, and Glass is rendered by a shader in the game instead of a
// material-transfer texture.

const STYLE = 'hand_painted';
const PROP = { version: 'G1-Turbo', style: STYLE, outputFormat: ['glb'], faceCount: 30000, enablePbr: true, aiPredictSize: true };
const prop = (id, prompt, extra = {}, post = { model: id, tex: 1024 }) => ({ id, kind: 'text3d', params: { ...PROP, prompt, ...extra }, post });

// Art direction shared by all prompts: ancient maker civilisation, twilight, painterly stylised PBR,
// chunky readable silhouettes for a third-person camera.
const LOOK = 'stylized hand-painted fantasy game asset, ancient maker civilization, weathered, chunky readable silhouette, single isolated object';

export const JOBS = [
  // ---------------------------------------------------------------- hero: Loam the golem
  {
    id: 'hero_concept',
    kind: 'image',
    params: {
      prompt:
        'Full-body character concept art of Loam, a small friendly humanoid golem made of smooth terracotta clay. ' +
        'Big rounded head (about one quarter of its height) with a very simple face: two round glowing amber eyes, no mouth, no nose. ' +
        'A small glowing amber crystal heart set in the chest, sturdy legs, simple rounded hands, arms clearly separated from the torso, smooth surfaces with no carvings. ' +
        'Standing straight in an A-pose with arms angled 45 degrees away from the body, legs slightly apart, facing the camera, ' +
        'orthographic front view, entire body visible from head to feet, plain flat light-grey background, soft even lighting, ' +
        'stylized hand-painted game character, clean silhouette.',
    },
    post: { image: 'hero_concept' },
  },
  { id: 'hero_model', kind: 'img3d', params: { img: '@hero_concept.image', version: 'G1', faceCount: 60000, aiPredictSize: true }, post: { model: 'hero_model', tex: 1024 } },
  { id: 'hero_rig', kind: 'rig', params: { modelUrl: '@hero_model.glb' }, post: { model: 'hero_rig', tex: 1024, rigged: true } },
  {
    id: 'hero_anims_move',
    kind: 'retarget',
    params: {
      rigModelUrl: '@hero_rig.glb',
      animateInPlace: true,
      animationOutputMode: 'separate',
      outFormat: 'glb',
      animationIds: ['Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'NinjaJump_Start', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'Roll'],
    },
    post: { anims: true },
  },
  {
    id: 'hero_anims_world',
    kind: 'retarget',
    params: {
      rigModelUrl: '@hero_rig.glb',
      animateInPlace: true,
      animationOutputMode: 'separate',
      outFormat: 'glb',
      animationIds: ['Push_Loop', 'ClimbUp_1m', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Slide_Loop', 'Hit_Knockback', 'Death01', 'Walk_Loop', 'Crouch_Idle_Loop', 'Interact'],
    },
    post: { anims: true },
  },
  {
    id: 'hero_anims_story',
    kind: 'retarget',
    params: {
      rigModelUrl: '@hero_rig.glb',
      animateInPlace: true,
      animationOutputMode: 'separate',
      outFormat: 'glb',
      animationIds: ['LayToIdle', 'Spell_Simple_Enter', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Spell_Simple_Exit', 'Idle_Lantern_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Dance_Loop', 'Yes'],
    },
    post: { anims: true },
  },

  // ---------------------------------------------- material swatches (transfer input + level tiles)
  {
    id: 'tex_stone',
    kind: 'image',
    params: { prompt: 'Seamless tileable square texture filling the whole frame: rough grey granite stone with fine speckles, thin cracks and a little green moss, evenly lit, flat top-down view, no objects, no perspective, no shadows.' },
    post: { texture: 'stone' },
  },
  {
    id: 'tex_wood',
    kind: 'image',
    params: { prompt: 'Seamless tileable square texture filling the whole frame: warm honey-coloured oak wood planks with clear grain lines and small knots, evenly lit, flat top-down view, no objects, no perspective, no shadows.' },
    post: { texture: 'wood' },
  },
  // Loam's Stone and Wood forms are Lux3D material transfers of the hero model (Glass is a shader).
  { id: 'hero_stone', kind: 'material', params: { meshUrl: '@hero_model.glb', img: '@tex_stone.image', version: 'v3.0-standard', outputFormat: ['glb'] }, post: { model: 'hero_stone', tex: 1024 } },
  { id: 'hero_wood', kind: 'material', params: { meshUrl: '@hero_model.glb', img: '@tex_wood.image', version: 'v3.0-standard', outputFormat: ['glb'] }, post: { model: 'hero_wood', tex: 1024 } },

  // ------------------------------------------------------------- transmutable puzzle objects
  prop('obj_block', `Heavy cube block of ancient sandstone with chipped bevelled edges, a few hairline cracks and one shallow engraved ring on each side face, ${LOOK}`),
  { id: 'obj_block_wood', kind: 'material', params: { meshUrl: '@obj_block.glb', img: '@tex_wood.image', version: 'v3.0-standard', outputFormat: ['glb'] }, post: { model: 'obj_block_wood', tex: 1024 } },
  prop('obj_crack_slab', `Thick square stone floor slab split by deep jagged fractures into large chunks, about to shatter, ${LOOK}`),
  { id: 'obj_crack_slab_parts', kind: 'split', params: { glbUrl: '@obj_crack_slab.glb' }, post: { model: 'obj_crack_slab_parts', tex: 512 } },

  // ---------------------------------------------------------------------- environment kit
  prop('env_kiln', `Giant ancient stone kiln furnace with a round arched mouth, cold and cracked, soot stains, ${LOOK}`),
  prop('env_workbench', `Sturdy old wooden workbench with thick legs, a wooden mallet and one unfinished clay pot on top, ${LOOK}`),
  prop('env_pillar', `Tall round ancient stone column broken off at the top, weathered and cracked, a little moss at the base, ${LOOK}`),
  prop('env_arch', `Ruined archway built from large rough stone blocks, partially collapsed on one side, ${LOOK}`),
  prop('env_crate', `Sturdy wooden crate with iron corner brackets, ${LOOK}`, {}, { model: 'env_crate', tex: 512 }),
  prop('env_emitter', `Large opaque polished cyan crystal mounted on a simple round stone pedestal, ${LOOK}`, {}, { model: 'env_emitter', tex: 512 }),
  prop('env_lantern', `Simple hanging iron lantern with a sturdy square frame and a warm glowing amber core, ${LOOK}`, {}, { model: 'env_lantern', tex: 512 }),
  prop('env_tree', `Stylized ancient bare tree with a thick twisted trunk, exposed roots and a few bare branches, no leaves, ${LOOK}`),
  prop('env_rocks', `Cluster of three rounded mossy boulders, ${LOOK}`, {}, { model: 'env_rocks', tex: 512 }),
  prop('env_mushrooms', `Cluster of four tall glowing bioluminescent teal mushrooms with smooth caps, ${LOOK}`, {}, { model: 'env_mushrooms', tex: 512 }),
  prop('env_gear', `Giant ancient bronze gear wheel with worn chunky teeth, partly rusted, ${LOOK}`),
  prop('env_statue', `Weathered stone statue of a kneeling hooded sculptor holding a chisel, the face hidden in the deep hood, ${LOOK}`),
  prop('env_wall', `Section of ruined ancient stone wall with one tall arched window opening, ${LOOK}`),
  prop('env_scaffold', `Simple old wooden scaffolding tower made of thick beams with one ladder, ${LOOK}`),

  // ---------------------------------------------------------------------- living things
  prop('cr_colossus', `Huge hunched ancient clay colossus guardian with heavy arms, a cracked body and a single glowing amber eye in its plain head, ${LOOK}`, { faceCount: 50000 }, { model: 'cr_colossus', tex: 1024 }),
  { id: 'cr_colossus_anim', kind: 'articulate', params: { glbUrl: '@cr_colossus.glb', prompt: 'The right arm rises high and slams down to the ground while the head tilts down.' }, post: { articulated: 'colossus_slam' } },
  prop('cr_moth', `Small lantern moth creature with a softly glowing amber body and two large opaque wings with simple amber and brown bands, ${LOOK}`, { faceCount: 20000 }, { model: 'cr_moth', tex: 512 }),
  { id: 'cr_moth_anim', kind: 'articulate', params: { glbUrl: '@cr_moth.glb', prompt: 'The two wings flap up and down together in a smooth loop while the body stays still.' }, post: { articulated: 'moth_flap' } },

  // ---------------------------------------------------------------------- AI worlds (3DGS)
  {
    id: 'world_hall',
    kind: 'world',
    params: {
      name: 'Matterborn - The Hollow Atelier',
      prompt: 'A vast ancient stone sculpture workshop hall carved inside a mountain, tall arched windows with beams of golden dusk light, floating dust, giant unfinished statues, wooden scaffolding, warm and mysterious',
    },
    post: { pano: 'hall', splat: false }, // splats unused in game (the valley world is the 3D backdrop)
  },
  {
    id: 'world_valley',
    kind: 'world',
    params: {
      name: 'Matterborn - Valley of Makers',
      prompt: 'A misty mountain valley at twilight with ruined stone towers, ancient aqueducts and glowing amber lanterns, painterly fantasy atmosphere',
    },
    post: { pano: 'valley' },
  },
];

export const GROUPS = {
  // cheapest end-to-end check of the APIs we depend on (adds tex_wood as a dependency)
  test: ['tex_stone', 'obj_block', 'obj_block_wood'],
  hero: ['hero_concept', 'hero_model', 'hero_rig', 'hero_anims_move', 'hero_anims_world', 'hero_anims_story'],
  hero_materials: ['hero_stone', 'hero_wood'],
  puzzle: ['obj_block', 'obj_block_wood', 'obj_crack_slab', 'obj_crack_slab_parts'],
  env: JOBS.filter((j) => j.id.startsWith('env_')).map((j) => j.id),
  colossus: ['cr_colossus', 'cr_colossus_anim'],
  creatures: ['cr_colossus', 'cr_colossus_anim', 'cr_moth', 'cr_moth_anim'],
  worlds: ['world_hall', 'world_valley'],
};
