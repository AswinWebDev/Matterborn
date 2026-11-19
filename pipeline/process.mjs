#!/usr/bin/env node
// Matterborn asset post-process: turns finished Lux3D / World outputs (pipeline/cache) into
// web-ready files under game/public/assets and rebuilds the manifest the game reads.
//
//   npm run process                         every finished job with a `post` entry (assets.mjs)
//   npm run process -- --only=hero_rig,obj_block
//   npm run process -- --manifest=<pipeline manifest> --out=<assets dir>   (tests)
//
// Models: dedup / weld / prune, textures resized and re-encoded as WebP (sharp), geometry and
// animation data compressed with EXT_meshopt_compression (the game's GLTFLoader decodes it).
// Retargeted clips: meshes, materials and skins are stripped so each clip is just bone motion;
// every clip is checked against the rig's bone names before it is listed in the manifest.
// Tiling textures are made seamless. Costs no credits; safe to rerun at any time.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS } from './assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const PIPE_MANIFEST = path.resolve(ROOT, opt('manifest', 'pipeline/manifest.json'));
const OUT = path.resolve(ROOT, opt('out', 'game/public/assets'));
const MEDIA = path.resolve(ROOT, opt('media', 'docs/media'));
const ONLY = new Set((opt('only', '') || '').split(',').filter(Boolean));
const inputBase = path.dirname(PIPE_MANIFEST) === path.join(ROOT, 'pipeline') ? ROOT : path.dirname(PIPE_MANIFEST);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

const pipe = existsSync(PIPE_MANIFEST) ? JSON.parse(await readFile(PIPE_MANIFEST, 'utf8')) : {};
const gameManifestPath = path.join(OUT, 'manifest.json');
const previous = existsSync(gameManifestPath) ? JSON.parse(await readFile(gameManifestPath, 'utf8')) : null;
const manifest = { generatedAt: new Date().toISOString(), models: {}, anims: {}, textures: {} };
const report = { generatedAt: manifest.generatedAt, assets: [], problems: [] };
const problem = (msg) => {
  report.problems.push(msg);
  console.warn(`  ! ${msg}`);
};
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const src = (rel) => path.resolve(inputBase, rel);

// ---- glTF helpers ---------------------------------------------------------------------------
function docStats(doc) {
  const root = doc.getRoot();
  let tris = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (prim.getMode() === 4) tris += Math.round((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  const texSizes = root.listTextures().map((t) => t.getSize()?.join('x') ?? '?');
  return {
    tris,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: texSizes,
    skins: root.listSkins().length,
    joints: root.listSkins().reduce((n, s) => n + s.listJoints().length, 0),
    animations: root.listAnimations().map((a) => a.getName() || '(unnamed)'),
    nodes: root.listNodes().length,
  };
}

function bounds(doc) {
  // world-space bounds of all mesh positions (rest pose), enough to sanity-check scale
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const lo = pos.getNormalized() ? pos.getMinNormalized([]) : pos.getMin([]);
      const hi = pos.getNormalized() ? pos.getMaxNormalized([]) : pos.getMax([]);
      for (const cx of [lo[0], hi[0]])
        for (const cy of [lo[1], hi[1]])
          for (const cz of [lo[2], hi[2]]) {
            const p = [m[0] * cx + m[4] * cy + m[8] * cz + m[12], m[1] * cx + m[5] * cy + m[9] * cz + m[13], m[2] * cx + m[6] * cy + m[10] * cz + m[14]];
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], p[i]);
              max[i] = Math.max(max[i], p[i]);
            }
          }
    }
  }
  return min[0] === Infinity ? null : { min, max, size: max.map((v, i) => +(v - min[i]).toFixed(3)) };
}

async function compressTextures(doc, size) {
  // colour data as lossy WebP; normal maps at higher quality to avoid banding in lighting
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 84, slots: /^(?!normalTexture$).*/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 95, slots: /^normalTexture$/ }),
  );
}

