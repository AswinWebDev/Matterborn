// Every ElevenLabs audio asset in the game: the narrator's voice lines, Loam's little vocal
// sounds, sound effects, ambience loops and music. pipeline/eleven.mjs generates each job once
// into game/public/audio/<id>.mp3 and records it in pipeline/audio-manifest.json.

export const VOICES = {
  // ElevenLabs premade voice "George - Warm, Captivating Storyteller" (British, middle-aged)
  narrator: { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George, warm British storyteller' },
};

const V = (id, text, extra = {}) => ({ id, kind: 'voice', voice: 'narrator', text, ...extra });
const S = (id, duration, prompt, extra = {}) => ({ id, kind: 'sfx', duration, prompt, ...extra });
const LOOP = (id, duration, prompt, extra = {}) => ({ id, kind: 'sfx', duration, prompt, loop: true, ...extra });
const M = (id, seconds, prompt) => ({ id, kind: 'music', ms: seconds * 1000, prompt });

export const JOBS = [
  // ------------------------------------------------------------------ narrator
  V('vo_intro_1', 'Long ago, the Makers shaped the world from living matter.'),
  V('vo_intro_2', 'When they vanished, everything they made faded back into clay.'),
  V('vo_intro_3', 'But one small spark remembered... and it found Loam.'),
  V('vo_title', 'Become what the world needs.'),
  V('vo_h_move', 'Go on, little one. Find your feet.'),
  V('vo_h_balcony', "Jump onto the step, then jump again while you're still in the air."),
  V('vo_h_pound', 'Stone falls hard. Leap up, and pound through the cracked floor.'),
  V('vo_h_push', 'Only stone can move stone. Push the block along, then onto the plate.'),
  V('vo_h_charge', 'Lower your head, and charge straight through the cracked wall.'),
  V('vo_h_climb', 'Stone is far too heavy to climb. Be clay again, and leap from wall to wall.'),
  V('vo_h_water', 'Careful now. Clay melts in water. Stone sinks to the bottom, and wood floats.'),
  V('vo_h_sink', 'Sink as stone, and walk beneath the wall...'),
  V('vo_h_float', '...then become wood, and float back up.'),
  V('vo_h_fire', 'Wood burns! Cross the fire as clay, or as stone.'),
  V('vo_h_glass', 'The light wants to reach the door. Become glass, then touch the block, and pass it on.'),
  V('vo_h_push2', 'Only stone can move stone. This gate needs both plates held down... a block on each.'),
  V('vo_h_glass2', 'The light wants to reach the door. Become glass, and pass it on to every block in its way.'),
  V('vo_h_woodgate', 'Not yet, little one. The gate answers to the altar. Take its gift first.'),
  V('vo_trial', "This is the Maker's trial. Everything you have become... one form after another."),
  V('vo_h_prism1', 'This door answers only to light that has passed through glass.'),
  V('vo_h_prism2', 'The shutter lifts only while something heavy rests on its plate.'),
  V('vo_h_well', 'That gate answers to the plate beneath the crate. Make the crate heavy enough to sink.'),
  V('vo_altar_stone', 'The stones of the workshop remember their weight.'),
  V('vo_altar_wood', 'Roots stir. Everything that once grew remembers how.'),
  V('vo_altar_glass', 'And light remembers its way through the world.'),
  V('vo_form_stone', 'Loam became stone.'),
  V('vo_form_wood', 'Loam became wood.'),
  V('vo_form_glass', 'Loam became glass.'),
  V('vo_colossus', "The workshop's guardian wakes... and it does not know Loam."),
  V('vo_run', 'Run, Loam! Run!'),
  V('vo_esc_1', "Don't look back!"),
  V('vo_esc_2', 'Faster, little one!'),
  V('vo_d_shatter', 'Glass shatters on a hard landing. Change before you land.'),
  V('vo_d_melt', 'Clay melts in water. Try stone, or wood.'),
  V('vo_d_burn', 'Wood burns. Cross the fire as clay, or as stone.'),
  V('vo_finale_1', 'Everything Loam touched remembered what it was made of.'),
  V('vo_finale_2', 'And the valley of the Makers began to bloom again.'),
  V('vo_thanks', 'Thank you for playing Matterborn.'),

  // ------------------------------------------------------------------ Loam's vocal sounds
  S('vx_loam_wake', 1.5, 'Small cute clay creature waking up, soft curious coo, no words, cartoon character vocalization'),
  S('vx_loam_hup', 0.5, 'Small cute creature short effort sound, playful high pitched hup, no words, cartoon character vocalization'),
  S('vx_loam_oof', 0.6, 'Small cute creature short oof grunt on a hard landing, no words, cartoon character vocalization'),
  S('vx_loam_hurt', 0.8, 'Small cute creature sad little whimper, no words, cartoon character vocalization'),
  S('vx_loam_yay', 1.0, 'Small cute creature happy little cheer, no words, cartoon character vocalization'),

  // ------------------------------------------------------------------ player
  S('sfx_jump', 0.5, 'Quick light whoosh of a small clay creature leaping into the air, soft swish, game sound effect'),
  S('sfx_flip', 0.7, 'Airy magical double jump swoosh with a soft sparkle shimmer, game sound effect'),
  S('sfx_walljump', 0.5, 'Quick scuff of feet kicking off a stone wall followed by a short whoosh, game sound effect'),
  S('sfx_land_clay', 0.5, 'Soft dull thud of a small clay creature landing on a stone floor, game sound effect'),
  S('sfx_land_stone', 0.7, 'Heavy granite block landing on a stone floor, deep solid thud with a little gravel, game sound effect'),
  S('sfx_land_wood', 0.5, 'Hollow wooden knock of a small wooden figure landing on a stone floor, game sound effect'),
  S('sfx_land_glass', 0.6, 'Small glass figure landing on stone, bright crystalline clink with a short ring, game sound effect'),
  S('sfx_hardland', 0.9, 'Heavy body slamming onto a stone floor from a height, dusty impact thump, game sound effect'),
  S('sfx_pound_fall', 0.6, 'Fast downward rushing whoosh of a heavy object diving toward the ground, game sound effect'),
  S('sfx_pound_impact', 1.6, 'Massive ground pound impact, stone smashing into a stone floor, deep boom with cracking rock and debris, game sound effect'),
  S('sfx_step_clay', 0.5, 'Single soft squishy footstep of clay on a stone floor, game foley'),
  S('sfx_step_stone', 0.5, 'Single heavy footstep of a small stone golem on a stone floor, gritty thud, game foley'),
  S('sfx_step_wood', 0.5, 'Single light wooden footstep on a stone floor, hollow tock, game foley'),
  S('sfx_step_glass', 0.5, 'Single delicate glass footstep on stone, tiny crystalline clink, game foley'),
  S('sfx_dash', 0.6, 'Fast sharp air dash whoosh, game sound effect'),
  S('sfx_charge', 1.0, 'Heavy stone shoulder charge, rumbling grinding rush of rock moving fast, game sound effect'),
  S('sfx_climb', 0.6, 'Small hands scrabbling and pulling up onto a stone ledge, game sound effect'),
  LOOP('sfx_push_loop', 3, 'Heavy stone block scraping and grinding slowly across a stone floor, continuous'),

  // ------------------------------------------------------------------ forms
  S('sfx_tf_clay', 1.2, 'Magical transformation into soft clay, warm shimmering chime with a soft squelch, game sound effect'),
  S('sfx_tf_stone', 1.2, 'Magical transformation into stone, shimmering chime then heavy rock crackling and settling, game sound effect'),
  S('sfx_tf_wood', 1.2, 'Magical transformation into wood, shimmering chime with creaking wood and rustling leaves, game sound effect'),
  S('sfx_tf_glass', 1.2, 'Magical transformation into glass, crystalline shimmering chime with ringing glass resonance, game sound effect'),
  S('sfx_imprint', 1.4, 'Magical energy flowing into an object, resonant rising chime swell with a soft whoosh, game sound effect'),

  // ------------------------------------------------------------------ world
  S('sfx_crumble', 2.2, 'Cracked stone wall breaking apart and crumbling into rubble, rocks tumbling, game sound effect'),
  S('sfx_splash', 1.0, 'Small body plunging into water, medium splash, game sound effect'),
  S('sfx_bubbles', 1.2, 'Bubbles rising through water, soft underwater gurgle, game sound effect'),
  S('sfx_checkpoint', 1.6, 'Soft warm magical bell chime, gentle and reassuring, checkpoint reached, game sound effect'),
  S('sfx_plate_down', 0.9, 'Heavy stone pressure plate pressing down with a deep mechanical click and short rumble, game sound effect'),
  S('sfx_plate_up', 0.6, 'Stone pressure plate rising back up with a soft click, game sound effect'),
  S('sfx_gate', 2.8, 'Massive ancient stone gate grinding open slowly, deep rumbling scrape, game sound effect'),
  S('sfx_thud', 0.7, 'Heavy stone block dropping into place on a stone floor, solid thud, game sound effect'),
  S('sfx_melt', 1.4, 'Clay dissolving in water, wet bubbling sizzle and sloppy melting, game sound effect'),
  S('sfx_burn', 1.4, 'Small wooden figure bursting into flames, fiery whoosh and crackle, game sound effect'),
  S('sfx_shatter', 1.3, 'Small glass figure shattering into many pieces on a stone floor, game sound effect'),
  S('sfx_respawn', 1.4, 'Magical reforming, soft rising shimmer with a gentle warm whoosh, game sound effect'),
  S('sfx_awaken', 3.0, 'Ancient magic awakening, warm ethereal shimmer swell with soft choir-like resonance, game sound effect'),
  S('sfx_absorb', 1.6, 'Glowing magical orb absorbed into a body, rising whoosh with sparkling chimes, game sound effect'),
  S('sfx_restore', 3.5, 'Magical wave of colour sweeping across a room, shimmering whoosh with bright chimes and blooming warmth, game sound effect'),
  S('sfx_title_boom', 2.5, 'Deep cinematic boom with a long shimmering tail, title reveal, game sound effect'),
  S('sfx_ui_confirm', 0.6, 'Soft elegant interface confirm chime, game menu sound'),
  S('sfx_ui_move', 0.5, 'Soft subtle interface tick, game menu cursor sound'),
  S('sfx_ui_back', 0.5, 'Soft interface whoosh down, menu closing, game menu sound'),

  // ------------------------------------------------------------------ colossus and escape
  S('sfx_rumble', 3.5, 'Deep earthquake rumble in an ancient stone hall, rocks shifting and dust falling, game sound effect'),
  S('sfx_slam', 2.2, 'Colossal stone fist slamming into the ground, enormous booming impact with crashing debris, game sound effect'),
  S('sfx_colossus_roar', 3.5, 'Giant stone colossus roaring, deep grinding rocky growl, monstrous and ancient, game sound effect'),
  S('sfx_colossus_step', 1.5, 'Giant stone colossus footstep, earth shaking deep boom with rattling debris, game sound effect'),

  // ------------------------------------------------------------------ ambience loops
  LOOP('amb_hall', 20, 'Quiet ancient stone workshop interior, soft distant wind through high windows, faint dust, cavernous calm room tone'),
  LOOP('amb_water', 10, 'Gentle water flowing through a stone channel, continuous calm stream'),
  LOOP('amb_fire', 8, 'Steady crackling fire with a soft flame roar, continuous'),
  LOOP('amb_valley', 20, 'Peaceful green valley at dawn, gentle breeze, distant birdsong, leaves rustling'),
  LOOP('amb_collapse', 10, 'Continuous rumbling collapse, rocks falling and stone cracking in a crumbling hall, earthquake'),

  // ------------------------------------------------------------------ music
  M('mus_restore_sting', 10, 'Short magical orchestral sting: harp glissando, celesta and warm strings swelling into a bright major chord, wonder and discovery, instrumental'),
  M('mus_explore', 120, 'Gentle atmospheric orchestral score for a hand-crafted fantasy puzzle platformer: soft piano melody, warm strings, celesta, light choir pads, curious and hopeful, slow tempo, loopable, instrumental'),
  M('mus_escape', 75, 'Intense orchestral chase music for a fantasy adventure game: driving taiko and timpani percussion, urgent string ostinato, brass stabs, relentless rising tension, 140 bpm, instrumental'),
  M('mus_finale', 90, 'Emotional triumphant orchestral finale: soaring strings and choir, warm horns and piano, a world reborn, hopeful and bittersweet, fantasy game ending, instrumental'),
  M('mus_title', 60, 'Mysterious and wondrous title theme: solo piano with soft strings and a distant choir, an ancient magical workshop, quiet anticipation, instrumental'),

  // ------------------------------------------------------------------ the X teaser (~28 s, cut to the score)
  V('tz_vo1', 'Long ago... the Makers shaped everything... from living matter.'),
  V('tz_vo2', 'Then... they vanished.'),
  V('tz_vo3', 'But one small spark... remembered.'),
  V('tz_vo4', 'Become stone.'),
  V('tz_vo5', 'Become wood.'),
  V('tz_vo6', 'Become glass.'),
  V('tz_vo7', 'Become... what the world needs.'),
  S('tz_boom', 2.5, 'Deep cinematic trailer boom impact with a long sub bass tail, epic movie trailer sound design'),
  S('tz_braam', 3.0, 'Massive cinematic braam, huge distorted brass horn blast with sub bass, epic movie trailer'),
  S('tz_whoosh', 0.8, 'Fast cinematic whoosh transition, movie trailer sound design'),
  S('tz_riser', 3.0, 'Cinematic tension riser building up with rising pitch and intensity, ends abruptly, movie trailer'),
  S('tz_hit', 1.5, 'Sharp cinematic impact hit with metallic shimmer, movie trailer sound design'),
  S('tz_final', 4.0, 'Huge final movie trailer hit with a reverse cymbal swell before it and a long shimmering choir-like tail'),
  {
    id: 'tz_score',
    kind: 'music',
    plan: {
      positive_global_styles: ['epic cinematic fantasy trailer score', 'orchestral', 'choir', 'awe and wonder', 'instrumental'],
      negative_global_styles: ['vocals with lyrics', 'electronic dance', 'comedy', 'lo-fi'],
      sections: [
        { section_name: 'Intro', positive_local_styles: ['mysterious and sparse', 'soft solo piano notes', 'ethereal distant choir pad', 'low drone', 'very quiet'], negative_local_styles: ['drums', 'loud'], duration_ms: 9400, lines: [] },
        { section_name: 'Build', positive_local_styles: ['driving taiko drums and pulsing low strings ostinato', 'building intensity', 'big percussive hits on the downbeats', 'heroic'], negative_local_styles: ['quiet'], duration_ms: 10600, lines: [] },
        { section_name: 'Climax', positive_local_styles: ['massive orchestral climax', 'full choir', 'huge drums', 'brass'], negative_local_styles: ['soft'], duration_ms: 3000, lines: [] },
        { section_name: 'Title', positive_local_styles: ['a beat of silence then one huge final impact', 'shimmering strings and choir ring out', 'hopeful wonder'], negative_local_styles: ['drums after the impact'], duration_ms: 5500, lines: [] },
      ],
    },
  },
];
