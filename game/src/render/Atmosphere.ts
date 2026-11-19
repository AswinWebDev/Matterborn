// Sky, layered fog, drifting dust and light shafts. Everything here is cheap but stacks up
// into a deep, painterly sense of space behind the play space.

import * as THREE from 'three';
import { makeFogTexture, makeSoftDot, makeShaftTexture, mulberry32 } from './noise';

export interface SkyColors {
  top: THREE.ColorRepresentation;
  mid: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  sun: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
}

export class Atmosphere {
  readonly group = new THREE.Group();
  readonly sky: THREE.Mesh;
  readonly skyMat: THREE.ShaderMaterial;
  readonly fog: THREE.FogExp2;
  private cards: { mesh: THREE.Mesh; speed: number; baseOpacity: number }[] = [];
  private dust: THREE.Points;
  /** Drawing-buffer height in pixels; keeps dust motes the same size on screen at any resolution. */
  viewHeight = 1080;
  private dustMat: THREE.ShaderMaterial;
  private shafts: THREE.Mesh[] = [];
  private time = 0;
  private panoTex: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    // --- sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x0d1630) },
        uMid: { value: new THREE.Color(0x2b3a5c) },
        uHorizon: { value: new THREE.Color(0xd99566) },
        uSun: { value: new THREE.Color(0xffc68a) },
        uSunDir: { value: new THREE.Vector3(-0.45, 0.25, -1).normalize() },
        uFogCol: { value: new THREE.Color(0x3a4560) },
        uPano: { value: null as THREE.Texture | null },
        uPanoMix: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uTop, uMid, uHorizon, uSun, uSunDir, uFogCol;
        uniform sampler2D uPano; uniform float uPanoMix; uniform float uTime;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(-0.05, 0.28, h));
          col = mix(col, uTop, smoothstep(0.25, 0.85, h));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          if (uPanoMix > 0.001) {
            vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
            vec3 pano = texture2D(uPano, uv).rgb;
            // tint the Aholo World panorama toward the area's palette so it sits in the mood
            float pl = dot(pano, vec3(0.299, 0.587, 0.114));
            vec3 tinted = mix(pano, pl * mix(uHorizon, uMid, smoothstep(0.0, 0.5, h)) * 1.8, 0.35);
            col = mix(col, tinted * 1.05, uPanoMix * smoothstep(-0.2, 0.1, h + 0.15));
          }
          col += uSun * (pow(s, 5.0) * 0.45 + pow(s, 48.0) * 1.4 + pow(s, 900.0) * 6.0);
          // below and around the horizon the sky melts into the area's fog colour
          col = mix(col, uFogCol, smoothstep(0.12, -0.08, h) * 0.85);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.fog = new THREE.FogExp2(0x3a3f52, 0.018);
    scene.fog = this.fog;

    // --- fog cards: big soft planes at several depths, slowly drifting
    const tex = makeFogTexture(256, 3);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const rnd = mulberry32(7);
    // haze layers that live at fixed distances in front of the camera (works for any view angle)
    const depths = [9, 15, 23, 34, 50];
    for (const z of depths) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        color: 0xc9b9a8,
        transparent: true,
        depthWrite: false,
        opacity: 0.05 + rnd() * 0.06,
        fog: false,
      });
      mat.map!.wrapS = mat.map!.wrapT = THREE.RepeatWrapping;
      mat.map!.repeat.set(3, 1);
      mat.map!.offset.set(rnd(), rnd());
      mat.map!.needsUpdate = true;
      const w = 30 + z * 2.2;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.45), mat);
      mesh.userData.depth = z;
      mesh.userData.lift = -1 + rnd() * 2;
      mesh.renderOrder = -5;
      this.cards.push({ mesh, speed: (0.004 + rnd() * 0.006) * (rnd() < 0.5 ? 1 : -1), baseOpacity: mat.opacity });
      this.group.add(mesh);
    }

    // --- dust motes / embers around the camera
    const N = 1600;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 50;
      pos[i * 3 + 1] = (rnd() - 0.5) * 30;
      pos[i * 3 + 2] = (rnd() - 0.5) * 50;
      seed[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uTex: { value: makeSoftDot(64) },
        uColor: { value: new THREE.Color(0xffd6a0) },
        uViewH: { value: 1080 },
        tShadow: { value: null as THREE.Texture | null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uHasShadow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCam; uniform float uViewH;
        uniform highp sampler2DShadow tShadow; uniform mat4 uShadowMatrix; uniform float uHasShadow;
        varying float vAlpha; varying float vLit;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * (0.2 + aSeed * 0.3) + aSeed * 40.0) * 1.5 + uTime * (0.15 + aSeed * 0.25);
          p.y += sin(uTime * (0.35 + aSeed * 0.2) + aSeed * 13.0) * 0.8 + uTime * 0.08;
          // wrap around the camera so dust is always present
          vec3 rel = p - uCam;
          rel.x = mod(rel.x + 25.0, 50.0) - 25.0;
          rel.y = mod(rel.y + 15.0, 30.0) - 15.0;
          rel.z = mod(rel.z + 25.0, 50.0) - 25.0;
          p = uCam + rel;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 90.0);
          // small motes that fade out before they reach the lens (big close sprites read as blotches)
          vAlpha = tw * smoothstep(40.0, 8.0, -mv.z) * smoothstep(1.5, 5.0, -mv.z) * (0.35 + aSeed * 0.65);
          // motes only sparkle where they drift through sunlight (sampled from the sun's shadow map)
          float lit = 0.35;
          if (uHasShadow > 0.5) {
            vec4 sc = uShadowMatrix * vec4(p, 1.0);
            sc.xyz /= sc.w;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) lit = texture(tShadow, vec3(sc.xy, sc.z));
          }
          vLit = lit;
          vAlpha *= 0.12 + 0.88 * lit;
          float k = uViewH / 1080.0;
          gl_PointSize = min((0.8 + aSeed * 2.2) * (0.8 + lit * 0.6) * k * (16.0 / -mv.z), 14.0 * k);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec3 uColor; varying float vAlpha; varying float vLit;
        void main() {
          float a = texture2D(uTex, gl_PointCoord).r * vAlpha;
          gl_FragColor = vec4(uColor * (1.0 + vLit * 1.6), a);
        }`,
    });
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  private sun: THREE.DirectionalLight | null = null;
  /** Let the dust sample the sun's shadow map so motes glitter inside the light shafts. */
  setSun(sun: THREE.DirectionalLight) {
    this.sun = sun;
    this.dustMat.uniforms.uShadowMatrix.value = sun.shadow.matrix; // live reference, current at draw time
  }
  private warm = new THREE.Color(0xffe2c4);
  /** Per-frame palette from the blended mood (no allocations). */
  applyMood(top: THREE.Color, mid: THREE.Color, horizon: THREE.Color, sun: THREE.Color, fog: THREE.Color, sunDir: THREE.Vector3) {
    const u = this.skyMat.uniforms;
    u.uTop.value.copy(top);
    u.uMid.value.copy(mid);
    u.uHorizon.value.copy(horizon);
    u.uSun.value.copy(sun);
    u.uFogCol.value.copy(fog);
    u.uSunDir.value.copy(sunDir);
    this.fog.color.copy(fog);
    for (const card of this.cards) (card.mesh.material as THREE.MeshBasicMaterial).color.copy(fog).lerp(this.warm, 0.3);
  }

  setColors(c: SkyColors) {
    this.skyMat.uniforms.uTop.value.set(c.top);
    this.skyMat.uniforms.uMid.value.set(c.mid);
    this.skyMat.uniforms.uHorizon.value.set(c.horizon);
    this.skyMat.uniforms.uSun.value.set(c.sun);
    this.fog.color.set(c.fog);
    for (const card of this.cards) (card.mesh.material as THREE.MeshBasicMaterial).color.set(c.fog).lerp(new THREE.Color(0xffe2c4), 0.25);
  }

  /** Blend an equirectangular panorama (e.g. from Aholo World) into the sky. */
  setPanorama(tex: THREE.Texture, mix = 0.85) {
    this.panoTex = tex;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat.uniforms.uPano.value = tex;
    this.skyMat.uniforms.uPanoMix.value = mix;
  }

  /** Add a slanted god-ray shaft at a world position. */
  addShaft(x: number, y: number, z: number, height = 26, width = 5, color = 0xffd9a0, opacity = 0.16, angle = -0.42) {
    const mat = new THREE.MeshBasicMaterial({
      map: makeShaftTexture(),
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    m.position.set(x, y - height / 2, z);
    m.rotation.z = angle;
    m.userData.base = opacity;
    m.userData.phase = Math.random() * 10;
    this.shafts.push(m);
    this.group.add(m);
    return m;
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uCam.value.copy(camera.position);
    this.dustMat.uniforms.uViewH.value = this.viewHeight;
    const sm = this.sun?.castShadow ? this.sun.shadow.map?.depthTexture ?? null : null;
    this.dustMat.uniforms.tShadow.value = sm;
    this.dustMat.uniforms.uHasShadow.value = sm ? 1 : 0;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    for (const c of this.cards) {
      const m = c.mesh.material as THREE.MeshBasicMaterial;
      m.map!.offset.x += c.speed * dt;
      c.mesh.position.copy(camera.position).addScaledVector(fwd, c.mesh.userData.depth);
      c.mesh.position.y += c.mesh.userData.lift;
      c.mesh.quaternion.copy(camera.quaternion);
    }
    for (const s of this.shafts) {
      const m = s.material as THREE.MeshBasicMaterial;
      m.opacity = s.userData.base * (0.75 + 0.25 * Math.sin(this.time * 0.6 + s.userData.phase));
    }
  }
}
