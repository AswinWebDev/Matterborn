#!/usr/bin/env node
// Do two GLBs share mesh topology and UVs? (Can a material-transfer texture made for one be put on
// the other?) Usage: node pipeline/uvcheck.mjs a.glb b.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': await draco3d.createDecoderModule() });

function summary(doc) {
  const prims = [];
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      const uv = p.getAttribute('TEXCOORD_0');
      const uvs = uv ? Array.from({ length: Math.min(uv.getCount(), 2000) }, (_, i) => uv.getElement(i, [])) : [];
      prims.push({ verts: pos?.getCount() ?? 0, tris: (p.getIndices()?.getCount() ?? 0) / 3, uv: !!uv, uvs, mat: p.getMaterial()?.getName() });
    }
  return prims;
}

const [a, b] = process.argv.slice(2);
const A = summary(await io.read(a));
const B = summary(await io.read(b));
console.log('A', A.map((p) => `${p.verts}v/${p.tris}t uv=${p.uv}`).join(' | '));
console.log('B', B.map((p) => `${p.verts}v/${p.tris}t uv=${p.uv}`).join(' | '));
if (A.length !== B.length) console.log('different primitive counts -> textures are NOT interchangeable');
else {
  A.forEach((pa, i) => {
    const pb = B[i];
    if (pa.verts !== pb.verts) return console.log(`prim ${i}: vertex count differs (${pa.verts} vs ${pb.verts}) -> NOT interchangeable`);
    let maxd = 0;
    for (let k = 0; k < Math.min(pa.uvs.length, pb.uvs.length); k++) maxd = Math.max(maxd, Math.abs(pa.uvs[k][0] - pb.uvs[k][0]), Math.abs(pa.uvs[k][1] - pb.uvs[k][1]));
    console.log(`prim ${i}: same vertex count; max UV difference over first ${Math.min(pa.uvs.length, 2000)} = ${maxd.toFixed(5)} -> ${maxd < 1e-3 ? 'interchangeable' : 'NOT interchangeable'}`);
  });
}
