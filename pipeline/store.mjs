// Shared storage for the asset factory: the pipeline manifest (task ids, outputs, files) and
// downloads into pipeline/cache/<job>/. Used by gen.mjs (OpenAPI with a key) and ingest.mjs
// (results of Lux3D MCP calls made through the agent's Aholo sign-in).

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { extOf, isUrl } from './lux.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = path.join(ROOT, 'pipeline', 'cache');
export const MANIFEST = path.join(ROOT, 'pipeline', 'manifest.json');

export async function loadManifest() {
  return existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : {};
}

let chain = Promise.resolve();
/** Atomic, serialised write of the whole manifest. */
export function saveManifest(manifest) {
  chain = chain.then(async () => {
    const tmp = MANIFEST + '.tmp';
    await writeFile(tmp, JSON.stringify(manifest, null, 2));
    await rename(tmp, MANIFEST);
  });
  return chain;
}

export async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf;
}

// file extension when the URL has none, by output name
const DEFAULT_EXT = { glb: 'glb', zip: 'zip', image: 'png', ply: 'ply', spz: 'spz', pano: 'jpg', result: 'bin' };

/** Download every output URL of a finished task; ZIPs are unpacked and their GLB recorded. */
export async function downloadOutputs(job, rec) {
  const dir = path.join(CACHE, job.id);
  const files = {};
  for (const [key, url] of Object.entries(rec.urls || {})) {
    if (!isUrl(url)) continue;
    if (key === 'zip' && rec.urls.glb) continue; // the GLB already embeds the PBR textures
    if (job.kind === 'world' && key === 'ply') continue; // SPZ carries the same splats, far smaller
    const isAnim = key.startsWith('anim:');
    const ext = extOf(url) || (isAnim ? (job.params?.outFormat === 'fbx' ? 'fbx' : 'glb') : DEFAULT_EXT[key] || 'bin');
    const name = isAnim ? `${key.slice(5)}.${ext}` : `${key}.${ext}`;
    const dest = path.join(dir, name);
    const buf = await download(url, dest);
    files[key] = path.relative(ROOT, dest);
    if (ext === 'zip') {
      const entries = unzipSync(new Uint8Array(buf));
      for (const [entry, data] of Object.entries(entries)) {
        if (entry.endsWith('/')) continue;
        const out = path.join(dir, 'unzipped', entry);
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, data);
        if (entry.toLowerCase().endsWith('.glb') && !files.glb) files.glb = path.relative(ROOT, out);
      }
    }
  }
  return files;
}