async function processModel(job, file, dest, { tex = 1024, keepAnimations = false } = {}) {
  const inPath = src(file);
  const before = (await stat(inPath)).size;
  const doc = await io.read(inPath);
  const s0 = docStats(doc);
  if (!s0.meshes) throw new Error('no meshes in GLB');
  const transforms = [dedup(), weld(), prune({ keepLeaves: s0.skins > 0, keepAttributes: s0.skins > 0 })];
  if (keepAnimations && s0.animations.length) transforms.push(resample());
  await doc.transform(...transforms);
  const b = bounds(doc);
  await compressTextures(doc, tex);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await mkdir(path.dirname(dest), { recursive: true });
  await io.write(dest, doc);
  const after = (await stat(dest)).size;
  const s1 = docStats(doc);
  if (s0.skins && !s1.skins) throw new Error('skin was lost during optimisation');
  if (!b || b.size.some((v) => !(v > 0))) problem(`${job.id}: degenerate bounds ${JSON.stringify(b)}`);
  return { before, after, statsIn: s0, statsOut: s1, bounds: b };
}

// strip a retargeted clip GLB down to the animated skeleton
async function processClip(job, clipId, file, dest, rigNames) {
  const inPath = src(file);
  const before = (await stat(inPath)).size;
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  if (!anims.length) throw new Error('no animation in clip file');
  if (anims.length > 1) problem(`${job.id}/${clipId}: ${anims.length} animations in one file, keeping the longest`);
  // keep only the longest animation (separate mode should give exactly one)
  const dur = (a) => Math.max(0, ...a.listSamplers().map((s) => (s.getInput()?.getMax([])[0] ?? 0)));
  const keep = anims.reduce((a, b) => (dur(b) > dur(a) ? b : a));
  for (const a of anims) if (a !== keep) a.dispose();
  keep.setName(clipId);
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
    node.setCamera(null);
  }
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMeshes()) m.dispose();
  await doc.transform(prune({ keepLeaves: true }), resample());
  // which bones does the clip drive, and do they exist on the rig?
  const targets = new Set();
  let hipsFirst = null;
  for (const ch of keep.listChannels()) {
    const n = ch.getTargetNode();
    if (!n) continue;
    targets.add(n.getName());
    if (ch.getTargetPath() === 'translation' && /hips|pelvis/i.test(n.getName()) && !hipsFirst) {
      const out = ch.getSampler()?.getOutput();
      if (out) hipsFirst = out.getElement(0, []);
    }
  }
  const missing = rigNames ? [...targets].filter((t) => !rigNames.has(t)) : [];
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await mkdir(path.dirname(dest), { recursive: true });
  await io.write(dest, doc);
  const after = (await stat(dest)).size;
  return { before, after, duration: +dur(keep).toFixed(3), channels: keep.listChannels().length, targets: targets.size, missing, hipsFirst };
}

// ---- URDF (Lux3D articulation output) ------------------------------------------------------------
function parseUrdf(xml) {
  const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
  const nums = (v, d) => (v ? v.trim().split(/\s+/).map(Number) : d);
  const links = {};
  for (const m of xml.matchAll(/<link\s+name="([^"]+)"[\s\S]*?<\/link>/g)) {
    const mesh = m[0].match(/<mesh\s+filename="([^"]+)"/);
    if (mesh) links[m[1]] = mesh[1];
  }
  const joints = [];
  for (const m of xml.matchAll(/<joint\s+name="([^"]+)"\s+type="([^"]+)"[\s\S]*?<\/joint>/g)) {
    const body = m[0];
    const origin = body.match(/<origin[^>]*>/)?.[0] ?? '';
    const limit = body.match(/<limit[^>]*>/)?.[0] ?? '';
    joints.push({
      name: m[1],
      type: m[2],
      parent: attr(body.match(/<parent[^>]*>/)?.[0] ?? '', 'link'),
      child: attr(body.match(/<child[^>]*>/)?.[0] ?? '', 'link'),
      xyz: nums(attr(origin, 'xyz'), [0, 0, 0]),
      rpy: nums(attr(origin, 'rpy'), [0, 0, 0]),
      axis: nums(attr(body.match(/<axis[^>]*>/)?.[0] ?? '', 'xyz'), [1, 0, 0]),
      lower: Number(attr(limit, 'lower') ?? -0.5),
      upper: Number(attr(limit, 'upper') ?? 0.5),
    });
  }
  const children = new Set(joints.map((j) => j.child));
  const root = Object.keys(links).find((l) => !children.has(l)) ?? Object.keys(links)[0];
  return { links, joints, root };
}

