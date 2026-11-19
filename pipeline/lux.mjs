// Pure helpers for the Lux3D asset factory (no network, no file system), so they can be tested
// without an API key: job dependencies, contract checks and output classification.
// Field names and slot orders follow the official lux3d-generation/v1 contract shipped with the
// aholo-lux3d skill (core/contracts/lux3d-generation.v1.json).

import path from 'node:path';
import { HUMANOID_ANIMATION_IDS } from '@manycore/aholo-sdk-lux3d';

/** Ids of the jobs a job's params reference through "@job.key". */
export function deps(job) {
  const out = new Set();
  const visit = (v) => {
    if (typeof v === 'string' && v.startsWith('@')) out.add(v.slice(1).split('.')[0]);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(job.params);
  return [...out];
}

export function extOf(u) {
  try {
    return path.extname(new URL(u).pathname).toLowerCase().replace('.', '');
  } catch {
    return '';
  }
}
export function isUrl(s) {
  return typeof s === 'string' && /^https?:\/\//.test(s);
}

// ---- contract checks ---------------------------------------------------------------------
const STYLES = ['photorealistic', 'cartoon', 'anime', 'hand_painted', 'cyberpunk', 'fantasy', 'glass'];
const ANIM_IDS = new Set(HUMANOID_ANIMATION_IDS);

/** Problems with a job's parameters, checked before any paid task is created. */
export function validateJob(job) {
  const p = job.params || {};
  const e = [];
  const has = (k) => p[k] !== undefined && p[k] !== null && p[k] !== '';
  const onlyKeys = (allowed) => Object.keys(p).filter((k) => !allowed.includes(k)).forEach((k) => e.push(`unexpected field ${k}`));
  switch (job.kind) {
    case 'text3d':
    case 'img3d':
      if (!['G1', 'G1-Turbo'].includes(p.version)) e.push('version must be G1 or G1-Turbo');
      if (job.kind === 'text3d' && !String(p.prompt || '').trim()) e.push('prompt is required');
      if (job.kind === 'img3d' && has('img') === has('imgs')) e.push('exactly one of img / imgs is required');
      if (has('faceCount') && !(Number.isInteger(p.faceCount) && p.faceCount >= 10000 && p.faceCount <= 300000)) e.push('faceCount must be 10000-300000');
      if (has('style') && !STYLES.includes(p.style)) e.push(`unknown style ${p.style}`);
      if (has('outputFormat') && !(Array.isArray(p.outputFormat) && p.outputFormat.every((f) => ['zip', 'glb', 'ply'].includes(f)))) e.push('outputFormat must use zip/glb/ply');
      if (p.version === 'G1' && 'enablePbr' in p) e.push('G1 forbids enablePbr');
      if (p.version === 'G1-Turbo' && 'customSize' in p) e.push('G1-Turbo forbids customSize');
      break;
    case 'material':
      if (p.version !== 'v3.0-standard') e.push('material transfer version must be v3.0-standard');
      if (!has('img') || !has('meshUrl')) e.push('img and meshUrl are required');
      if (has('outputFormat') && !(Array.isArray(p.outputFormat) && p.outputFormat.every((f) => ['zip', 'glb', 'usdz', 'obj_zip', 'fbx_zip'].includes(f)))) e.push('bad outputFormat');
      if (p.aiPredictSize === true && has('customSize')) e.push('customSize conflicts with aiPredictSize');
      break;
    case 'image':
    case 'four-view':
      if (!has('img') && !has('prompt')) e.push('img or prompt is required');
      break;
    case 'rig':
      onlyKeys(['modelUrl']);
      if (!has('modelUrl')) e.push('modelUrl is required');
      break;
    case 'retarget': {
      onlyKeys(['rigModelUrl', 'animationIds', 'animationOutputMode', 'outFormat', 'animateInPlace']);
      const ids = p.animationIds;
      if (!has('rigModelUrl')) e.push('rigModelUrl is required');
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) e.push('animationIds needs 1-10 entries');
      else {
        if (new Set(ids).size !== ids.length) e.push('animationIds has duplicates');
        ids.filter((id) => !ANIM_IDS.has(id)).forEach((id) => e.push(`unknown animation id ${id}`));
      }
      if (has('animationOutputMode') && !['separate', 'combined'].includes(p.animationOutputMode)) e.push('bad animationOutputMode');
      if (has('outFormat') && !['glb', 'fbx'].includes(p.outFormat)) e.push('bad outFormat');
      if ('animateInPlace' in p && typeof p.animateInPlace !== 'boolean') e.push('animateInPlace must be a boolean');
      break;
    }
    case 'articulate':
      onlyKeys(['glbUrl', 'prompt']);
      if (!has('glbUrl') || !String(p.prompt || '').trim()) e.push('glbUrl and prompt are required');
      break;
    case 'split':
      onlyKeys(['glbUrl']);
      if (!has('glbUrl')) e.push('glbUrl is required');
      break;
    case 'world':
      if (!has('prompt') && !(Array.isArray(p.resources) && p.resources.length)) e.push('prompt or resources is required');
      break;
    default:
      e.push(`unknown kind ${job.kind}`);
  }
  return e;
}

