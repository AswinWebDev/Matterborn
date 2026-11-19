#!/usr/bin/env node
// Matterborn asset factory: runs Aholo Lux3D / World jobs declared in assets.mjs.
//
//   npm run gen -- <jobId|group> [...]     run jobs (and their missing dependencies)
//   npm run gen -- --dry <jobId|group>     show what would be created, spend nothing
//   npm run gen:status                     print the manifest
//
// Options: --max-new=N (default 6) caps how many NEW paid tasks one run may create.
//          --force=<jobId> re-runs a finished job.
//          --reclassify=<jobId> re-reads a finished task and downloads its files again (free).
//
// Every task id is written to pipeline/manifest.json the moment it is created, so a crash
// or restart resumes polling instead of paying for the same task twice. Only a failure the
// provider itself reports (status 4/5/6, an error payload) marks a job "failed"; network
// errors, timeouts and download problems leave it "running" so the next run resumes it.
// Parameters are checked against the Lux3D contract before anything is created.

import { createLux3dClient, bufferToDataUrl, guessMimeType } from '@manycore/aholo-sdk-lux3d';
import { createWorldClient } from '@manycore/aholo-sdk-world';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS, GROUPS } from './assets.mjs';
import { deps, validateJob, classifyOutputs, isUrl } from './lux.mjs';
import { downloadOutputs } from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'pipeline', 'manifest.json');
const URL_TTL_MS = 100 * 60 * 1000; // result URLs live 2 h; refresh well before that

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, fallback) => {
  const f = flag(name);
  return f && f.includes('=') ? f.split('=').slice(1).join('=') : fallback;
};
const DRY = Boolean(flag('dry'));
const STATUS_ONLY = Boolean(flag('status'));
const MAX_NEW = Number(flagValue('max-new', '6'));
const FORCE = new Set((flagValue('force', '') || '').split(',').filter(Boolean));
const targets = args.filter((a) => !a.startsWith('--'));

const jobById = new Map(JOBS.map((j) => [j.id, j]));
for (const j of JOBS) {
  for (const d of deps(j)) if (!jobById.has(d)) throw new Error(`Job ${j.id} depends on unknown job ${d}`);
}

let manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : {};
let saveChain = Promise.resolve();
function saveManifest() {
  saveChain = saveChain.then(async () => {
    const tmp = MANIFEST + '.tmp';
    await writeFile(tmp, JSON.stringify(manifest, null, 2));
    await rename(tmp, MANIFEST);
  });
  return saveChain;
}

const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...m);

if (STATUS_ONLY) {
  printStatus();
  process.exit(0);
}
const RECLASSIFY = (flagValue('reclassify', '') || '').split(',').filter(Boolean);
if (!targets.length && !RECLASSIFY.length) {
  console.log('Usage: npm run gen -- <jobId|group> [...] [--dry] [--max-new=N] [--force=id] [--reclassify=id]');
  console.log('Groups:', Object.keys(GROUPS).join(', '));
  process.exit(1);
}

// accept the Aholo Lux3D skill's variable name too, so one key in .env serves both tools
if (!process.env.AHOLO_API_KEY && process.env.LUX3D_GLOBAL_API_KEY) process.env.AHOLO_API_KEY = process.env.LUX3D_GLOBAL_API_KEY;
if (!DRY && !process.env.AHOLO_API_KEY) {
  console.error('AHOLO_API_KEY is missing. Put it in .env (see .env.example).');
  process.exit(1);
}
const region = process.env.AHOLO_REGION || 'com';
const lux = DRY ? null : createLux3dClient({ region, timeoutMs: 120000, userAgent: 'matterborn-pipeline' });
const world = DRY ? null : createWorldClient({ region, timeoutMs: 120000, userAgent: 'matterborn-pipeline' });

// Re-read a finished task (fresh URLs), re-parse its outputs and download again. Costs nothing.
if (RECLASSIFY.length) {
  for (const id of RECLASSIFY) {
    const job = jobById.get(id);
    const rec = manifest[id];
    if (!job || !rec?.taskId || job.kind === 'world') {
      console.error(`cannot reclassify ${id}`);
      continue;
    }
    const r = await lux.tasks.retrieve(rec.taskId);
    rec.raw = r.outputs.map((o) => o.content);
    rec.urls = classifyOutputs(job, rec.raw);
    rec.urlsAt = Date.now();
    rec.files = await downloadOutputs(job, rec);
    if (r.status === 3) rec.status = 'done';
    await saveManifest();
    log(`RECLASSIFIED ${id}:`, Object.keys(rec.urls).join(', '));
  }
  process.exit(0);
}