// ---- image helpers ----------------------------------------------------------------------------
// Make a square texture tile without visible seams: blend each axis with a half-period shifted
// copy near the borders (two passes keep the shifted copy's own seam inside the untouched middle).
async function seamlessTexture(file, dest, size = 1024) {
  const { data, info } = await sharp(src(file)).resize(size, size, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels;
  const band = 0.3;
  const smooth = (t) => t * t * (3 - 2 * t);
  const weight = (i, n) => {
    const d = Math.min(i, n - 1 - i) / (n / 2); // 0 at the border, 1 in the middle
    return d >= band ? 0 : 1 - smooth(d / band);
  };
  const pass = (img, horizontal) => {
    const out = Buffer.alloc(img.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const w = horizontal ? weight(x, W) : weight(y, H);
        const sx = horizontal ? (x + W / 2) % W : x;
        const sy = horizontal ? y : (y + H / 2) % H;
        const a = (y * W + x) * C;
        const b = (sy * W + sx) * C;
        for (let c = 0; c < C; c++) out[a + c] = Math.round(img[a + c] * (1 - w) + img[b + c] * w);
      }
    return out;
  };
  const tiled = pass(pass(data, true), false);
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(tiled, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 86, mozjpeg: true }).toFile(dest);
  return { after: (await stat(dest)).size, size: `${W}x${H}` };
}

async function resizeImage(file, dest, width, height, quality = 84) {
  await mkdir(path.dirname(dest), { recursive: true });
  const resize = height ? { width, height, fit: 'fill' } : { width, fit: 'inside', withoutEnlargement: true };
  await sharp(src(file)).resize(resize).jpeg({ quality, mozjpeg: true }).toFile(dest);
  return { after: (await stat(dest)).size };
}

// ---- run --------------------------------------------------------------------------------------
const jobs = JOBS.filter((j) => j.post && (!ONLY.size || ONLY.has(j.id)));
// the rig first, so clips can be checked against its bone names
jobs.sort((a, b) => (a.post.rigged ? -1 : 0) - (b.post.rigged ? -1 : 0));
let rig = null; // { names, hips } of the processed rig
async function readRig(file) {
  const doc = await io.read(file);
  const nodes = doc.getRoot().listNodes();
  const hipsNode = nodes.find((n) => /hips|pelvis/i.test(n.getName()));
  const b = bounds(doc);
  return { names: new Set(nodes.map((n) => n.getName())), hips: hipsNode ? hipsNode.getTranslation() : null, height: b ? b.size[1] : null };
}
// What the in-game Maker's Archive shows for a model: which Aholo operation made it, from what
// prompt and in how long (no URLs or credentials, only the request's descriptive fields).
function provenance(job, rec) {
  const out = { kind: job.kind };
  const prm = rec.params ?? job.params ?? {};
  let prompt = prm.prompt;
  if (!prompt && typeof prm.img === 'string' && prm.img.startsWith('@')) prompt = pipe[prm.img.slice(1).split('.')[0]]?.params?.prompt;
  if (prompt) out.prompt = String(prompt).slice(0, 400);
  if (prm.version) out.version = prm.version;
  if (prm.style) out.style = prm.style;
  if (typeof rec.seconds === 'number') out.seconds = rec.seconds;
  const src = [prm.meshUrl, prm.modelUrl, prm.glbUrl, prm.img].find((v) => typeof v === 'string' && v.startsWith('@'));
  if (src) out.from = src.slice(1).split('.')[0];
  return out;
}
const panos = {};
const splats = {};
let failures = 0;

