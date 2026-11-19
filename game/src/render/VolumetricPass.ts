// Volumetric sunlight. For every pixel (at reduced resolution) the view ray is marched through
// the air and each sample is tested against the sun's shadow map, so light pouring through
// windows, between pillars and past the colossus forms real shafts that match the geometry.
// The result is blurred and added on top of the scene, before bloom and tone mapping.

import * as THREE from 'three';
import { Pass } from 'postprocessing';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MARCH = /* glsl */ `
  uniform sampler2D tDepth;
  uniform highp sampler2DShadow tShadow;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform mat4 uShadowMatrix;
  uniform vec3 uCamPos;
  uniform vec3 uSunDir;
  uniform float uMaxDist;
  uniform float uFrame;
  uniform float uHeightFalloff;
  uniform float uBaseHeight;
  uniform float uG;
  uniform float uOutside;
  uniform float uExtinction;
  uniform float uTime;
  varying vec2 vUv;

  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }

  void main() {
    float depth = texture2D(tDepth, vUv).r;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc;
    vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - uCamPos;
    float dist = length(rd);
    rd /= max(dist, 1e-4);
    if (depth >= 0.999999) dist = uMaxDist;
    float len = min(dist, uMaxDist);
    const int STEPS = 28;
    float stepLen = len / float(STEPS);
    float jitter = ign(gl_FragCoord.xy + mod(uFrame, 64.0) * 5.588238);
    float cosT = dot(rd, uSunDir);
    float g = uG;
    float phase = (1.0 - g * g) / (12.566 * pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-3), 1.5));
    phase += 0.03; // a little isotropic scatter so shafts read from any angle
    float acc = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float t = (float(i) + jitter) * stepLen;
      vec3 p = uCamPos + rd * t;
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      sc.xyz /= sc.w;
      float lit = uOutside;
      if (sc.x > 0.002 && sc.x < 0.998 && sc.y > 0.002 && sc.y < 0.998 && sc.z < 1.0) lit = texture(tShadow, vec3(sc.xy, sc.z));
      float dens = exp(-uHeightFalloff * max(p.y - uBaseHeight, 0.0));
      // slow drifting dust density gives the shafts some body
      dens *= 0.55 + 0.9 * vnoise(p * 0.35 + vec3(uTime * 0.07, -uTime * 0.03, uTime * 0.05));
      acc += lit * dens * exp(-t * uExtinction);
    }
    acc *= stepLen * phase;
    gl_FragColor = vec4(vec3(acc), 1.0);
  }`;

const BLUR = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv).rgb * 0.2270270;
    c += texture2D(tInput, vUv + uDir * 1.3846154).rgb * 0.3162162;
    c += texture2D(tInput, vUv - uDir * 1.3846154).rgb * 0.3162162;
    c += texture2D(tInput, vUv + uDir * 3.2307692).rgb * 0.0702703;
    c += texture2D(tInput, vUv - uDir * 3.2307692).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tVol;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(tScene, vUv);
    vec3 v = texture2D(tVol, vUv).rgb;
    gl_FragColor = vec4(s.rgb + v * uColor, s.a);
  }`;

export class VolumetricPass extends Pass {
  /** Strength and colour of the scattered sunlight (linear, multiplied by sun colour). */
  readonly color = new THREE.Color(1, 0.85, 0.6);
  strength = 1;
  /** Fraction of drawing-buffer resolution the march runs at. */
  scale = 0.5;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private march: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  private frameNo = 0;
  private w = 1;
  private h = 1;
  private time = 0;

  constructor(
    private cam: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
  ) {
    super('VolumetricPass');
    this.needsDepthTexture = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.march = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: MARCH,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: null },
        tShadow: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMaxDist: { value: 48 },
        uFrame: { value: 0 },
        uHeightFalloff: { value: 0.06 },
        uBaseHeight: { value: 0 },
        uG: { value: 0.55 },
        uOutside: { value: 0.25 },
        uExtinction: { value: 0.02 },
        uTime: { value: 0 },
      },
    });
    this.blur = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR,
      depthTest: false,
      depthWrite: false,
      uniforms: { tInput: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.composite = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      depthTest: false,
      depthWrite: false,
      uniforms: { tScene: { value: null }, tVol: { value: this.rtA.texture }, uColor: { value: new THREE.Color() } },
    });
    this.fullscreenMaterial = this.composite;
  }

  /** Air settings from the current mood. */
  setAir(o: { heightFalloff?: number; baseHeight?: number; g?: number; outside?: number; extinction?: number; maxDist?: number }) {
    const u = this.march.uniforms;
    if (o.heightFalloff !== undefined) u.uHeightFalloff.value = o.heightFalloff;
    if (o.baseHeight !== undefined) u.uBaseHeight.value = o.baseHeight;
    if (o.g !== undefined) u.uG.value = o.g;
    if (o.outside !== undefined) u.uOutside.value = o.outside;
    if (o.extinction !== undefined) u.uExtinction.value = o.extinction;
    if (o.maxDist !== undefined) u.uMaxDist.value = o.maxDist;
  }

  override setDepthTexture(depthTexture: THREE.Texture | null) {
    this.march.uniforms.tDepth.value = depthTexture;
  }

  override setSize(width: number, height: number) {
    this.w = width;
    this.h = height;
    const sw = Math.max(1, Math.round(width * this.scale));
    const sh = Math.max(1, Math.round(height * this.scale));
    this.rtA.setSize(sw, sh);
    this.rtB.setSize(sw, sh);
  }

  setScale(s: number) {
    this.scale = s;
    this.setSize(this.w, this.h);
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget, deltaTime = 0) {
    const shadowTex = this.sun.shadow.map?.depthTexture ?? null;
    const active = this.strength > 0.001 && shadowTex !== null && this.sun.intensity > 0 && this.march.uniforms.tDepth.value;
    this.time += deltaTime;
    if (active) {
      const u = this.march.uniforms;
      u.tShadow.value = shadowTex;
      u.uInvProj.value.copy(this.cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(this.cam.matrixWorld);
      u.uShadowMatrix.value.copy(this.sun.shadow.matrix);
      u.uCamPos.value.setFromMatrixPosition(this.cam.matrixWorld);
      u.uSunDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
      u.uFrame.value = this.frameNo++;
      u.uTime.value = this.time;
      this.fullscreenMaterial = this.march;
      renderer.setRenderTarget(this.rtA);
      renderer.render(this.scene, this.camera);
      const texel = new THREE.Vector2(1 / this.rtA.width, 1 / this.rtA.height);
      this.fullscreenMaterial = this.blur;
      this.blur.uniforms.tInput.value = this.rtA.texture;
      this.blur.uniforms.uDir.value.set(texel.x, 0);
      renderer.setRenderTarget(this.rtB);
      renderer.render(this.scene, this.camera);
      this.blur.uniforms.tInput.value = this.rtB.texture;
      this.blur.uniforms.uDir.value.set(0, texel.y);
      renderer.setRenderTarget(this.rtA);
      renderer.render(this.scene, this.camera);
    }
    const c = this.composite.uniforms;
    c.tScene.value = inputBuffer.texture;
    c.tVol.value = this.rtA.texture;
    c.uColor.value.copy(this.color).multiplyScalar(active ? this.strength * this.sun.intensity : 0);
    this.fullscreenMaterial = this.composite;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.march.dispose();
    this.blur.dispose();
    this.composite.dispose();
    super.dispose();
  }
}
