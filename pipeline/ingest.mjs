#!/usr/bin/env node
// Bridge for generating through the Aholo Lux3D MCP server (the agent's Aholo sign-in, no API key):
// the agent creates and polls tasks with the MCP tools, and this script keeps pipeline/manifest.json
// and pipeline/cache/ exactly as gen.mjs would, so process.mjs works the same either way.
//
//   node pipeline/ingest.mjs next [group]              jobs ready to create now (deps done, not created)
//   node pipeline/ingest.mjs params <jobId>            the job's request body, @refs filled with real URLs
//   node pipeline/ingest.mjs created <jobId> <taskId>  record a task the moment it is created
//   node pipeline/ingest.mjs result <jobId> <file|->   ingest a get-task response (JSON file or stdin)
//   node pipeline/ingest.mjs status
//
// A job with a task id is never created again: resume by querying that task id.

import { readFile } from 'node:fs/promises';
import { JOBS, GROUPS } from './assets.mjs';
import { deps, validateJob, classifyOutputs, isUrl } from './lux.mjs';
import { loadManifest, saveManifest, downloadOutputs } from './store.mjs';

const URL_TTL_MS = 100 * 60 * 1000; // result URLs live 2 h
const [cmd, a1, a2] = process.argv.slice(2);
const jobById = new Map(JOBS.map((j) => [j.id, j]));
const manifest = await loadManifest();
const job = (id) => {
  const j = jobById.get(id);
  if (!j) throw new Error(`unknown job ${id}`);
  return j;
};

function resolve(v, stale) {
  if (typeof v === 'string' && v.startsWith('@')) {
    const [dep, key] = v.slice(1).split('.');
    const rec = manifest[dep];
    if (rec?.status !== 'done') throw new Error(`${dep} is not finished yet (${rec?.status ?? 'not created'})`);
    const url = rec.urls?.[key];
    if (!url) throw new Error(`${dep} has no "${key}" output (have: ${Object.keys(rec.urls || {}).join(', ')})`);
    if (Date.now() - (rec.urlsAt || 0) > URL_TTL_MS) stale.add(dep);
    return url;
  }
  if (typeof v === 'string' && v.startsWith('file:')) throw new Error('file: inputs need the Asset upload flow (API key); not supported over MCP');
  if (Array.isArray(v)) return v.map((x) => resolve(x, stale));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, stale)]));
  return v;
}

/** Find the task fields in whatever envelope the MCP tool returns. */
function extractTask(obj) {
  let found = null;
  const visit = (o) => {
    if (found || !o || typeof o !== 'object') return;
    if (Array.isArray(o.outputs) || ('status' in o && ('taskId' in o || 'taskid' in o))) {
      found = o;
      return;
    }
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && /^\s*[{[]/.test(v)) {
        try {
          visit(JSON.parse(v));
        } catch {
          // not JSON
        }
      } else visit(v);
    }
  };
  visit(obj);
  return found;
}

function printStatus(ids = Object.keys(manifest)) {
  for (const id of ids) {
    const r = manifest[id];
    console.log(id.padEnd(24), String(r?.status ?? 'new').padEnd(10), String(r?.taskId ?? '').padEnd(22), r?.seconds ? `${r.seconds}s` : '', r?.error ? `ERR ${r.error}` : '');
  }
}