for (const job of jobs) {
  const rec = pipe[job.id];
  if (!rec || rec.status !== 'done' || !rec.files) {
    if (ONLY.size) console.log(`- ${job.id}: not generated yet (${rec?.status ?? 'new'})`);
    continue;
  }
  const p = job.post;
  console.log(`> ${job.id}`);
  try {
    if (p.model) {
      const file = rec.files.glb;
      if (!file) throw new Error(`no GLB among outputs (${Object.keys(rec.files).join(', ')})`);
      const rel = `models/${p.model}.glb`;
      const r = await processModel(job, file, path.join(OUT, rel), { tex: p.tex ?? 1024, keepAnimations: false });
      manifest.models[p.model] = { file: rel, tris: r.statsOut.tris, bytes: r.after, task: String(rec.taskId), ...provenance(job, rec) };
      if (p.rigged) {
        if (!r.statsOut.skins) throw new Error('rigged model has no skin');
        rig = await readRig(path.join(OUT, rel));
        manifest.models[p.model].joints = r.statsOut.joints;
      }
      report.assets.push({ id: job.id, out: rel, ...r });
      console.log(`  ${kb(r.before)} -> ${kb(r.after)}, ${r.statsOut.tris} tris, textures ${r.statsIn.textures.join(' ')} -> ${r.statsOut.textures.join(' ')}${r.statsOut.skins ? `, ${r.statsOut.joints} joints` : ''}`);
    } else if (p.anims) {
      const clips = Object.entries(rec.files).filter(([k]) => k.startsWith('anim:'));
      if (!clips.length) throw new Error('no clip files');
      if (!rig && existsSync(path.join(OUT, 'models/hero_rig.glb'))) rig = await readRig(path.join(OUT, 'models/hero_rig.glb'));
      for (const [k, file] of clips) {
        const clipId = k.slice(5);
        const rel = `anims/${clipId}.glb`;
        try {
          const r = await processClip(job, clipId, file, path.join(OUT, rel), rig?.names ?? null);
          // how far the clip moves the hips from the rig's rest pose, relative to the character's height
          if (r.hipsFirst && rig?.hips && rig.height) r.hipsShift = +(Math.hypot(r.hipsFirst[0] - rig.hips[0], r.hipsFirst[1] - rig.hips[1], r.hipsFirst[2] - rig.hips[2]) / rig.height).toFixed(3);
          report.assets.push({ id: `${job.id}/${clipId}`, out: rel, ...r });
          if (!rig) problem(`${clipId}: rig not processed yet, bone names unchecked`);
          if (r.missing.length > r.targets * 0.1) {
            problem(`${clipId}: ${r.missing.length}/${r.targets} animated bones are not on the rig (${r.missing.slice(0, 6).join(', ')}), clip skipped`);
            continue;
          }
          if (r.missing.length) problem(`${clipId}: ${r.missing.length} bones not on the rig (${r.missing.join(', ')}); they are ignored`);
          if (r.hipsShift > 1.5) problem(`${clipId}: hips start ${r.hipsShift}x the character's height away from the rig (unit mismatch?)`);
          manifest.anims[clipId] = rel;
          console.log(`  ${clipId}: ${kb(r.before)} -> ${kb(r.after)}, ${r.duration}s, ${r.channels} channels on ${r.targets} bones`);
        } catch (err) {
          failures++;
          problem(`${job.id}/${clipId}: ${err.message}`);
        }
      }
    } else if (p.articulated) {
      // Lux3D articulation returns a URDF package: parts as GLB links plus revolute joints
      // (pivot, axis, limits). Optimise every link and describe the joints for the game.
      const urdfPath = rec.files.result ? path.join(path.dirname(src(rec.files.result)), 'unzipped', 'urdf', 'robot.urdf') : null;
      if (urdfPath && existsSync(urdfPath)) {
        const desc = parseUrdf(await readFile(urdfPath, 'utf8'));
        const links = {};
        let before = 0;
        let after = 0;
        for (const [name, mesh] of Object.entries(desc.links)) {
          const relLink = `models/${p.articulated}_${name}.glb`;
          const r = await processModel(job, path.relative(inputBase, path.join(path.dirname(urdfPath), mesh)), path.join(OUT, relLink), { tex: p.tex ?? 1024 });
          links[name] = relLink;
          before += r.before;
          after += r.after;
        }
        const rel = `models/${p.articulated}.json`;
        await mkdir(path.join(OUT, 'models'), { recursive: true });
        await writeFile(path.join(OUT, rel), JSON.stringify({ type: 'urdf', root: desc.root, links, joints: desc.joints }, null, 1));
        manifest.anims[p.articulated] = rel;
        report.assets.push({ id: job.id, out: rel, before, after, links: Object.keys(links), joints: desc.joints.map((j) => `${j.name}:${j.type}`) });
        console.log(`  URDF ${Object.keys(links).length} links (${desc.joints.map((j) => j.name).join(', ')}): ${kb(before)} -> ${kb(after)}`);
      } else {
        const file = rec.files.glb || rec.files.result;
        if (!file || !/\.glb$/i.test(file)) throw new Error(`articulation result is neither URDF nor GLB (${file})`);
        const rel = `models/${p.articulated}.glb`;
        const r = await processModel(job, file, path.join(OUT, rel), { tex: 1024, keepAnimations: true });
        if (!r.statsOut.animations.length) throw new Error('articulated model has no animation');
        manifest.anims[p.articulated] = rel;
        report.assets.push({ id: job.id, out: rel, ...r });
        console.log(`  ${kb(r.before)} -> ${kb(r.after)}, animations: ${r.statsOut.animations.join(', ')}`);
      }
    } else if (p.texture) {
      const file = rec.files.image;
      if (!file) throw new Error('no image output');
      const rel = `textures/${p.texture}.jpg`;
      const r = await seamlessTexture(file, path.join(OUT, rel));
      manifest.textures[p.texture] = rel;
      report.assets.push({ id: job.id, out: rel, ...r });
      console.log(`  seamless ${r.size} -> ${kb(r.after)}`);
    } else if (p.pano) {
      const file = rec.files.pano;
      if (!file) throw new Error('world has no panorama');
      const rel = `pano_${p.pano}.jpg`;
      const r = await resizeImage(file, path.join(OUT, rel), 4096, 2048, 82);
      panos[p.pano] = rel;
      report.assets.push({ id: job.id, out: rel, ...r });
      console.log(`  panorama -> ${kb(r.after)}`);
      // the world's Gaussian splats (.spz, already compressed) are shipped as-is for the 3D backdrop
      if (rec.files.spz && p.splat !== false) {
        const srel = `world_${p.pano}.spz`;
        await copyFile(rec.files.spz, path.join(OUT, srel));
        const st = await stat(path.join(OUT, srel));
        splats[p.pano] = srel;
        report.assets.push({ id: `${job.id}/splats`, out: srel, after: st.size });
        console.log(`  gaussian splats -> ${kb(st.size)}`);
      }
    } else if (p.image) {
      const file = rec.files.image;
      if (!file) throw new Error('no image output');
      const r = await resizeImage(file, path.join(MEDIA, `${p.image}.jpg`), 1600, 0, 88);
      report.assets.push({ id: job.id, out: path.relative(ROOT, path.join(MEDIA, `${p.image}.jpg`)), ...r });
      console.log(`  report image -> ${path.relative(ROOT, path.join(MEDIA, `${p.image}.jpg`))}`);
    }
  } catch (err) {
    failures++;
    problem(`${job.id}: ${err.message}`);
  }
}

