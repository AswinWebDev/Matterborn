// Screen-space atmosphere and colour grading for the postprocessing pipeline.
//   AirEffect    exposure + exponential height fog reconstructed from the depth buffer, with the
//                fog colour shifting from near to far and glowing toward the sun.
//   GradeEffect  saturation, split toning (cool shadows / warm highlights) and contrast, after
//                tone mapping, so every area can carry its own painterly palette.

import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const AIR = /* glsl */ `
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uFogNear;
  uniform vec3 uFogFar;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDir;
  uniform vec4 uFog; // density, height falloff, base height, max opacity
  uniform float uExposure;
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec3 col = inputColor.rgb * uExposure;
    // a stray NaN/Inf pixel would be smeared over the whole frame by bloom: drop it here
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    if (depth < 0.999999) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 vp = uInvProj * ndc;
      vp /= vp.w;
      vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
      vec3 rd = wp - uCamPos;
      float dist = length(rd);
      rd /= max(dist, 1e-4);
      float k = uFog.y;
      float h0 = clamp(uCamPos.y - uFog.z, -8.0, 60.0);
      float ry = rd.y * k;
      float integ = abs(ry) > 1e-4 ? (1.0 - exp(-ry * dist)) / ry : dist;
      float od = uFog.x * exp(-k * h0) * integ;
      float f = (1.0 - exp(-max(od, 0.0))) * uFog.w;
      float sun = pow(max(dot(rd, uSunDir), 0.0), 6.0);
      vec3 fogCol = (mix(uFogNear, uFogFar, smoothstep(6.0, 70.0, dist)) + uSunGlow * sun) * uExposure;
      col = mix(col, fogCol, f);
    }
    outputColor = vec4(col, inputColor.a);
  }`;

export class AirEffect extends Effect {
  readonly fogNear = new THREE.Color(0x1a2033);
  readonly fogFar = new THREE.Color(0x3a4560);
  readonly sunGlow = new THREE.Color(0x000000);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  density = 0.02;
  heightFalloff = 0.08;
  baseHeight = 0;
  maxFog = 0.92;
  exposure = 1;

  constructor(private cam: THREE.PerspectiveCamera) {
    super('AirEffect', AIR, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uFogNear', new THREE.Uniform(new THREE.Color())],
        ['uFogFar', new THREE.Uniform(new THREE.Color())],
        ['uSunGlow', new THREE.Uniform(new THREE.Color())],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uFog', new THREE.Uniform(new THREE.Vector4())],
        ['uExposure', new THREE.Uniform(1)],
      ]),
    });
  }

  override update() {
    const u = this.uniforms;
    (u.get('uInvProj')!.value as THREE.Matrix4).copy(this.cam.projectionMatrixInverse);
    (u.get('uCamWorld')!.value as THREE.Matrix4).copy(this.cam.matrixWorld);
    (u.get('uCamPos')!.value as THREE.Vector3).setFromMatrixPosition(this.cam.matrixWorld);
    (u.get('uFogNear')!.value as THREE.Color).copy(this.fogNear);
    (u.get('uFogFar')!.value as THREE.Color).copy(this.fogFar);
    (u.get('uSunGlow')!.value as THREE.Color).copy(this.sunGlow);
    (u.get('uSunDir')!.value as THREE.Vector3).copy(this.sunDir);
    (u.get('uFog')!.value as THREE.Vector4).set(this.density, this.heightFalloff, this.baseHeight, this.maxFog);
    u.get('uExposure')!.value = this.exposure;
  }
}

const GRADE = /* glsl */ `
  uniform float uSat;
  uniform float uContrast;
  uniform vec3 uShadowTint;
  uniform vec3 uHighTint;
  uniform float uSplit;
  uniform float uLift;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = max(inputColor.rgb, 0.0);
    // grade in a roughly perceptual space
    vec3 p = sqrt(c);
    float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
    p = mix(vec3(l), p, uSat);
    float sh = 1.0 - smoothstep(0.05, 0.55, l);
    float hi = smoothstep(0.45, 0.95, l);
    p *= mix(vec3(1.0), uShadowTint * 2.0, sh * uSplit);
    p *= mix(vec3(1.0), uHighTint * 2.0, hi * uSplit);
    p = (p - 0.5) * uContrast + 0.5;
    p = p * (1.0 - uLift) + uLift * uShadowTint;
    c = max(p, 0.0);
    outputColor = vec4(c * c, inputColor.a);
  }`;

export class GradeEffect extends Effect {
  saturation = 1.1;
  contrast = 1.08;
  readonly shadowTint = new THREE.Color(0.42, 0.48, 0.62);
  readonly highTint = new THREE.Color(0.56, 0.5, 0.42);
  split = 0.35;
  lift = 0.02;

  constructor() {
    super('GradeEffect', GRADE, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uSat', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1)],
        ['uShadowTint', new THREE.Uniform(new THREE.Color())],
        ['uHighTint', new THREE.Uniform(new THREE.Color())],
        ['uSplit', new THREE.Uniform(0)],
        ['uLift', new THREE.Uniform(0)],
      ]),
    });
  }

  override update() {
    const u = this.uniforms;
    u.get('uSat')!.value = this.saturation;
    u.get('uContrast')!.value = this.contrast;
    (u.get('uShadowTint')!.value as THREE.Color).copy(this.shadowTint);
    (u.get('uHighTint')!.value as THREE.Color).copy(this.highTint);
    u.get('uSplit')!.value = this.split;
    u.get('uLift')!.value = this.lift;
  }
}