try {
switch (cmd) {
  case 'next': {
    const pool = a1 ? (GROUPS[a1] ?? [a1]) : JOBS.map((j) => j.id);
    const want = new Set();
    const add = (id) => {
      if (want.has(id)) return;
      want.add(id);
      deps(job(id)).forEach(add);
    };
    pool.forEach(add);
    const ready = [...want].filter((id) => !manifest[id]?.taskId && deps(job(id)).every((d) => manifest[d]?.status === 'done'));
    const waiting = [...want].filter((id) => !manifest[id]?.taskId && !ready.includes(id));
    const running = [...want].filter((id) => manifest[id]?.status === 'running');
    console.log(JSON.stringify({ ready, running: running.map((id) => [id, manifest[id].taskId]), waiting }, null, 1));
    break;
  }
  case 'params': {
    const j = job(a1);
    const problems = validateJob(j);
    if (problems.length) throw new Error(`invalid job ${j.id}: ${problems.join('; ')}`);
    if (manifest[j.id]?.taskId && manifest[j.id].status !== 'failed') console.error(`note: ${j.id} already has task ${manifest[j.id].taskId} (${manifest[j.id].status}); query it instead of creating again`);
    const stale = new Set();
    const body = resolve(j.params, stale);
    if (stale.size) console.error(`warning: result URLs of ${[...stale].join(', ')} may have expired; re-query those tasks and ingest them again first`);
    console.log(JSON.stringify({ kind: j.kind, body }, null, 1));
    break;
  }
  case 'created': {
    const j = job(a1);
    if (!a2) throw new Error('usage: created <jobId> <taskId>');
    const prev = manifest[j.id];
    if (prev?.taskId && prev.status !== 'failed' && String(prev.taskId) !== String(a2)) throw new Error(`${j.id} already has task ${prev.taskId} (${prev.status})`);
    const history = prev?.taskId && String(prev.taskId) !== String(a2) ? [...(prev.history || []), { taskId: prev.taskId, status: prev.status, error: prev.error }] : prev?.history;
    manifest[j.id] = { kind: j.kind, taskId: String(a2), status: 'running', createdAt: Date.now(), via: 'mcp', params: j.params, ...(history ? { history } : {}) };
    await saveManifest(manifest);
    console.log(`recorded ${j.id} task ${a2}`);
    break;
  }
  case 'result': {
    const j = job(a1);
    const rec = manifest[j.id];
    if (!rec?.taskId) throw new Error(`${j.id} has no task id; record it with "created" first`);
    const text = a2 && a2 !== '-' ? await readFile(a2, 'utf8') : await new Promise((r) => {
      let s = '';
      process.stdin.on('data', (c) => (s += c));
      process.stdin.on('end', () => r(s));
    });
    const task = extractTask(JSON.parse(text));
    if (!task) throw new Error('no task (status/outputs) found in that response');
    const status = Number(task.status);
    const raw = (task.outputs || []).map((o) => (typeof o === 'string' ? o : o?.content));
    if (status === 4 || status === 5 || status === 6) {
      rec.status = 'failed';
      rec.error = `status ${status}: ${raw.filter(Boolean).join(' ').slice(0, 300)}`;
      await saveManifest(manifest);
      console.log(`FAILED ${j.id}: ${rec.error}`);
      process.exit(2);
    }
    if (status !== 3) {
      console.log(`${j.id} still running (status ${status})`);
      break;
    }
    rec.raw = raw;
    rec.urls = classifyOutputs(j, raw);
    rec.urlsAt = Date.now();
    if (rec.urls.error) {
      rec.status = 'failed';
      rec.error = `task reported error: ${rec.urls.error}`;
      await saveManifest(manifest);
      console.log(`FAILED ${j.id}: ${rec.error}`);
      process.exit(2);
    }
    if (j.kind === 'retarget' && !Object.keys(rec.urls).some((k) => k.startsWith('anim:'))) {
      rec.status = 'failed';
      rec.error = 'no animation succeeded';
      await saveManifest(manifest);
      console.log(`FAILED ${j.id}: ${JSON.stringify(rec.urls).slice(0, 300)}`);
      process.exit(2);
    }
    if (!Object.values(rec.urls).some(isUrl)) throw new Error(`no downloadable output in ${JSON.stringify(raw).slice(0, 200)}`);
    if (!rec.seconds) rec.seconds = Math.round((Date.now() - (rec.createdAt || Date.now())) / 1000);
    rec.files = await downloadOutputs(j, rec);
    rec.status = 'done';
    delete rec.error;
    await saveManifest(manifest);
    const failedAnims = Object.keys(rec.urls).filter((k) => k.startsWith('animError:'));
    console.log(`DONE ${j.id} -> ${Object.values(rec.files).join(', ')}${failedAnims.length ? ` (failed clips: ${failedAnims.map((k) => k.slice(10)).join(', ')})` : ''}`);
    break;
  }
  case 'status':
    printStatus(a1 ? (GROUPS[a1] ?? [a1]) : undefined);
    break;
  default:
    console.log('usage: node pipeline/ingest.mjs next [group] | params <job> | created <job> <taskId> | result <job> <file|-> | status [group]');
    process.exit(1);
}
} catch (err) {
  console.error(`error: ${err?.message || err}`);
  process.exit(1);
}