// ---- dependency closure -------------------------------------------------------------
const wanted = new Set();
const addWithDeps = (id) => {
  if (wanted.has(id)) return;
  if (!jobById.has(id)) throw new Error(`Unknown job or group: ${id}`);
  wanted.add(id);
  deps(jobById.get(id)).forEach(addWithDeps);
};
for (const t of targets) (GROUPS[t] ? GROUPS[t] : [t]).forEach(addWithDeps);

// ---- contract checks (pipeline/lux.mjs) ---------------------------------------------
const invalid = [...wanted].map((id) => [id, validateJob(jobById.get(id))]).filter(([, e]) => e.length);
if (invalid.length) {
  for (const [id, e] of invalid) console.error(`INVALID ${id}: ${e.join('; ')}`);
  console.error('Nothing was created. Fix pipeline/assets.mjs first.');
  process.exit(1);
}

// ---- input resolution -----------------------------------------------------------------
async function refreshOutputs(depId) {
  const rec = manifest[depId];
  if (!rec?.taskId) throw new Error(`Dependency ${depId} has no task id`);
  if (rec.kind === 'world') return; // world assets are re-read from the world record
  if (Date.now() - (rec.urlsAt || 0) < URL_TTL_MS) return;
  log(`refreshing result URLs of ${depId}`);
  const r = await lux.tasks.retrieve(rec.taskId);
  rec.raw = r.outputs.map((o) => o.content);
  rec.urls = classifyOutputs(jobById.get(depId), rec.raw);
  rec.urlsAt = Date.now();
  await saveManifest();
}

async function resolveValue(v) {
  if (typeof v === 'string' && v.startsWith('@')) {
    const [depId, key] = v.slice(1).split('.');
    await refreshOutputs(depId);
    const url = manifest[depId].urls?.[key];
    if (!url) throw new Error(`Output "${key}" of ${depId} is not available (have: ${Object.keys(manifest[depId].urls || {}).join(', ')})`);
    return url;
  }
  if (typeof v === 'string' && v.startsWith('file:')) {
    const p = path.resolve(ROOT, v.slice(5));
    return bufferToDataUrl(await readFile(p), guessMimeType(p));
  }
  if (Array.isArray(v)) return Promise.all(v.map(resolveValue));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = await resolveValue(val);
    return out;
  }
  return v;
}

