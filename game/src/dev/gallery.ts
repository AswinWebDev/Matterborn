// Dev only: render every Lux3D model in the manifest alone on a soft studio backdrop (for the
// report's asset gallery). Each image goes to capture/gallery_<id>.png.
//   await (await import('/src/dev/gallery.ts')).gallery(game)

import * as THREE from 'three';
import { getManifest, loadModel, instantiate } from '../core/Assets';
import type { Game } from '../Game';
import { makeEnvironment } from '../render/Environment';

async function upload(name: string, blob: Blob) {
  await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
}

export async function gallery(game: Game, size = 640, ids?: string[]) {
  const gl = game.renderer.gl;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d26);
  scene.environment = makeEnvironment(gl);
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight(0xfff0dc, 3.2);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0x9fc8ff, 2.2);
  rim.position.set(-4, 3, -4);
  scene.add(key, rim, new THREE.HemisphereLight(0x8090b0, 0x302820, 0.6));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pixels = new Uint8Array(size * size * 4);
  const img = ctx.createImageData(size, size);
  const prevTone = gl.toneMapping;
  const prevExp = gl.toneMappingExposure;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.0;
  const list = ids ?? Object.keys(getManifest().models);
  const done: string[] = [];
  for (const id of list) {
    const g = await loadModel(id);
    if (!g) continue;
    const m = instantiate(g, 2);
    const sz = m.userData.size as THREE.Vector3;
    const r = Math.max(sz.x, sz.y, sz.z);
    m.rotation.y = 0.6;
    scene.add(m);
    cam.position.set(r * 1.25, sz.y * 0.75 + r * 0.35, r * 2.1);
    cam.lookAt(0, sz.y * 0.45, 0);
    gl.setRenderTarget(target);
    gl.render(scene, cam);
    gl.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    gl.setRenderTarget(null);
    // flip vertically into the 2D canvas
    for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    await upload(`gallery_${id}.png`, blob);
    scene.remove(m);
    done.push(id);
  }
  gl.toneMapping = prevTone;
  gl.toneMappingExposure = prevExp;
  target.dispose();
  return done;
}