// ---- output classification -------------------------------------------------------------------
/**
 * Turn raw task outputs into named URLs: { glb, zip, image, ply, 'anim:<id>': url, ... }.
 * The file extension decides first; then the slot order the contract fixes for each operation,
 * so a URL without an extension still lands under the right name. Retarget results become
 * 'anim:<animation_id>' (success) or 'animError:<animation_id>' (failure details).
 */
export function classifyOutputs(job, raw) {
  const urls = {};
  const take = (u) => {
    const e = extOf(u);
    const key = ['png', 'jpg', 'jpeg', 'webp'].includes(e) ? 'image' : e || 'file';
    if (!urls[key]) urls[key] = u;
  };
  for (const c of raw) {
    if (!c || c === 'NOT_REQUESTED' || c === 'null') continue;
    if (isUrl(c)) {
      take(c);
      continue;
    }
    // JSON payloads: four-view (array of URLs), retarget ({actions}), rig error ({error})
    let parsed;
    try {
      parsed = JSON.parse(c);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) {
      const names = ['front', 'opposite', 'side', 'back'];
      parsed.forEach((u, i) => isUrl(u) && (urls[names[i] || `view${i}`] = u));
    } else if (parsed && Array.isArray(parsed.actions)) {
      // retarget: one result per requested animation_id; a success carries animationGlbUrl (glb)
      // or fbxUrl (fbx), a failure carries error.code / error.message
      for (const a of parsed.actions) {
        const id = a.animation_id || a.animationId || a.id || a.name;
        const u = a.animationGlbUrl || a.fbxUrl || a.url || a.resultUrl || a.fileUrl || a.downloadUrl;
        if (id && isUrl(u)) urls[`anim:${id}`] = u;
        else if (id) urls[`animError:${id}`] = JSON.stringify(a.error ?? a).slice(0, 300);
      }
    } else if (parsed && parsed.error) {
      urls.error = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error).slice(0, 300);
    }
  }
  const slot = (i) => (isUrl(raw[i]) ? raw[i] : null);
  const claim = (key, u) => {
    if (!u || urls[key]) return;
    for (const k of Object.keys(urls)) if (urls[k] === u) delete urls[k]; // drop the 'file' guess
    urls[key] = u;
  };
  if (job.kind === 'rig') claim('glb', slot(0));
  if (job.kind === 'material') claim('glb', slot(1)); // fixed slots: zip, glb, usdz, obj_zip, fbx_zip
  if (job.kind === 'text3d' || job.kind === 'img3d') {
    const p = job.params || {};
    const req = p.outputFormat || (p.version === 'G1' ? [] : ['zip']);
    // G1 always returns ZIP then GLB (then PLY); G1-Turbo returns the requested formats in that order
    const order = p.version === 'G1' ? ['zip', 'glb', ...(req.includes('ply') ? ['ply'] : [])] : ['zip', 'glb', 'ply'].filter((f) => req.includes(f));
    if (order.includes('glb')) claim('glb', slot(order.indexOf('glb')));
  }
  if (job.kind === 'image') claim('image', slot(0));
  if (job.kind === 'articulate' && !urls.glb) claim('result', slot(0));
  return urls;
}
