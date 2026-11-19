// Image-based lighting for the PBR materials (Lux3D props, the hero, glass). A tiny painted
// "room" — dusk gradient, warm window glows, a cool skylight — is rendered once into a PMREM
// cube, so metal, glass and wet stone pick up soft reflections instead of looking flat.

import * as THREE from 'three';

export function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 top = vec3(0.10, 0.14, 0.26);
          vec3 hor = vec3(0.55, 0.40, 0.30);
          vec3 gnd = vec3(0.06, 0.05, 0.045);
          vec3 c = mix(hor, top, smoothstep(0.0, 0.7, h));
          c = mix(c, gnd, smoothstep(0.0, -0.35, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);
  // warm high windows on one side and a cool skylight opposite: gives speculars a direction
  const glow = (color: number, intensity: number, w: number, h: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  glow(0xffc890, 6, 8, 14, [-14, 12, -30]);
  glow(0xffc890, 5, 6, 12, [6, 12, -32]);
  glow(0x9fc8ff, 2.5, 30, 8, [10, 35, 20]);
  glow(0xffa860, 1.2, 40, 4, [0, 2, 40]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
