import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  NoiseEffect,
  BlendFunction,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { AirEffect, GradeEffect } from './PostEffects';
import { VolumetricPass } from './VolumetricPass';

// Safety net for generated PBR assets: Lux3D textures can carry near-zero roughness spots, and a
// point light a few centimetres away then produces specular values beyond the half-float render
// target (65504). The overflow turns into black NaN blotches after bloom and tone mapping.
// Floor the roughness and clamp the shaded colour for every lit material.
THREE.ShaderChunk.roughnessmap_fragment += '\nroughnessFactor = max( roughnessFactor, 0.12 );\n';
THREE.ShaderChunk.opaque_fragment = THREE.ShaderChunk.opaque_fragment.replace(
  'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
  'outgoingLight = clamp( outgoingLight, vec3( 0.0 ), vec3( 6.0e4 ) );\ngl_FragColor = vec4( outgoingLight, diffuseColor.a );',
);

export type Quality = 'low' | 'medium' | 'high';

// N8AO's halfRes mode breaks with this three.js version, so lower tiers use fewer AO samples instead.
const PRESETS: Record<Quality, { ratio: number; ao: 'off' | 'Performance' | 'Medium'; vol: number; shadow: number; bloomLevels: number }> = {
  high: { ratio: 1.5, ao: 'Medium', vol: 0.5, shadow: 2048, bloomLevels: 7 },
  medium: { ratio: 1.25, ao: 'Performance', vol: 0.4, shadow: 2048, bloomLevels: 6 },
  low: { ratio: 1.0, ao: 'off', vol: 0.3, shadow: 1024, bloomLevels: 5 },
};