// ---- task creation per kind -------------------------------------------------------------
async function createTask(job, p) {
  switch (job.kind) {
    case 'image':
      return lux.multimodalToImage.create(p);
    case 'four-view':
      return lux.imageToFourView.create(p);
    case 'text3d':
      return lux.textTo3d.create(p);
    case 'img3d':
      return lux.imgTo3d.create(p);
    case 'material':
      return lux.materialTransfer.create(p);
    case 'split':
      return lux.partSplit.create(p);
    case 'articulate':
      return lux.articulationAnimation.create(p);
    case 'rig':
      return lux.humanoidAutoRig.create(p);
    case 'retarget':
      return lux.humanoidAnimationRetarget.create(p);
    case 'world': {
      const op = await world.generations.create(p);
      return op.worldId;
    }
    default:
      throw new Error(`Unknown job kind ${job.kind}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// An error the provider itself reported: the task really failed, a rerun may create a new one.
class ProviderFailure extends Error {}

// Poll a Lux3D task. The SDK's waitFor ignores status 5 (dispatch failed) and would spin until
// its timeout, so poll directly at the contract's recommended 10-15 s interval.
async function waitLux(taskId, timeoutMs = 45 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let queryErrors = 0;
  let lastStatus = -1;
  for (;;) {
    let r;
    try {
      r = await lux.tasks.retrieve(taskId);
      queryErrors = 0;
    } catch (err) {
      if (++queryErrors >= 5) throw err; // a query failure never justifies a new paid task
      await sleep(12000);
      continue;
    }
    if (r.status === 3) return r;
    if (r.status === 4 || r.status === 5 || r.status === 6) {
      const detail = (r.outputs || []).map((o) => o.content).filter(Boolean).join(' ').slice(0, 300);
      throw new ProviderFailure(`task ${taskId} ended with status ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    if (r.status !== lastStatus) {
      lastStatus = r.status;
      log(`     task ${taskId} status ${r.status}`);
    }
    if (Date.now() > deadline) throw new Error(`task ${taskId} still at status ${r.status} after ${timeoutMs / 60000} min (rerun to keep waiting)`);
    await sleep(12000);
  }
}

const WORLD_FAILED = new Set(['FAILED', 'CANCELED', 'TIMEOUT', 'REJECTED']);
async function pollWorld(worldId, timeoutMs = 60 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let queryErrors = 0;
  let last = '';
  for (;;) {
    let d;
    try {
      d = await world.retrieve(worldId);
      queryErrors = 0;
    } catch (err) {
      if (++queryErrors >= 5) throw err;
      await sleep(15000);
      continue;
    }
    if (d.status === 'SUCCEEDED') return d;
    if (WORLD_FAILED.has(d.status)) throw new ProviderFailure(`world ${worldId} ended with ${d.status}`);
    const now = `${d.status} ${Math.round((d.progress || 0) * 100)}%`;
    if (now !== last) log(`     world ${worldId} ${(last = now)}`);
    if (Date.now() > deadline) throw new Error(`world ${worldId} still ${d.status} after ${timeoutMs / 60000} min (rerun to keep waiting)`);
    await sleep(15000);
  }
}

// Did the server definitely refuse a create call (safe to retry), or is acceptance unknown?
function definitelyRejected(err) {
  const code = err?.statusCode;
  if (code && code >= 400 && code < 500) return true;
  return ['BusinessError', 'AuthenticationError', 'RateLimitError'].includes(err?.constructor?.name);
}

// ---- runner ------------------------------------------------------------------------------
let newTasks = 0;

async function runJob(job) {
  const prev = manifest[job.id];
  if (prev?.status === 'done' && !FORCE.has(job.id)) return prev;
  if (prev?.status === 'submission_unknown' && !FORCE.has(job.id)) {
    log(`HOLD ${job.id}: an earlier create call may have been accepted (${prev.error}). Check the task list on labs.aholo.ai; rerun with --force=${job.id} only if no task exists.`);
    return prev;
  }

  const resumable = prev?.taskId && prev.status === 'running' && !FORCE.has(job.id);
  if (!resumable) {
    if (DRY) {
      log(`DRY  ${job.id} (${job.kind})`, JSON.stringify(job.params).slice(0, 400));
      return { status: 'dry' };
    }
    if (newTasks >= MAX_NEW) {
      log(`SKIP ${job.id}: --max-new=${MAX_NEW} reached (raise it to create more paid tasks)`);
      return { status: 'skipped' };
    }
    newTasks += 1; // counted before the await so concurrent jobs cannot overshoot
    let params;
    try {
      params = await resolveValue(job.params);
    } catch (err) {
      newTasks -= 1; // nothing was sent
      log(`FAIL ${job.id} before create (nothing sent): ${err?.message || err}`);
      return { ...(prev || {}), status: 'input_error' };
    }
    let id;
    const attemptAt = Date.now();
    try {
      id = await createTask(job, params);
    } catch (err) {
      const rejected = definitelyRejected(err);
      manifest[job.id] = { ...(prev || {}), kind: job.kind, status: rejected ? 'failed' : 'submission_unknown', attemptAt, error: `create: ${err?.message || err}` };
      await saveManifest();
      log(`${rejected ? 'FAIL' : 'UNKNOWN'} ${job.id} at create: ${err?.message || err}`);
      return manifest[job.id];
    }
    const history = prev?.taskId ? [...(prev.history || []), { taskId: prev.taskId, status: prev.status, error: prev.error }] : prev?.history;
    manifest[job.id] = { kind: job.kind, taskId: id, status: 'running', createdAt: Date.now(), params: job.params, ...(history ? { history } : {}) };
    await saveManifest();
    log(`NEW  ${job.id} (${job.kind}) task ${id}`);
  } else {
    log(`RESUME ${job.id} task ${prev.taskId}`);
  }

  const rec = manifest[job.id];
  const started = Date.now();
  try {
    if (job.kind === 'world') {
      const d = await pollWorld(rec.taskId);
      rec.worldStatus = d.status;
      const s = d.assets?.splats?.urls || {};
      rec.urls = { ply: s.plyPath, spz: s.spzPath, lod: s.lodMetaPath, pano: d.assets?.imagery?.panoUrl };
      for (const k of Object.keys(rec.urls)) if (!rec.urls[k]) delete rec.urls[k];
      rec.upAxis = d.assets?.semanticsMetadata?.upAxis;
    } else {
      const r = await waitLux(rec.taskId);
      rec.raw = r.outputs.map((o) => o.content);
      rec.urls = classifyOutputs(job, rec.raw);
      rec.urlsAt = Date.now();
      if (rec.urls.error) throw new ProviderFailure(`task reported error: ${rec.urls.error}`);
      if (job.kind === 'retarget') {
        const ok = Object.keys(rec.urls).filter((k) => k.startsWith('anim:'));
        const bad = Object.keys(rec.urls).filter((k) => k.startsWith('animError:'));
        if (!ok.length) throw new ProviderFailure(`no animation succeeded (${bad.map((k) => `${k.slice(10)}: ${rec.urls[k]}`).join('; ') || 'empty result'})`);
        if (bad.length) log(`WARN ${job.id}: ${bad.length} of ${ok.length + bad.length} animations failed: ${bad.map((k) => k.slice(10)).join(', ')}`);
      }
      if (!Object.values(rec.urls).some(isUrl)) throw new ProviderFailure(`no downloadable output in ${JSON.stringify(rec.raw).slice(0, 200)}`);
    }
    if (!rec.seconds) rec.seconds = Math.round((Date.now() - (rec.createdAt || started)) / 1000);
    await saveManifest();
    rec.files = await downloadOutputs(job, rec);
    rec.status = 'done';
    delete rec.lastError;
    await saveManifest();
    log(`DONE ${job.id} in ${rec.seconds}s ->`, Object.values(rec.files).join(', '));
  } catch (err) {
    if (err instanceof ProviderFailure) {
      rec.status = 'failed';
      rec.error = err.message;
      log(`FAIL ${job.id}: ${rec.error}`);
    } else {
      // our side failed (network, timeout, download): keep the task so a rerun resumes it for free
      rec.status = 'running';
      rec.lastError = String(err?.message || err);
      log(`PAUSED ${job.id}: ${rec.lastError} (rerun to resume task ${rec.taskId})`);
    }
    await saveManifest();
  }
  return rec;
}

async function main() {
  const pending = new Set([...wanted].filter((id) => manifest[id]?.status !== 'done' || FORCE.has(id)));
  const running = new Map();
  const failed = new Set();
  const LIMIT = 4; // Lux3D tasks at once (free accounts allow 5 per account)
  const WORLD_LIMIT = 2; // World generation is a separate service and does not use Lux3D slots
  const busy = (world) => [...running.keys()].filter((r) => (jobById.get(r).kind === 'world') === world).length;
  log(`jobs to run: ${[...pending].join(', ') || '(none, all done)'}`);
  while (pending.size || running.size) {
    for (const id of [...pending]) {
      const job = jobById.get(id);
      if (job.kind === 'world' ? busy(true) >= WORLD_LIMIT : busy(false) >= LIMIT) continue;
      const ds = deps(job);
      const stuck = ds.find((d) => failed.has(d) || (manifest[d]?.status === 'failed' && !pending.has(d) && !running.has(d)));
      if (stuck) {
        pending.delete(id);
        failed.add(id);
        log(`BLOCKED ${id}: dependency ${stuck} did not finish (${manifest[stuck]?.status || 'not started'})`);
        continue;
      }
      const ready = ds.every((d) => manifest[d]?.status === 'done' || (DRY && !pending.has(d) && !running.has(d)));
      // only one part-split task may run per account at a time
      const splitBusy = job.kind === 'split' && [...running.keys()].some((r) => jobById.get(r).kind === 'split');
      if (!ready || splitBusy) continue;
      pending.delete(id);
      running.set(id, runJob(job).then((rec) => {
        running.delete(id);
        if (rec.status !== 'done' && rec.status !== 'dry') failed.add(id);
      }));
    }
    if (!running.size && pending.size) {
      // nothing runnable: remaining jobs wait on deps that were skipped/failed
      for (const id of pending) log(`WAITING ${id}: dependencies not finished`);
      break;
    }
    if (running.size) await Promise.race(running.values());
  }
  await saveManifest();
  printStatus([...wanted]);
}

function printStatus(only) {
  const ids = only || Object.keys(manifest);
  console.log('\njob'.padEnd(28), 'status'.padEnd(9), 'secs'.padStart(5), ' files');
  for (const id of ids) {
    const r = manifest[id];
    if (!r) {
      console.log(id.padEnd(27), 'new');
      continue;
    }
    const files = r.files ? Object.keys(r.files).length : 0;
    console.log(id.padEnd(27), String(r.status).padEnd(9), String(r.seconds ?? '').padStart(5), ` ${files}`, r.error ? ` ERR ${r.error}` : '');
  }
}

await main();