// outdoor valley sky first; the interior hall panorama is the fallback
const pano = panos.valley || panos.hall;
if (pano) manifest.pano = pano;
if (Object.keys(splats).length) manifest.splats = splats;

if (previous) {
  // keep earlier entries this run did not rebuild (partial run, or a cleared pipeline cache)
  // as long as their files are still on disk
  const onDisk = (rel) => typeof rel === 'string' && existsSync(path.join(OUT, rel));
  for (const k of ['models', 'anims', 'textures'])
    for (const [id, v] of Object.entries(previous[k] || {}))
      if (!(id in manifest[k]) && onDisk(typeof v === 'string' ? v : v?.file)) manifest[k][id] = v;
  if (!manifest.pano && onDisk(previous.pano)) manifest.pano = previous.pano;
  if (!manifest.splats && previous.splats) {
    const kept = Object.fromEntries(Object.entries(previous.splats).filter(([, f]) => onDisk(f)));
    if (Object.keys(kept).length) manifest.splats = kept;
  }
}
await mkdir(OUT, { recursive: true });
await writeFile(gameManifestPath, JSON.stringify(manifest, null, 2));
await writeFile(path.join(path.dirname(PIPE_MANIFEST), 'process-report.json'), JSON.stringify(report, null, 2));
console.log(
  `\nmanifest: ${Object.keys(manifest.models).length} models, ${Object.keys(manifest.anims).length} anims, ${Object.keys(manifest.textures).length} textures${manifest.pano ? ', pano' : ''} -> ${path.relative(ROOT, gameManifestPath)}`,
);
if (report.problems.length) console.log(`${report.problems.length} problem(s); see ${path.relative(ROOT, path.join(path.dirname(PIPE_MANIFEST), 'process-report.json'))}`);
if (manifest.models.hero_rig && !Object.keys(manifest.anims).some((k) => k === 'Idle_Loop')) console.log('note: hero_rig without an Idle_Loop clip; the game will hold the bind pose until clips arrive');
process.exitCode = failures ? 1 : 0;
