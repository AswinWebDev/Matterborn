// Offline tests for the Lux3D helpers: node --test pipeline/
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutputs, validateJob, deps } from './lux.mjs';
import { JOBS, GROUPS } from './assets.mjs';

const U = (p) => `https://cdn.example.com/${p}?sig=abc`;

test('every declared job passes the contract checks', () => {
  for (const job of JOBS) assert.deepEqual(validateJob(job), [], job.id);
});

test('every group and dependency names a real job', () => {
  const ids = new Set(JOBS.map((j) => j.id));
  for (const [g, list] of Object.entries(GROUPS)) for (const id of list) assert.ok(ids.has(id), `${g}: ${id}`);
  for (const j of JOBS) for (const d of deps(j)) assert.ok(ids.has(d), `${j.id} -> ${d}`);
});

test('retarget results follow the contract fields (animation_id, animationGlbUrl, error)', () => {
  const job = { kind: 'retarget', params: { rigModelUrl: '@hero_rig.glb', animationIds: ['Idle_Loop', 'Roll', 'Jump_Loop'] } };
  const content = JSON.stringify({
    actions: [
      { animation_id: 'Idle_Loop', status: 'SUCCESS', animationGlbUrl: U('a/idle.glb') },
      { animation_id: 'Roll', status: 'SUCCESS', animationGlbUrl: U('a/roll') },
      { animation_id: 'Jump_Loop', status: 'FAILED', error: { code: 'E1', message: 'bad pose' } },
    ],
  });
  const urls = classifyOutputs(job, [content]);
  assert.equal(urls['anim:Idle_Loop'], U('a/idle.glb'));
  assert.equal(urls['anim:Roll'], U('a/roll'));
  assert.match(urls['animError:Jump_Loop'], /bad pose/);
  assert.equal(Object.keys(urls).length, 3);
});

test('retarget fbx results use fbxUrl', () => {
  const job = { kind: 'retarget', params: {} };
  const urls = classifyOutputs(job, [JSON.stringify({ actions: [{ animation_id: 'Yes', fbxUrl: U('y.fbx') }] })]);
  assert.equal(urls['anim:Yes'], U('y.fbx'));
});

test('material transfer reads the fixed slots and skips NOT_REQUESTED', () => {
  const job = { kind: 'material', params: { version: 'v3.0-standard', outputFormat: ['glb'] } };
  const urls = classifyOutputs(job, ['NOT_REQUESTED', U('out/model'), 'NOT_REQUESTED', 'NOT_REQUESTED', 'NOT_REQUESTED']);
  assert.deepEqual(urls, { glb: U('out/model') });
});

test('G1 image-to-3D returns ZIP then GLB, even without extensions', () => {
  const job = { kind: 'img3d', params: { version: 'G1', img: 'x' } };
  const urls = classifyOutputs(job, [U('r/1'), U('r/2')]);
  assert.equal(urls.glb, U('r/2'));
  const named = classifyOutputs(job, [U('r/model.zip'), U('r/model.glb')]);
  assert.equal(named.glb, U('r/model.glb'));
  assert.equal(named.zip, U('r/model.zip'));
});

test('G1-Turbo text-to-3D with glb only', () => {
  const job = { kind: 'text3d', params: { version: 'G1-Turbo', outputFormat: ['glb'] } };
  assert.deepEqual(classifyOutputs(job, [U('t/x')]), { glb: U('t/x') });
});

test('auto-rig success and failure payloads', () => {
  const job = { kind: 'rig', params: {} };
  assert.deepEqual(classifyOutputs(job, [U('rig/out')]), { glb: U('rig/out') });
  const bad = classifyOutputs(job, [JSON.stringify({ error: { code: 'RIG_FAILED', message: 'not humanoid' } })]);
  assert.match(bad.error, /not humanoid/);
  assert.equal(bad.glb, undefined);
});

test('four-view arrays are named by view', () => {
  const urls = classifyOutputs({ kind: 'four-view', params: {} }, [JSON.stringify([U('f.png'), U('o.png'), U('s.png'), U('b.png')])]);
  assert.deepEqual(Object.keys(urls), ['front', 'opposite', 'side', 'back']);
});

test('images and articulation results', () => {
  assert.equal(classifyOutputs({ kind: 'image', params: {} }, [U('img/1.webp')]).image, U('img/1.webp'));
  assert.equal(classifyOutputs({ kind: 'image', params: {} }, [U('img/noext')]).image, U('img/noext'));
  assert.equal(classifyOutputs({ kind: 'articulate', params: {} }, [U('art/out.glb')]).glb, U('art/out.glb'));
  assert.equal(classifyOutputs({ kind: 'articulate', params: {} }, [U('art/out.zip')]).result, U('art/out.zip'));
});

test('contract violations are caught before spending', () => {
  const v = (kind, params) => validateJob({ kind, params });
  assert.ok(v('img3d', { version: 'G1', img: 'x', enablePbr: true }).some((e) => /enablePbr/.test(e)));
  assert.ok(v('text3d', { version: 'G1-Turbo', prompt: 'a', customSize: 10 }).some((e) => /customSize/.test(e)));
  assert.ok(v('text3d', { version: 'G2', prompt: 'a' }).length);
  assert.ok(v('text3d', { version: 'G1', prompt: 'a', faceCount: 5000 }).length);
  assert.ok(v('retarget', { rigModelUrl: 'x', animationIds: ['Idle_Loop', 'Idle_Loop'] }).some((e) => /duplicates/.test(e)));
  assert.ok(v('retarget', { rigModelUrl: 'x', animationIds: ['Moonwalk'] }).some((e) => /unknown animation/.test(e)));
  assert.ok(v('retarget', { rigModelUrl: 'x', animationIds: Array.from({ length: 11 }, (_, i) => `x${i}`) }).length);
  assert.ok(v('retarget', { rigModelUrl: 'x', animationIds: ['Idle_Loop'], animateInPlace: 'false' }).some((e) => /boolean/.test(e)));
  assert.ok(v('articulate', { glbUrl: 'x', prompt: 'p', version: 'G1' }).some((e) => /unexpected/.test(e)));
  assert.deepEqual(v('rig', { modelUrl: '@hero_model.glb' }), []);
});