/**
 * The frame pipeline: scene → ambient occlusion (N8AO) → height fog + exposure → volumetric
 * sunlight → cinematic depth of field → bloom, tone mapping, grade, vignette, grain → SMAA.
 * Quality adapts to the measured frame rate unless `?quality=` pins it.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;
  readonly chroma: ChromaticAberrationEffect;
  readonly air: AirEffect;
  readonly grade: GradeEffect;
  readonly vol: VolumetricPass;
  readonly dof: DepthOfFieldEffect;
  readonly ao: N8AOPostPass;
  private dofPass: EffectPass;
  private renderPass: RenderPass;
  private pixelRatio: number;
  quality: Quality;
  private pinned: boolean;
  private slowTime = 0;
  private fastTime = 0;
  private emaDt = 1 / 60;
  /** Frames rendered (debug). */
  frames = 0;

  constructor(
    canvas: HTMLCanvasElement,
    public scene: THREE.Scene,
    public camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.gl.toneMapping = THREE.NoToneMapping; // done in post
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.localClippingEnabled = true;

    // ?quality= wins, then the player's saved choice from the pause menu, else adaptive
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('matterborn.quality');
    } catch {
      // storage unavailable (private mode): adaptive
    }
    const q = new URLSearchParams(location.search).get('quality') ?? saved;
    this.pinned = q === 'low' || q === 'medium' || q === 'high';
    this.quality = this.pinned ? (q as Quality) : 'high';
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, PRESETS[this.quality].ratio);
    this.gl.setPixelRatio(this.pixelRatio);

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.ao = new N8AOPostPass(scene, camera, 2, 2);
    this.ao.setQualityMode('Medium');
    Object.assign(this.ao.configuration, {
      aoRadius: 1.4,
      distanceFalloff: 0.6,
      intensity: 2.1,
      color: new THREE.Color(0x0a0612),
      gammaCorrection: false,
      halfRes: false,
    });
    // Off on purpose: with transparency awareness N8AO re-renders the whole scene twice a frame
    // with only transparent objects visible, which also re-renders (and empties) the sun's shadow
    // map that the volumetric pass reads afterwards.
    // (the flag alone is not enough: auto-detection would switch it back on at the first render)
    (this.ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
    this.ao.configuration.transparencyAware = false;
    this.composer.addPass(this.ao);

    this.air = new AirEffect(camera);
    this.composer.addPass(new EffectPass(camera, this.air));

    this.vol = new VolumetricPass(camera, sun);
    this.composer.addPass(this.vol);

    this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 8, worldFocusRange: 5, bokehScale: 3.2, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.3,
      intensity: 1.2,
      radius: 0.8,
      levels: PRESETS[this.quality].bloomLevels,
    });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.6 });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.00035, 0.00025), radialModulation: true, modulationOffset: 0.4 });
    this.grade = new GradeEffect();
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    noise.blendMode.opacity.value = 0.14;
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, this.grade, this.vignette, this.chroma, noise));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
    this.applyQuality(this.quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** 'auto' adapts to the frame rate; a fixed tier pins it. Remembered for the next visit. */
  setQualityMode(mode: 'auto' | Quality) {
    this.pinned = mode !== 'auto';
    try {
      localStorage.setItem('matterborn.quality', mode);
    } catch {
      // storage unavailable: the choice lasts for this session only
    }
    this.slowTime = this.fastTime = 0;
    this.applyQuality(mode === 'auto' ? 'high' : mode);
  }
  get qualityMode(): 'auto' | Quality {
    return this.pinned ? this.quality : 'auto';
  }

  /** Cinematic depth of field focused on `target` (a live vector, e.g. the camera's look point). */
  setDof(on: boolean, target?: THREE.Vector3) {
    this.dofPass.enabled = on && this.quality !== 'low';
    if (target) this.dof.target = target;
  }

  /** Called after every quality change (the game thins foliage on low). */
  onQuality: (q: Quality) => void = () => {};

  private applyQuality(q: Quality) {
    this.quality = q;
    const p = PRESETS[q];
    this.ao.enabled = p.ao !== 'off';
    if (p.ao !== 'off') this.ao.setQualityMode(p.ao);
    this.vol.setScale(p.vol);
    if (this.sun.shadow.mapSize.x !== p.shadow) {
      this.sun.shadow.mapSize.set(p.shadow, p.shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (q === 'low') this.dofPass.enabled = false;
    this.onQuality(q);
    if (!this.fixed) {
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, p.ratio);
      this.gl.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  /** Watch the frame time and step quality down (or back up) to hold a smooth frame rate. */
  private adapt(dt: number) {
    // ignore the first seconds (shader compilation hitches) and throttled background frames
    if (this.pinned || this.fixed || this.frames < 240 || dt <= 0 || dt > 0.2 || document.hidden) return;
    this.emaDt += (dt - this.emaDt) * 0.05;
    const order: Quality[] = ['low', 'medium', 'high'];
    const i = order.indexOf(this.quality);
    if (this.emaDt > 1 / 42) {
      this.slowTime += dt;
      this.fastTime = 0;
      if (this.slowTime > 4 && i > 0) {
        this.applyQuality(order[i - 1]);
        this.slowTime = 0;
        this.emaDt = 1 / 60;
      }
    } else if (this.emaDt < 1 / 58) {
      this.fastTime += dt;
      this.slowTime = 0;
      if (this.fastTime > 20 && i < order.length - 1) {
        this.applyQuality(order[i + 1]);
        this.fastTime = 0;
      }
    } else {
      this.slowTime = Math.max(0, this.slowTime - dt);
    }
  }

  private fixed: { w: number; h: number } | null = null;
  /** Render at an exact size regardless of the window (video capture). */
  setFixedSize(w: number, h: number) {
    this.fixed = { w, h };
    this.gl.setPixelRatio(1);
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.ao.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  clearFixedSize() {
    this.fixed = null;
    this.gl.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  resize() {
    if (this.fixed) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return; // hidden pane / minimised window: keep the last valid size
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private lastRender = 0;
  private dofV = new THREE.Vector3();
  /** Keep more of the frame sharp when the focus is far away (landscape shots), less for close-ups. */
  private updateDof() {
    if (!this.dofPass.enabled || !this.dof.target) return;
    const d = this.camera.position.distanceTo(this.dofV.copy(this.dof.target));
    this.dof.cocMaterial.focusRange = Math.max(4, d * 0.75);
    this.dof.bokehScale = d > 22 ? 1.4 : 3.2;
  }
  render(dt: number) {
    const c = this.gl.domElement;
    if (!this.fixed && (c.width < 2 || c.height < 2 || window.innerWidth < 2)) return;
    // adapt to the real interval between frames (the game clamps its own dt)
    const now = performance.now();
    if (this.lastRender) this.adapt((now - this.lastRender) / 1000);
    this.lastRender = now;
    this.updateDof();
    this.composer.render(dt);
    this.frames++;
  }
}
