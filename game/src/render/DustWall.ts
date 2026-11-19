// The collapse chasing Loam during the escape: a churning wall of dust and rubble. Several soft
// curtains (seen from the side, like the camera sees the causeway) with scrolling billows that
// are dense behind the front and torn into turbulent wisps at its leading edge, lit orange from
// within by the collapse light.

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vW;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FRAG = /* glsl */ `
  uniform float uTime; uniform float uSeed; uniform vec3 uDark; uniform vec3 uGlow; uniform float uOpacity;
  varying vec2 vUv; varying vec3 vW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 3.7; a *= 0.5; } return v; }
  void main() {
    vec2 q = vec2(vUv.x * 3.0, vUv.y * 5.0);
    float t = uTime * 0.35 + uSeed;
    vec2 warp = vec2(fbm(q + vec2(t * 0.6, -t)), fbm(q * 1.3 - vec2(t, t * 0.4)));
    float billow = fbm(q * 1.4 + warp * 1.8 + vec2(t * 0.8, -t * 1.6));
    // dense behind (left, low x), shredded at the leading edge (right, high x)
    float front = smoothstep(1.0, 0.55 + billow * 0.25, vUv.x);
    float body = front * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.7 + billow * 0.2, vUv.y);
    float a = clamp(body * (0.55 + billow * 0.9), 0.0, 1.0) * uOpacity;
    vec3 col = mix(uDark, uDark * 1.8, billow);
    // fire glowing through the dust near the ground and the front
    col += uGlow * pow(billow, 3.0) * smoothstep(0.5, 0.0, vUv.y) * 1.6;
    gl_FragColor = vec4(col, a);
  }`;

export class DustWall {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];

  constructor() {
    const layers = [-6, -2.5, 1, 4.5];
    layers.forEach((z, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: i * 13.7 },
          uDark: { value: new THREE.Color(0x2a1c16) },
          uGlow: { value: new THREE.Color(0xff6a24) },
          uOpacity: { value: 0.95 },
        },
      });
      this.mats.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 34), mat);
      // the plane's right edge is the leading front: centre it 9 m behind the front
      m.position.set(-9 + i * 0.6, 12, z);
      m.renderOrder = 18;
      this.group.add(m);
    });
    this.group.visible = false;
  }

  /** Place the leading edge of the wall at x = front (world), floor at y. */
  update(time: number, front: number, y: number) {
    this.group.position.set(front, y - 4, 0);
    for (const m of this.mats) m.uniforms.uTime.value = time;
  }
}
