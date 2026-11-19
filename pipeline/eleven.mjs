// ElevenLabs audio generator for Matterborn: narrator lines (text to speech), sound effects and
// ambience loops (sound generation) and music (Eleven Music). Jobs live in pipeline/sound-jobs.mjs.
//
//   node --env-file=.env pipeline/eleven.mjs --dry              list what would be generated
//   node --env-file=.env pipeline/eleven.mjs --only a,b         generate just these jobs
//   node --env-file=.env pipeline/eleven.mjs --kind sfx         generate one kind (voice | sfx | music)
//   node --env-file=.env pipeline/eleven.mjs --measure ...      one at a time, record credits per job
//
// Resume-safe: a job already recorded in pipeline/audio-manifest.json with its file on disk is
// never generated again (credits are spent once). --force together with --only redoes a job.
// The API key is read from ELEVENLABS_API_KEY and never printed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS, VOICES } from './sound-jobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'game/public/audio');
const MANIFEST = path.join(ROOT, 'pipeline/audio-manifest.json');
const API = 'https://api.elevenlabs.io';
const KEY = process.env.ELEVENLABS_API_KEY;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = flag('--dry');
const measure = flag('--measure');
const force = flag('--force');
const only = opt('--only')?.split(',').map((s) => s.trim());
const kind = opt('--kind');
const max = Number(opt('--max') ?? Infinity);
const concurrency = measure ? 1 : Number(opt('--concurrency') ?? 3);

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { jobs: {} };
const saveManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const done = (j) => manifest.jobs[j.id] && fs.existsSync(path.join(OUT, manifest.jobs[j.id].file));
let todo = JOBS.filter((j) => (!only || only.includes(j.id)) && (!kind || j.kind === kind));
if (!(force && only)) todo = todo.filter((j) => !done(j));
todo = todo.slice(0, max);

if (only) for (const id of only) if (!JOBS.some((j) => j.id === id)) console.warn(`unknown job: ${id}`);

const estimate = (j) => (j.kind === 'voice' ? j.text.length : j.kind === 'sfx' ? Math.ceil(j.duration * 40) : Math.ceil((j.ms / 1000) * 30));
console.log(`${todo.length} job(s) to generate${dry ? ' (dry run)' : ''}`);
for (const j of todo) console.log(`  ${j.id.padEnd(20)} ${j.kind.padEnd(5)} ${j.kind === 'voice' ? JSON.stringify(j.text) : j.plan ? 'composition plan, ' + j.plan.sections.length + ' sections' : `${j.kind === 'music' ? j.ms / 1000 : j.duration}s${j.loop ? ' loop' : ''}  ${j.prompt.slice(0, 70)}`}  (~${j.plan ? 900 : estimate(j)} cr)`);
if (dry || !todo.length) process.exit(0);
if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set (run with node --env-file=.env)');
  process.exit(1);
}

async function creditsUsed() {
  const r = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': KEY } });
  if (!r.ok) return null;
  const j = await r.json();
  return { used: j.character_count, limit: j.character_limit };
}

function request(j) {
  const fmt = 'output_format=mp3_44100_128';
  if (j.kind === 'voice') {
    const voice = VOICES[j.voice];
    return {
      url: `${API}/v1/text-to-speech/${voice.id}?${fmt}`,
      body: { text: j.text, model_id: j.model ?? 'eleven_v4' },
      meta: { voice: voice.label, model: j.model ?? 'eleven_v4', text: j.text },
    };
  }
  if (j.kind === 'sfx') {
    const body = { text: j.prompt, duration_seconds: j.duration, prompt_influence: j.influence ?? 0.5, model_id: 'eleven_text_to_sound_v2' };
    if (j.loop) body.loop = true;
    return { url: `${API}/v1/sound-generation?${fmt}`, body, meta: { model: body.model_id, prompt: j.prompt, duration: j.duration, loop: !!j.loop } };
  }
  if (j.plan) {
    // a composition plan: timed sections, so the cue's build and hits land where the edit needs them
    return {
      url: `${API}/v1/music?${fmt}`,
      body: { composition_plan: j.plan, model_id: 'music_v1', respect_sections_durations: true },
      meta: { model: 'music_v1', plan: j.plan, seconds: j.plan.sections.reduce((a, x) => a + x.duration_ms, 0) / 1000 },
    };
  }
  return {
    url: `${API}/v1/music?${fmt}`,
    body: { prompt: j.prompt, music_length_ms: j.ms, model_id: 'music_v1', force_instrumental: true },
    meta: { model: 'music_v1', prompt: j.prompt, seconds: j.ms / 1000 },
  };
}

async function generate(j) {
  const { url, body, meta } = request(j);
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = (await r.text()).slice(0, 400);
      // 429 = too many concurrent requests: wait and retry; anything else is a real error
      if ((r.status === 429 || r.status >= 500) && attempt < 5) {
        await new Promise((res) => setTimeout(res, 2000 * attempt));
        continue;
      }
      throw new Error(`${r.status} ${text}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const file = `${j.id}.mp3`;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, file), buf);
    return {
      kind: j.kind,
      file,
      bytes: buf.length,
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
      cost: r.headers.get('character-cost') ?? r.headers.get('x-character-count') ?? undefined,
      ...meta,
      createdAt: new Date().toISOString(),
    };
  }
}

const before = await creditsUsed();
if (before) console.log(`credits used before: ${before.used} / ${before.limit}`);
let failed = 0;
const queue = [...todo];
async function worker() {
  for (let j = queue.shift(); j; j = queue.shift()) {
    const c0 = measure ? await creditsUsed() : null;
    try {
      const rec = await generate(j);
      if (measure) {
        const c1 = await creditsUsed();
        if (c0 && c1) rec.credits = c1.used - c0.used;
      }
      manifest.jobs[j.id] = rec;
      saveManifest();
      console.log(`ok   ${j.id.padEnd(20)} ${(rec.bytes / 1024).toFixed(0)} KB  ${rec.seconds}s${rec.credits !== undefined ? `  ${rec.credits} credits` : ''}${rec.cost ? `  (header cost ${rec.cost})` : ''}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${j.id.padEnd(20)} ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
const after = await creditsUsed();
if (before && after) console.log(`credits used after: ${after.used} / ${after.limit}  (this run: ${after.used - before.used})`);
if (failed) process.exitCode = 1;
