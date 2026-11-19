import * as THREE from 'three';
import { Input, Action } from './core/Input';
import { loadManifest, getManifest, BASE, waitForLoads } from './core/Assets';
import { World3D, Collider, Box } from './physics/World3D';
import { Player, PlayerEvent, PlayerHost, EventData } from './actors/Player';
import { FORMS, Form } from './actors/forms';
import { HeroVisual, ProceduralGolem } from './actors/HeroVisual';
import { Colossus } from './actors/Colossus';
import { Moths } from './actors/Moths';
import { CameraRig } from './camera/CameraRig';
import { Renderer } from './render/Renderer';
import { Atmosphere } from './render/Atmosphere';
import { Particles } from './render/Particles';
import { restore, setRestored, FadeCategory, fxClock, updateRestoreWaves, fadeUniforms } from './render/MaterialFX';
import { yieldTask } from './core/yieldTask';
import { Level, LevelContext, upgradeMaterials, Altar, Trigger, WATER_LIGHT, Block, Beam } from './level/Level';
import { buildLevel1, LevelHooks } from './level/level1';
import { Director, ease } from './story/Director';
import { UI } from './ui/UI';
import { Audio, AmbienceId, VoiceMode } from './audio/Audio';
import { VLight, LightPool } from './render/LightPool';
import { MoodState } from './render/Mood';
import { updateFoliage } from './render/Foliage';
import { SUN } from './render/SharedLight';
import { SplatWorld } from './render/SplatWorld';
import { DustWall } from './render/DustWall';
import { Archive, ARCHIVE_ORIGIN } from './ui/Archive';
import { makeEnvironment } from './render/Environment';

/** On-screen hint (by its opening words) -> the narrator line spoken the first time it appears. */
const HINT_VOICE: [string, string][] = [
  ['Move with WASD', 'vo_h_move'],
  ['Jump onto the step', 'vo_h_balcony'],
  ['As Stone (2), press C', 'vo_h_pound'],
  ['Only Stone can shove stone', 'vo_h_push2'],
  ['The gate answers to the altar', 'vo_h_woodgate'],
  ['As Stone, press Shift', 'vo_h_charge'],
  ['Stone is too heavy to climb', 'vo_h_climb'],
  ['Clay melts in water. Stone sinks', 'vo_h_water'],
  ['Sink as Stone', 'vo_h_sink'],
  ['...then become Wood', 'vo_h_float'],
  ['Wood burns!', 'vo_h_fire'],
  ['The door answers only to light', 'vo_h_prism1'],
  ['The shutter by the crystal', 'vo_h_prism2'],
  ['The far gate opens while the plate', 'vo_h_well'],
  ["The Maker's Trial", 'vo_trial'],
];

const FIXED = 1 / 120;

type State = 'loading' | 'title' | 'play' | 'ending' | 'archive';

export class Game implements PlayerHost, LevelContext {
  readonly scene = new THREE.Scene();
  readonly input = new Input();
  readonly world = new World3D();
  readonly rig: CameraRig;
  readonly renderer: Renderer;
  readonly atmo: Atmosphere;
  readonly fx = new Particles();
  readonly ui = new UI();
  readonly audio = new Audio();
  readonly director: Director;
  level!: Level;
  hooks!: LevelHooks;
  player!: Player;
  hero!: HeroVisual;
  colossus = new Colossus();
  readonly moths = new Moths();
  time = 0;
  timeScale = 1;
  state: State = 'loading';
  paused = false;
  private acc = 0;
  private last = performance.now();
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private rim!: THREE.DirectionalLight;
  private escape = { active: false, front: 0, slamTimer: 0, slamFxAt: 0, done: false };
  private escapeStepT = 0;
  private escapeVoiceT = 6;
  private escapeLight = new VLight(0xff6a2a, 0, 30, 2);
  readonly mood = new MoodState();
  readonly lightPool: LightPool;
  splatWorld!: SplatWorld;
  archive!: Archive;
  private focus = new THREE.Vector3();
  private dangerTint = new THREE.Color(0.75, 0.38, 0.22);
  private dustWall: DustWall | null = null;
  private deathTimer = 0;
  private hitstop = 0;
  private titleCamT = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.rig = new CameraRig(window.innerWidth / window.innerHeight, canvas);
    this.rig.world = this.world;
    this.setupLights();
    this.renderer = new Renderer(canvas, this.scene, this.rig.camera, this.sun);
    this.lightPool = new LightPool(this.scene, 8);
    this.scene.environment = makeEnvironment(this.renderer.gl);
    this.scene.environmentIntensity = 0.35;
    this.ui.clock = () => this.time;
    fxClock.now = () => this.time;
    this.atmo = new Atmosphere(this.scene);
    this.scene.fog = null; // height fog is a post effect (render/PostEffects.ts)
    this.atmo.setSun(this.sun);
    this.splatWorld = new SplatWorld(this.scene, this.renderer.gl);
    this.director = new Director(this.rig);
    this.director.onSkipProgress = (k) => this.ui.skipProgress(k, this.director.running && this.state !== 'title');
    // skipping a cutscene silences it: the narrator stops, and nothing its script would play is heard
    this.director.onSkip = () => {
      this.audio.hushed = true;
      this.audio.stopVoice();
    };
    this.scene.add(this.fx.group);
  }

  async init() {
    void this.audio.preload();
    this.ui.setLoading(0.1, 'Waking the workshop...');
    await loadManifest();
    void this.colossus.loadAssets();
    this.ui.setLoading(0.3, 'Shaping the world...');
    this.level = new Level(this.world, this.scene);
    this.hooks = buildLevel1(this.level, this.atmo);
    // blocks and beams place themselves in update(), which does not run on the title screen:
    // position them now (they otherwise sit stacked at the world origin behind the title)
    const density = { high: 1, medium: 0.7, low: 0.4 } as const;
    this.renderer.onQuality = (q) => this.level.foliage.setDensity(density[q]);
    this.level.foliage.setDensity(density[this.renderer.quality]);
    this.rig.zones = this.hooks.zones;
    const w = this.hooks.wakeSpot;
    this.player = new Player(this, w.x, w.y, w.z);
    for (const e of this.level.entities) if (e instanceof Block || e instanceof Beam) e.update(0, this);
    this.player.heading = Math.PI * 0.35;
    this.hero = await this.makeHero();
    this.scene.add(this.hero.root);
    this.hero.setForm('clay', true);
    this.scene.add(this.moths.group);
    this.archive = new Archive(this.scene);
    // moths circle the lanterns of the hall, the stone court and the valley tree
    void this.moths.load([
      new THREE.Vector3(-4, 6.2, -3),
      new THREE.Vector3(9, 6.6, 2),
      new THREE.Vector3(47, 2.6, 0),
      new THREE.Vector3(36, 1.6, -8.6),
      new THREE.Vector3(87, 11, -4.8),
      new THREE.Vector3(374, 4, -6),
    ]);
    this.colossus.root.position.copy(this.hooks.colossusAnchor);
    this.colossus.root.position.y = -30;
    this.scene.add(this.colossus.root);
    this.scene.add(this.escapeLight);
    this.ui.setLoading(0.6, 'Gathering materials...');
    await upgradeMaterials();
    const pano = getManifest().pano;
    if (pano) new THREE.TextureLoader().load(BASE + pano, (t) => this.atmo.setPanorama(t, 0.75));
    for (const c of ['stone', 'wood', 'glass', 'life'] as const) setRestored(c, false);
    // every Lux3D model in view is in place before the curtain rises (no pop-in on the title screen)
    await waitForLoads((k) => this.ui.setLoading(0.6 + k * 0.3, 'Gathering materials...'));
    this.ui.setLoading(0.9, 'Lighting the kiln...');
    this.rig.snap(this.player.cx, this.player.body.y, this.player.cz);
    this.renderer.render(0);
    this.ui.setLoading(1, '');
    this.ui.hideLoading();
    this.state = 'title';
    this.ui.showTitle(true);
    // the Aholo World backdrop streams in while the title is up
    // Placed so the valley cameras (z ≈ 12–15) look through the world's distant towers and mountains
    // while its near ground lies below the meadow. Cameras must not move closer to it (z > 18): its
    // near splats then fill the frame.
    void this.splatWorld.load('valley', { position: { x: 370, y: -6, z: 30 }, scale: 1.6 });
    this.hero.forceAnim('lying');
    this.rig.setCinematic(true);
    this.rig.cinPos.set(-5, 3.5, 9);
    this.rig.cinLook.set(-1, 1.2, -2);
    this.rig.cinFov = 36;
    this.renderer.setDof(true, this.rig.cinLook);
    this.player.control = false;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private async makeHero(): Promise<HeroVisual> {
    if (getManifest().models.hero_rig) {
      try {
        const { RiggedHero } = await import('./actors/RiggedHero');
        const h = await RiggedHero.create();
        if (h) return h;
      } catch (err) {
        console.warn('rigged hero unavailable, using procedural golem', err);
      }
    }
    return new ProceduralGolem();
  }

  private setupLights() {
    this.hemi = new THREE.HemisphereLight(0x7f95c8, 0x2a1c14, 0.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc890, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera as THREE.OrthographicCamera;
    s.left = -22;
    s.right = 22;
    s.top = 22;
    s.bottom = -22;
    s.near = 1;
    s.far = 130;
    // layer 1: shadow-only casters (roofs over the halls) the camera never sees
    s.layers.enable(1);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0x7fc8ff, 1.0);
    this.rim.position.set(30, 20, -40);
    this.scene.add(this.rim);
    this.scene.add(new THREE.AmbientLight(0x30364a, 0.12));
  }

  /** Sun strength multiplier for cutscenes (1 = the mood's own value). */
  sunScale = 1;
  /** 0..1 swell of saturation, bloom and exposure (restoration moments). */
  fxBoost = 0;
  /** 0..1 how close the collapse is behind Loam during the escape (vignette and warmth). */
  private danger = 0;

  /** Blend the area mood and push it into lights, sky, air and grade. */
  private applyMood(dt: number) {
    const r = this.rig;
    const p = this.player;
    // during cutscenes the mood follows what the camera looks at, otherwise the player
    if (r.cinematic > 0.5) this.focus.copy(r.cinLook);
    else this.focus.set(p.cx, p.body.y, p.cz);
    this.mood.update(dt, this.focus.x);
    const { c, n } = this.mood;
    const from = this.mood.sunFrom;
    this.sun.color.copy(c.sunColor);
    this.sun.intensity = n.sunIntensity * this.sunScale;
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(from, 60);
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = n.hemiIntensity;
    this.rim.color.copy(c.rimColor);
    this.rim.intensity = n.rimIntensity;
    this.atmo.applyMood(c.skyTop, c.skyMid, c.skyHorizon, c.skySun, c.fogFar, from);
    const R = this.renderer;
    const air = R.air;
    air.fogNear.copy(c.fogNear);
    air.fogFar.copy(c.fogFar);
    air.sunGlow.copy(c.sunGlow);
    air.sunDir.copy(from);
    air.density = n.fogDensity;
    air.heightFalloff = n.fogFalloff;
    air.baseHeight = n.fogBase;
    air.maxFog = n.fogMax;
    air.exposure = n.exposure;
    R.vol.color.copy(c.sunColor);
    R.vol.strength = n.vol * 0.03;
    R.vol.setAir({ heightFalloff: n.volFalloff, baseHeight: n.volBase, outside: n.volOutside });
    const g = R.grade;
    g.saturation = n.saturation + this.fxBoost * 0.3;
    g.contrast = n.contrast;
    g.shadowTint.copy(c.shadowTint);
    g.highTint.copy(c.highTint);
    g.split = n.split;
    R.bloom.intensity = n.bloom + this.fxBoost * 0.9;
    air.exposure = n.exposure + this.fxBoost * 0.18;
    R.bloom.luminanceMaterial.threshold = n.bloomThreshold;
    R.vignette.darkness = n.vignette + this.danger * (0.32 + Math.sin(this.time * 7) * 0.06);
    if (this.danger > 0) g.highTint.lerp(this.dangerTint, this.danger * 0.5);
    this.scene.environmentIntensity = n.envIntensity;
    SUN.dir.value.copy(from);
    SUN.color.value.copy(c.sunColor).multiplyScalar(n.sunIntensity);
    WATER_LIGHT.sunDir.value.copy(from);
    WATER_LIGHT.sunColor.value.copy(c.sunColor).multiplyScalar(n.sunIntensity * 0.35);
    WATER_LIGHT.sky.value.copy(c.skyMid).lerp(c.skyHorizon, 0.4);
    WATER_LIGHT.fog.value.copy(c.fogFar);
    this.lightPool.update(dt, this.focus, r.camera);
  }

  // ---------------------------------------------------------------- main loop
  /** When set, requestAnimationFrame no longer advances the game; a tool calls advance() itself. */
  manual = false;

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.manual) this.advance(dt);
  }

  /** One rendered frame covering `dt` seconds of real time (pause, hitstop and slow motion applied). */
  advance(dt: number) {
    if (this.paused) {
      this.input.update(0);
      if (this.input.pressed('pause')) this.togglePause();
      this.renderer.render(0);
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.08;
    }
    dt *= this.timeScale;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 12 && !this.paused) {
      this.fixedUpdate(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    if (steps >= 12) this.acc = 0;
    this.frameUpdate(dt);
  }

  private fixedUpdate(dt: number) {
    this.time += dt;
    this.input.update(dt);
    // Esc (or Start) opens the pause menu, in play and during cutscenes. It is checked right after
    // the input edge is computed: checked once per rendered frame, it missed every press made on a
    // frame that ran two or more fixed steps (most frames at 60 Hz).
    if (this.input.pressed('pause') && this.state === 'play' && !this.paused) {
      this.togglePause();
      return;
    }
    this.director.update(dt, this.input.held('skip'));
    // a skip has finished fast-forwarding its script: sound may play again
    if (this.audio.hushed && !this.director.skipping) this.audio.hushed = false;
    if (this.state === 'title') {
      if (this.input.pressed('confirm') || this.input.pressed('jump')) this.startGame();
      return;
    }
    if (this.state === 'archive') {
      if (this.input.pressed('left')) this.archive.next(-1);
      if (this.input.pressed('right')) this.archive.next(1);
      if (this.input.pressed('pause')) this.closeArchive();
      return;
    }
    if (this.player.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.respawn();
    } else this.player.update(dt);
    this.level.update(dt, this);
    if (this.escape.active) this.updateEscape(dt);
  }

  private lookTarget = new THREE.Vector3();
  private idleTime = 0;
  /** Loam glances at unused altar orbs nearby, and at the camera after standing still a while. */
  private updateLook(dt: number) {
    const p = this.player;
    this.idleTime = p.anim === 'idle' && p.control ? this.idleTime + dt : 0;
    let target: THREE.Vector3 | null = null;
    let best = 8;
    for (const a of this.level.altars) {
      if (a.used || Math.abs(a.y - p.body.y) > 4) continue;
      const d = Math.hypot(a.x - p.cx, a.z - p.cz);
      if (d < best) {
        best = d;
        target = a.orbWorldPosition(this.lookTarget);
      }
    }
    if (!target && this.idleTime > 3 && this.idleTime < 7) target = this.lookTarget.copy(this.rig.camera.position);
    this.hero.lookAt = target;
  }

  private frameUpdate(dt: number) {
    const p = this.player;
    this.updateLook(dt);
    this.hero.update(dt, p);
    this.hero.root.visible = !p.dead;
    if (this.state === 'archive') {
      const o = ARCHIVE_ORIGIN;
      const h = this.archive.height;
      const f = this.archive.frame;
      // look a little left of the plinth so the model sits right of the info panel
      const sx = -0.45 * f;
      this.rig.cinPos.set(o.x + 0.7 + sx, o.y + 1.1 + h * 0.45, o.z + 2.6 + f * 1.25);
      this.rig.cinLook.set(o.x + sx, o.y + 0.36 + h * 0.48, o.z);
      this.rig.cinFov = 36;
      this.archive.update(dt);
    }
    if (this.state === 'title') {
      this.titleCamT += dt;
      const t = this.titleCamT;
      this.rig.cinPos.set(-5 + Math.sin(t * 0.06) * 2.5, 3.4 + Math.sin(t * 0.09) * 0.4, 9 + Math.sin(t * 0.04));
      this.rig.cinLook.set(-1.5, 1.4, -2.5);
    }
    this.rig.update(dt, p.cx, p.body.y, p.cz, p.body.vx, p.body.vy, p.body.vz, false);
    this.applyMood(dt);
    this.atmo.viewHeight = this.renderer.gl.domElement.height;
    this.fx.setViewHeight(this.renderer.gl.domElement.height);
    this.level.foliage.setViewHeight(this.renderer.gl.domElement.height);
    updateFoliage(this.time);
    this.atmo.update(dt, this.rig.camera);
    this.splatWorld.update(dt, this.rig.camera.position.x);
    this.ambientFx(dt);
    this.fx.update(dt);
    updateRestoreWaves();
    this.colossus.update(dt);
    this.moths.update(dt);
    this.updateAmbience();
    this.audio.update();
    if (this.state === 'play') this.ui.setForms(p.unlocked, p.form);
    this.renderer.render(dt);
  }

  /** Looping ambience beds by area: the hall's air, running water, the fire trough, the collapse, the valley. */
  private updateAmbience() {
    const p = this.player;
    const x = p.cx;
    const lv: Partial<Record<AmbienceId, number>> = {};
    if (this.state === 'ending' || (this.state === 'play' && x > 330)) lv.amb_valley = 0.9;
    else if (this.state === 'play') {
      if (this.escape.active) lv.amb_collapse = 0.55 + this.danger * 0.45;
      else if (x < 77) lv.amb_hall = 0.75;
      else if (x < 146) {
        lv.amb_water = x > 90 && x < 125 ? 0.85 : 0.4;
        lv.amb_hall = 0.25;
        const fd = Math.hypot(Math.max(0, Math.abs(x - 130.6) - 0.8), Math.max(0, p.body.y - 4.2) * 0.5);
        lv.amb_fire = THREE.MathUtils.clamp(1 - fd / 16, 0, 1) * 0.9;
      } else if (x < 177.5) lv.amb_hall = 0.6;
      else if (x < 225.5) {
        // the Maker's Trial: the pool below, then the fire trough
        lv.amb_hall = 0.5;
        lv.amb_water = x > 186 && x < 206 ? 0.6 : 0.15;
        lv.amb_fire = THREE.MathUtils.clamp(1 - Math.abs(x - 209.8) / 14, 0, 1) * 0.8;
      } else lv.amb_hall = 0.3;
    }
    this.audio.setAmbience(lv);
  }

  /** Ambient life per area: blossom petals drifting off the valley tree, spores over the aqueduct. */
  private ambientFx(dt: number) {
    const cam = this.rig.camera.position;
    const life = fadeUniforms('life').uFade.value < 0.5;
    if (cam.x > 333 && Math.random() < dt * 16) {
      this.fx.soft.emit({ x: 374 + (Math.random() - 0.5) * 8, y: 5.6 + Math.random() * 3.2, z: -6 + (Math.random() - 0.5) * 6.5, count: 1, vx: 0.7, vy: -0.35, speed: 0.35, color: 0xffc4da, color2: 0xfff0f4, life: 8, size: 0.085, alpha: 0.95, drag: 0.25, gravity: 0.12 });
    }
    if (life && cam.x > 80 && cam.x < 146 && Math.random() < dt * 6) {
      const x = cam.x - 6 + Math.random() * 22;
      this.fx.glow.emit({ x, y: 3 + Math.random() * 6, z: -4 + Math.random() * 8, count: 1, vy: 0.25, speed: 0.15, color: 0x9ff7d8, life: 4, size: 0.05, alpha: 0.8, drag: 0.4 });
    }
  }

  /** The Maker's Archive: browse every Aholo-generated model (from the title screen). */
  openArchive() {
    if (this.state !== 'title') return;
    this.state = 'archive';
    this.ui.showTitle(false);
    this.mood.override = 'archive';
    this.mood.snap();
    this.archive.open();
    this.rig.setCinematic(true);
    this.rig.cinematic = 1;
    this.renderer.setDof(true, this.rig.cinLook);
    this.input.clearAll();
    this.audio.start();
    this.audio.play('ui');
    this.audio.titleMusic(true);
  }
  closeArchive() {
    if (this.state !== 'archive') return;
    this.state = 'title';
    this.archive.close();
    this.mood.override = null;
    this.mood.snap();
    this.ui.showTitle(true);
    this.rig.cinPos.set(-5, 3.5, 9);
    this.rig.cinLook.set(-1, 1.2, -2);
    this.rig.cinFov = 36;
    this.rig.cinematic = 1;
    this.renderer.setDof(true, this.rig.cinLook);
    this.input.clearAll();
    this.audio.titleMusic(false);
    this.audio.play('uiBack');
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.audio.play('uiBack');
      this.audio.setPaused(true); // narration and score hold where they are, in step with a paused cutscene
    } else {
      this.audio.setPaused(false);
      this.audio.play('ui');
    }
    this.ui.pause(this.paused, this.director.running);
    this.input.clearAll();
  }
  /** Opens the pause menu if the game is being played (Esc that left fullscreen never reaches the page). */
  pauseIfPlaying() {
    if (this.state === 'play' && !this.paused) this.togglePause();
  }
  /** "Skip scene" in the pause menu during a cutscene. */
  skipScene() {
    if (this.paused) this.togglePause();
    this.director.skip();
  }

  /** Back to the last shrine, resetting nearby puzzle blocks (pause menu). */
  restartFromShrine() {
    const p = this.player;
    for (const b of this.level.blocks) if (Math.hypot(b.home.x - p.cx, b.home.z - p.cz) < 40) b.reset();
    this.kill(p, 'fall');
  }

  // ---------------------------------------------------------------- test hooks
  readonly debug = {
    step: (sec: number) => {
      const n = Math.max(1, Math.round(sec / FIXED));
      let since = 0;
      for (let i = 0; i < n; i++) {
        this.fixedUpdate(FIXED);
        since += FIXED;
        if (since >= 1 / 30 || i === n - 1) {
          this.frameUpdate(since);
          since = 0;
        }
      }
      return this.debug.state();
    },
    play: async (sec: number) => {
      const frames = Math.max(1, Math.round(sec * 30));
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < 4; i++) this.fixedUpdate(FIXED);
        this.frameUpdate(4 * FIXED);
        await yieldTask(); // a message, not a timer: timers are throttled in hidden windows
      }
      return this.debug.state();
    },
    hold: (a: Action, on = true) => {
      if (on) this.input.virtual.add(a);
      else this.input.virtual.delete(a);
    },
    tap: (a: Action) => this.input.tap(a),
    release: () => this.input.virtual.clear(),
    teleport: (x: number, y: number, z: number) => {
      this.player.teleport(x, y, z);
      this.rig.snap(x, y, z);
    },
    unlockAll: () => {
      for (const f of ['stone', 'wood', 'glass'] as Form[]) this.player.unlock(f);
    },
    skip: () => this.director.skip(),
    /** Clear escape and finale state so a dev shot can start anywhere. */
    resetFlow: () => {
      Object.assign(this.escape, { active: false, done: false, slamFxAt: 0 });
      this.danger = 0;
      this.escapeLight.intensity = 0;
      if (this.dustWall) this.dustWall.group.visible = false;
      this.timeScale = 1;
      this.hitstop = 0;
      this.colossus.root.position.y = -30;
      this.colossus.eye = 0;
      for (const e of this.level.entities) if (e instanceof Trigger) e.fired = false;
    },
    /** Move toward a world-space direction regardless of camera (tests). */
    move: (x: number, z: number) => {
      this.player.control = true;
      const yaw = this.rig.yaw;
      // invert the camera-relative mapping so tests can think in world space
      const ax = x * Math.cos(yaw) - z * Math.sin(yaw);
      const ay = -(x * Math.sin(yaw) + z * Math.cos(yaw));
      this.input.virtual.delete('left');
      this.input.virtual.delete('right');
      this.input.virtual.delete('up');
      this.input.virtual.delete('down');
      this.forcedAxis = { x: ax, y: ay };
    },
    stop: () => {
      this.forcedAxis = null;
    },
    state: () => {
      const p = this.player;
      return {
        state: this.state,
        x: +p.cx.toFixed(2),
        y: +p.body.y.toFixed(2),
        z: +p.cz.toFixed(2),
        vx: +p.body.vx.toFixed(2),
        vy: +p.body.vy.toFixed(2),
        vz: +p.body.vz.toFixed(2),
        grounded: p.grounded,
        anim: p.anim,
        form: p.form,
        dead: p.dead,
        control: p.control,
        cutscene: this.director.running,
        escape: this.escape.active ? +this.escape.front.toFixed(1) : null,
      };
    },
  };
  private forcedAxis: { x: number; y: number } | null = null;

  // ---------------------------------------------------------------- PlayerHost
  cameraYaw() {
    if (this.forcedAxis) {
      // tests: feed the forced axis straight into the input each step
      this.input.axisX = this.forcedAxis.x;
      this.input.axisY = this.forcedAxis.y;
    }
    return this.rig.yaw;
  }

  emit(e: PlayerEvent, p: Player, d: EventData = {}) {
    this.hero.onEvent(e, p);
    const x = d.x ?? p.cx;
    const y = d.y ?? p.body.y;
    const z = d.z ?? p.cz;
    const pan = this.panFor(x, z);
    const form = p.form;
    const dust = form === 'glass' ? 0xcff6ff : 0xcbb8a0;
    const fx = this.fx;
    switch (e) {
      case 'jump':
        fx.soft.emit({ x, y, z, count: 8, spreadX: 0.5, spreadZ: 0.5, speed: 2.5, dirY: 0.2, color: dust, life: 0.6, size: 0.5, alpha: 0.4, drag: 3, grow: 1.8 });
        this.audio.play('jump', { pan });
        if (Math.random() < 0.22) this.audio.play('loamHup', { pan });
        break;
      case 'flip':
        fx.glow.emit({ x, y: y + 0.5, z, count: 18, speed: 4, color: FORMS[form].emissive, life: 0.5, size: 0.14 });
        this.audio.play('flip', { pan });
        break;
      case 'walljump':
        fx.soft.emit({ x, y, z, count: 10, speed: 3, color: dust, life: 0.5, size: 0.4, alpha: 0.4 });
        this.audio.play('walljump', { pan });
        break;
      case 'land':
        fx.soft.emit({ x, y, z, count: 10, spreadX: 0.6, spreadZ: 0.6, speed: 2.5, dirY: 0.1, color: dust, life: 0.6, size: 0.45, alpha: 0.35, drag: 3, grow: 1.6 });
        this.audio.play('land', { pan, volume: Math.min(1, (d.speed ?? 8) / 14), pitch: form === 'stone' ? 0.6 : 1 });
        break;
      case 'hardLand':
        fx.soft.emit({ x, y, z, count: 22, spreadX: 0.8, spreadZ: 0.8, speed: 4, dirY: 0.1, color: dust, life: 0.9, size: 0.6, alpha: 0.4, drag: 3, grow: 2 });
        this.rig.shake(0.25);
        this.audio.play('hardLand', { pan, volume: 0.6 });
        if (Math.random() < 0.5) this.audio.play('loamOof', { pan });
        break;
      case 'pound':
        fx.glow.emit({ x, y: y + 0.5, z, count: 16, speed: 3, color: 0xffb860, life: 0.4, size: 0.15 });
        this.audio.play('pound', { pan });
        break;
      case 'poundImpact':
        fx.soft.emit({ x, y, z, count: 30, spreadX: 1.2, spreadZ: 1.2, speed: 6, dirY: 0.15, color: 0xb9a892, life: 1.0, size: 0.7, alpha: 0.5, drag: 3, grow: 2.2 });
        fx.rocks.burst(x, y + 0.2, 8, 0.25, 6, 0x8a8178, y, 0.8, z);
        this.rig.shake(0.45);
        this.hitstop = 0.06;
        this.audio.play('poundImpact', { pan });
        break;
      case 'dash':
        fx.glow.emit({ x, y: y + 0.55, z, count: 24, spreadX: 0.3, spreadY: 0.8, spreadZ: 0.3, vx: -p.body.vx * 0.25, vz: -p.body.vz * 0.25, speed: 1.5, color: FORMS[form].emissive, life: 0.45, size: 0.18 });
        this.audio.play('dash', { pan, form });
        break;
      case 'transform': {
        const f = d.form ?? form;
        this.hero.setForm(f);
        fx.glow.emit({ x, y: d.y ?? p.cy, z, count: 60, speed: 6, color: FORMS[f].emissive, color2: 0xffffff, life: 0.7, size: 0.16 });
        fx.soft.emit({ x, y: d.y ?? p.cy, z, count: 14, speed: 2, color: FORMS[f].color, life: 0.8, size: 0.8, alpha: 0.25, grow: 2 });
        this.hitstop = 0.05;
        this.audio.play('transform', { pan, form: f });
        this.ui.pulseForm(f);
        break;
      }
      case 'splash':
        fx.glow.emit({ x, y, z, count: 30, spreadX: 0.8, spreadZ: 0.8, speed: 5, dirY: 1.2, gravity: 18, color: 0xbfefff, life: 0.8, size: 0.12 });
        fx.soft.emit({ x, y, z, count: 10, spreadX: 1, spreadZ: 1, speed: 2, dirY: 1, color: 0xd8f6ff, life: 0.7, size: 0.5, alpha: 0.35 });
        this.audio.play('splash', { pan, volume: Math.min(1, 0.3 + (d.speed ?? 5) / 15) });
        if (form === 'stone') this.audio.play('bubbles', { pan, volume: 0.8 });
        break;
      case 'step':
        if (Math.random() < 0.5) fx.soft.emit({ x, y, z, count: 2, spreadX: 0.3, spreadZ: 0.3, speed: 1, dirY: 0.3, color: dust, life: 0.5, size: 0.3, alpha: 0.25 });
        this.audio.play('step', { pan, form, volume: 0.8 });
        break;
      case 'climb':
        this.audio.play('climb', { pan });
        break;
      case 'imprint':
        fx.glow.emit({ x, y, z, count: 50, speed: 5, color: FORMS[d.form ?? form].emissive, color2: 0xffffff, life: 0.8, size: 0.16 });
        this.audio.play('imprint', { pan });
        this.rig.shake(0.08);
        break;
    }
  }

  private panFor(x: number, z: number) {
    const cam = this.rig.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const rel = new THREE.Vector3(x - cam.position.x, 0, z - cam.position.z);
    return THREE.MathUtils.clamp(rel.dot(right) / 12, -1, 1);
  }

  findPushable(p: Player, axis: 'x' | 'z', dir: -1 | 1) {
    return this.level.findPushable(p, axis, dir);
  }
  findTransmutable(p: Player) {
    return this.level.findTransmutable(p);
  }
  tryBreak(c: Collider, how: 'pound' | 'charge') {
    const crack = this.level.crackFor(c);
    if (!crack || crack.broken) return false;
    if ((how === 'pound' && crack.mode !== 'floor') || (how === 'charge' && crack.mode !== 'wall')) return false;
    crack.shatter(this);
    this.hitstop = 0.08;
    return true;
  }
  hazardAt(a: Box) {
    return this.level.hazardAt(a);
  }

  kill(p: Player, reason: string) {
    if (p.dead) return;
    p.dead = true;
    this.deathTimer = 1.1;
    const x = p.cx;
    const y = p.cy;
    const z = p.cz;
    const pan = this.panFor(x, z);
    const fx = this.fx;
    if (reason === 'shatter') {
      fx.shards.burst(x, y, 30, 0.22, 8, 0xbff4ff, p.body.y, 0.6, z);
      fx.glow.emit({ x, y, z, count: 50, speed: 7, color: 0xbff4ff, life: 0.8, size: 0.12 });
      this.audio.play('shatter', { pan });
      this.audio.play('loamHurt', { pan });
      this.ui.toast('Glass shatters on hard landings. Switch forms before you land.');
      this.narrateOnce('vo_d_shatter', 'drop');
    } else if (reason === 'melt') {
      fx.soft.emit({ x, y, z, count: 40, speed: 3, color: 0xa8653f, life: 1.4, size: 0.5, alpha: 0.7, gravity: 4 });
      this.audio.play('melt', { pan });
      this.audio.play('loamHurt', { pan });
      this.ui.toast('Clay melts in water.');
      this.narrateOnce('vo_d_melt', 'drop');
    } else if (reason === 'burn') {
      fx.glow.emit({ x, y, z, count: 70, speed: 4, vy: 3, color: 0xff7a1f, color2: 0xffd27a, life: 1.0, size: 0.2 });
      fx.soft.emit({ x, y, z, count: 20, speed: 1.5, vy: 2, color: 0x2a2a2a, life: 1.6, size: 0.8, alpha: 0.5, grow: 2 });
      this.audio.play('burn', { pan });
      this.audio.play('loamHurt', { pan });
      this.ui.toast('Wood burns. Cross fire as Clay or Stone.');
      this.narrateOnce('vo_d_burn', 'drop');
    } else {
      fx.soft.emit({ x, y, z, count: 30, speed: 3, color: 0xcbb8a0, life: 1, size: 0.6, alpha: 0.5 });
      fx.rocks.burst(x, y, 10, 0.2, 5, FORMS[p.form].color, p.body.y - 5, 0.6, z);
      this.audio.play('land', { pan });
    }
    this.rig.shake(0.3);
  }

  private respawn() {
    const p = this.player;
    let { x, y, z } = p.respawn;
    if (this.escape.active) {
      const safe = [
        { x0: 234, x1: 247, y: 8 },
        { x0: 254, x1: 261, y: 9 },
        { x0: 264, x1: 273, y: 9 },
        { x0: 289, x1: 304, y: 10.5 },
      ];
      x = Math.max(x, this.escape.front + 8);
      const s = safe.find((s) => x <= s.x1) ?? safe[safe.length - 1];
      x = THREE.MathUtils.clamp(x, s.x0, s.x1);
      y = s.y;
      z = 0;
      if (this.escape.front > x - 6) this.escape.front = x - 9;
    }
    p.teleport(x, y + 0.02, z);
    p.dead = false;
    this.fx.glow.emit({ x, y: y + 0.6, z, count: 50, speed: 4, color: FORMS[p.form].emissive, life: 0.8, size: 0.14 });
    this.audio.play('respawn');
  }

  // ---------------------------------------------------------------- LevelContext
  sfx(name: string, opts: { x?: number; z?: number; volume?: number; pitch?: number } = {}) {
    const pan = opts.x !== undefined ? this.panFor(opts.x, opts.z ?? 0) : 0;
    this.audio.play(name, { pan, volume: opts.volume, pitch: opts.pitch });
  }
  private hintOwner: unknown = null;
  private hintText: string | null = null;
  showHint(text: string | null, owner?: unknown) {
    if (text === null) {
      // leaving a zone only clears the hint that zone put up (stepping between neighbouring zones used to blank it)
      if (owner !== undefined && owner !== this.hintOwner) return;
      this.hintOwner = null;
    } else this.hintOwner = owner ?? null;
    this.hintText = text;
    if (this.director.running) return; // shown when the cutscene ends (endCinematic)
    this.ui.hint(text);
    if (text) this.voiceHint(text);
  }
  /** The narrator reads a hint the first time it appears. */
  private voiceHint(text: string) {
    const line = HINT_VOICE.find(([prefix]) => text.startsWith(prefix));
    if (line) this.narrateOnce(line[1], 'drop');
  }
  private narrated = new Set<string>();
  /** Speak a narrator line only the first time (hints and death explanations). */
  private narrateOnce(id: string, mode: VoiceMode = 'queue') {
    if (this.narrated.has(id)) return;
    if (this.audio.say(id, mode) > 0 || !this.audio.ctx) this.narrated.add(id);
  }
  onTrigger(id: string, data?: unknown) {
    if (id.startsWith('altar:')) void this.director.run(() => this.altarScene(data as Altar));
    else if (id === 'colossus') void this.director.run(() => this.colossusScene());
    else if (id === 'finale') void this.director.run(() => this.finaleScene());
  }

  // ---------------------------------------------------------------- flow
  startGame() {
    if (this.state !== 'title') return;
    this.audio.start();
    this.audio.play('ui');
    this.state = 'play';
    this.ui.showTitle(false);
    this.input.clearAll();
    void this.director.run(() => this.introScene());
  }

  private beginCinematic() {
    this.player.control = false;
    this.player.scriptMove = { x: 0, z: 0 };
    this.ui.hint(null);
    this.director.syncFromCamera();
    this.rig.setCinematic(true);
    this.ui.letterbox(true);
    this.renderer.setDof(true, this.rig.cinLook);
  }
  private endCinematic() {
    this.ui.letterbox(false);
    // a skipped cutscene may still be inside a long fade from black: clear it quickly
    if (this.director.skipping) this.ui.fade(0, 0.4);
    this.rig.setCinematic(false);
    this.renderer.setDof(false);
    this.player.control = true;
    this.hero.forceAnim(null);
    this.ui.story(null);
    this.ui.titleCardShow(null);
    this.input.clearAll();
    if (this.hintText) {
      // a hint zone entered during the cutscene shows (and is read) now
      this.ui.hint(this.hintText);
      if (!this.director.skipping) this.voiceHint(this.hintText);
    }
  }

  private async introScene() {
    const d = this.director;
    const p = this.player;
    this.beginCinematic();
    this.hero.forceAnim('lying');
    this.ui.fade(1, 0);
    this.audio.setMood('calm', 4);
    // high wide shot of the dark hall, light pouring through the windows
    this.rig.cinPos.set(14, 12, 12);
    this.rig.cinLook.set(-2, 3, -6);
    this.rig.cinFov = 50;
    await d.wait(0.4);
    this.ui.fade(0, 3);
    this.ui.story('Long ago, the Makers shaped the world from living matter.');
    this.audio.say('vo_intro_1', 'interrupt');
    await d.camTo({ x: 6, y: 9, z: 12 }, { x: -6, y: 2.5, z: -6 }, 44, 5, ease.sine);
    this.ui.story('When they vanished, everything they made faded back into clay.');
    this.audio.say('vo_intro_2');
    await d.camTo({ x: -3, y: 3.8, z: 4 }, { x: -9, y: 1.6, z: -7 }, 36, 5, ease.sine);
    this.ui.story('But one small spark remembered, and it found Loam.');
    this.audio.say('vo_intro_3');
    const spark = new VLight(0xffa040, 0, 7, 2);
    spark.priority = 3;
    this.scene.add(spark);
    const from = this.hooks.kiln.clone().add(new THREE.Vector3(0.8, 0, 2.6));
    const to = new THREE.Vector3(p.cx, p.body.y + 0.35, p.cz);
    this.audio.play('awaken', { volume: 0.7 });
    await d.tween(0.8, (k) => (spark.intensity = k * 16), ease.out);
    const camMove = d.camTo({ x: p.cx + 2.6, y: 1.5, z: p.cz + 3.2 }, { x: p.cx, y: 0.5, z: p.cz }, 34, 3.4, ease.inOut);
    await d.tween(
      3.4,
      (k) => {
        spark.position.lerpVectors(from, to, k);
        spark.position.y += Math.sin(k * Math.PI) * 2;
        if (Math.random() < 0.6) this.fx.glow.emit({ x: spark.position.x, y: spark.position.y, z: spark.position.z, count: 2, speed: 0.6, color: 0xffb060, life: 0.9, size: 0.12 });
      },
      ease.inOut,
    );
    await camMove;
    this.fx.glow.emit({ x: to.x, y: to.y, z: to.z, count: 70, speed: 3.5, color: 0xffb060, color2: 0xffffff, life: 1.1, size: 0.16 });
    this.scene.remove(spark);
    spark.dispose();
    this.rig.shake(0.1);
    this.ui.story(null);
    await d.wait(0.6);
    this.hero.forceAnim('wake');
    this.audio.play('loamWake');
    await d.camTo({ x: p.cx + 3.4, y: 2.2, z: p.cz + 4.6 }, { x: p.cx, y: 1.0, z: p.cz }, 36, 2.6, ease.inOut);
    this.hero.forceAnim('idle');
    await d.wait(0.5);
    this.ui.titleCardShow('MATTERBORN', 'Become what the world needs');
    this.audio.play('titleBoom');
    this.audio.say('vo_title');
    this.audio.setMood('wonder', 3);
    await d.camTo({ x: p.cx - 4, y: 5.5, z: p.cz + 11 }, { x: p.cx + 2, y: 1.8, z: p.cz - 3 }, 42, 3.5, ease.inOut);
    await d.wait(1.2);
    this.ui.titleCardShow(null);
    this.endCinematic();
    this.audio.setMood('calm', 6);
  }

  /** First camera position in `options` that sees `look` without rock in the way (cinematics never film from inside a wall). */
  private clearShot(look: THREE.Vector3Like, options: THREE.Vector3Like[]) {
    for (const o of options) {
      const inside = this.world.colliders.some(
        (c) => c.enabled && c.kind === 'solid' && c.blocksCamera && o.x > c.x && o.x < c.x + c.w && o.y > c.y && o.y < c.y + c.h && o.z > c.z && o.z < c.z + c.d,
      );
      if (inside) continue;
      const dx = look.x - o.x;
      const dy = look.y - o.y;
      const dz = look.z - o.z;
      const d = Math.hypot(dx, dy, dz);
      if (!this.world.raycast(o.x, o.y, o.z, dx / d, dy / d, dz / d, d - 0.8, 'camera')) return o;
    }
    return options[0];
  }

  /**
   * The restoration moment: a ring of light rides the front of the colour wave across the floor,
   * sparks rise along it, and the image swells with saturation and bloom.
   */
  private async restoreBurst(origin: THREE.Vector3, cat: Exclude<FadeCategory, 'none'>, color: number) {
    const u = fadeUniforms(cat);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 160), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(origin.x, origin.y - 0.95, origin.z);
    ring.renderOrder = 22;
    this.scene.add(ring);
    this.fxBoost = 1;
    const c2 = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5).getHex();
    await this.director.tween(3.2, (k) => {
      const r = Math.max(0.5, u.uRadius.value);
      ring.scale.setScalar(r);
      ringMat.opacity = 0.9 * (1 - k) * THREE.MathUtils.smoothstep(r, 0.3, 2);
      this.fxBoost = 1 - THREE.MathUtils.smoothstep(k, 0.25, 1);
      if (r < 45) {
        const n = Math.round(10 + r * 0.6);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = r + (Math.random() - 0.5) * 0.6;
          this.fx.glow.emit({ x: origin.x + Math.cos(a) * rr, y: origin.y - 0.8 + Math.random() * 0.3, z: origin.z + Math.sin(a) * rr, count: 1, vy: 1.2 + Math.random() * 2.2, speed: 0.4, color, color2: c2, life: 0.9, size: 0.12, drag: 1.2 });
        }
      }
    });
    this.fxBoost = 0;
    this.scene.remove(ring);
    ring.geometry.dispose();
    ringMat.dispose();
  }

  private async altarScene(altar: Altar) {
    const d = this.director;
    const p = this.player;
    const form = altar.form;
    this.beginCinematic();
    // walk up to the altar
    const tx = altar.x - 1.1;
    const tz = altar.z + 0.6;
    const walk = d.tween(1.0, () => {
      const dx = tx - p.cx;
      const dz = tz - p.cz;
      const l = Math.hypot(dx, dz);
      p.scriptMove = l > 0.15 ? { x: (dx / l) * 0.5, z: (dz / l) * 0.5 } : { x: 0, z: 0 };
    });
    const closeLook = { x: altar.x - 0.5, y: altar.y + 1.2, z: altar.z };
    const close = this.clearShot(closeLook, [
      { x: altar.x - 3.2, y: altar.y + 2.4, z: altar.z + 4.2 },
      { x: altar.x - 4.2, y: altar.y + 2.6, z: altar.z + 1.6 },
      { x: altar.x - 3.6, y: altar.y + 3.2, z: altar.z - 2.6 },
    ]);
    await d.camTo(close, closeLook, 34, 1.2, ease.inOut);
    await walk;
    p.scriptMove = { x: 0, z: 0 };
    p.faceTowards(altar.x, altar.z);
    this.hero.forceAnim('cast');
    this.audio.play('awaken', { volume: 0.6 });
    this.audio.play('absorb', { volume: 0.9 });
    const orbPos = altar.orbWorldPosition();
    const heart = new THREE.Vector3();
    altar.consume();
    await d.tween(
      1.4,
      (k) => {
        this.hero.heartPosition(heart);
        this.fx.glow.emit({
          x: orbPos.x + (heart.x - orbPos.x) * k,
          y: orbPos.y + (heart.y - orbPos.y) * k + Math.sin(k * Math.PI) * 0.8,
          z: orbPos.z + (heart.z - orbPos.z) * k,
          count: 4,
          speed: 0.8,
          color: FORMS[form].emissive,
          color2: 0xffffff,
          life: 0.7,
          size: 0.18,
        });
      },
      ease.inOut,
    );
    p.unlock(form);
    p.setForm(form);
    this.rig.shake(0.35);
    this.ui.fade(0.55, 0.05, '#fff6e8');
    await d.wait(0.08);
    this.ui.fade(0, 0.9, '#fff6e8');
    const cats: Record<Form, FadeCategory[]> = { clay: [], stone: ['stone'], wood: ['wood', 'life'], glass: ['glass'] };
    const origin = new THREE.Vector3(altar.x, altar.y + 1, altar.z);
    for (const c of cats[form]) if (c !== 'none') void restore(c, origin, 5, 160);
    if (cats[form].length) void this.restoreBurst(origin, cats[form][0] as Exclude<FadeCategory, 'none'>, FORMS[form].emissive);
    this.audio.play('restore');
    this.audio.play('sting');
    this.audio.setMood('wonder', 1.5);
    const wideLook = { x: altar.x + 2, y: altar.y + 1.4, z: altar.z - 3 };
    const wide = this.clearShot(wideLook, [
      { x: altar.x - 7, y: altar.y + 6, z: altar.z + 11 },
      { x: altar.x - 10, y: altar.y + 4.5, z: altar.z + 2.5 },
      { x: altar.x + 7, y: altar.y + 5, z: altar.z + 3 },
      { x: altar.x - 2, y: altar.y + 9, z: altar.z + 6 },
    ]);
    const lines: Partial<Record<Form, string>> = {
      stone: 'The stones of the workshop remember their weight.',
      wood: 'Roots stir. Everything that once grew remembers how.',
      glass: 'And light remembers its way through the world.',
    };
    if (lines[form]) {
      this.ui.story(lines[form]!);
      this.audio.say(`vo_altar_${form}`, 'interrupt');
    }
    await d.camTo(wide, wideLook, 46, 2.6, ease.inOut);
    this.ui.story(null);
    if (lines[form]) await d.wait(0.7);
    this.ui.titleCardShow(FORMS[form].label.toUpperCase(), FORMS[form].blurb);
    this.audio.say(`vo_form_${form}`);
    this.audio.play('loamYay', { volume: 0.8 });
    await d.wait(2.6);
    this.ui.titleCardShow(null);
    this.endCinematic();
    const key = { clay: 1, stone: 2, wood: 3, glass: 4 }[form];
    this.ui.toast(`Press ${key} to become ${FORMS[form].label}, 1 for Clay, or Q to cycle forms.`, 4.5);
    this.audio.setMood('calm', 6);
  }

  private async colossusScene() {
    const d = this.director;
    const p = this.player;
    this.beginCinematic();
    this.audio.setMood('silent', 1);
    this.audio.play('rumble');
    this.rig.shake(0.5);
    const col = this.colossus;
    const base = this.hooks.colossusAnchor;
    col.root.position.set(p.cx + 22, -30, base.z);
    col.root.rotation.y = 0.15;
    await d.camTo({ x: p.cx - 6, y: p.body.y + 3, z: p.cz + 9 }, { x: p.cx + 16, y: p.body.y + 8, z: base.z }, 50, 1.6, ease.inOut);
    for (let i = 0; i < 25; i++) this.fx.rocks.burst(p.cx + 4 + Math.random() * 24, p.body.y + 12, 1, 0.4, 2, 0x8a8178, p.body.y, 6, p.cz + (Math.random() - 0.5) * 6);
    await d.tween(
      3.2,
      (k) => {
        col.root.position.y = -30 + 30 * k;
        if (Math.random() < 0.3) this.rig.shake(0.08);
      },
      ease.out,
    );
    this.audio.play('roar');
    this.ui.story('The workshop’s guardian wakes, and it does not know Loam.');
    this.audio.say('vo_colossus', 'interrupt');
    await d.tween(1.2, (k) => (col.eye = k), ease.in);
    this.rig.shake(0.6);
    col.slam();
    await d.wait(0.95);
    this.audio.play('slam');
    this.rig.shake(1);
    this.hitstop = 0.1;
    this.ui.story(null);
    this.ui.titleCardShow('RUN', '');
    this.audio.say('vo_run', 'interrupt');
    this.audio.play('titleBoom', { volume: 0.8 });
    this.audio.setMood('tense', 0.5);
    await d.camTo({ x: p.cx - 2, y: p.body.y + 4.5, z: p.cz + 12 }, { x: p.cx + 4, y: p.body.y + 1.2, z: p.cz }, 44, 1.0, ease.inOut);
    this.ui.titleCardShow(null);
    this.endCinematic();
    this.escape.active = true;
    this.escape.front = p.cx - 14;
    this.escape.slamTimer = 2.5;
  }

  private updateEscape(dt: number) {
    const p = this.player;
    const e = this.escape;
    const gap = p.cx - e.front;
    this.danger += (THREE.MathUtils.clamp((8 - gap) / 5, 0, 1) - this.danger) * (1 - Math.exp(-dt * 4));
    const speed = THREE.MathUtils.clamp(3.2 + (gap - 7) * 0.55, 1.6, 9);
    if (!p.dead && !this.director.running) e.front += speed * dt;
    if (Math.random() < dt * 30) this.fx.rocks.burst(e.front + Math.random() * 2, p.body.y + 8 + Math.random() * 4, 1, 0.35 + Math.random() * 0.4, 2, 0x8a8178, p.body.y - 1, 6, (Math.random() - 0.5) * 6);
    if (Math.random() < dt * 20) this.fx.soft.emit({ x: e.front, y: p.body.y + Math.random() * 6, z: (Math.random() - 0.5) * 6, count: 3, spreadX: 2, spreadZ: 3, speed: 2, color: 0xa8968a, life: 1.6, size: 1.6, alpha: 0.45, grow: 2 });
    this.escapeLight.position.set(e.front, p.body.y + 4, 2);
    this.escapeLight.intensity = 60;
    if (!this.dustWall) {
      this.dustWall = new DustWall();
      this.scene.add(this.dustWall.group);
    }
    this.dustWall.group.visible = true;
    this.dustWall.update(this.time, e.front, p.body.y);
    this.colossus.root.position.x += (e.front + 16 - this.colossus.root.position.x) * (1 - Math.exp(-dt * 0.8));
    this.escapeStepT -= dt;
    if (this.escapeStepT <= 0 && !this.director.running) {
      this.escapeStepT = 1.5 + Math.random() * 0.4;
      this.audio.play('colossusStep', { volume: 0.55, pan: this.panFor(this.colossus.root.position.x, 0) });
      if (Math.random() < 0.12) this.audio.play('roar', { volume: 0.55 });
    }
    this.escapeVoiceT -= dt;
    if (this.danger > 0.6 && this.escapeVoiceT <= 0 && !p.dead) {
      this.escapeVoiceT = 16;
      this.audio.say(Math.random() < 0.5 ? 'vo_esc_1' : 'vo_esc_2', 'drop');
    }
    e.slamTimer -= dt;
    if (e.slamTimer <= 0) {
      e.slamTimer = 4 + Math.random() * 2;
      this.colossus.slam();
      e.slamFxAt = this.time + 0.95; // the fist lands about a second after the swing starts
    }
    if (e.slamFxAt && this.time >= e.slamFxAt) {
      e.slamFxAt = 0;
      this.audio.play('slam', { volume: 0.7 });
      this.rig.shake(0.6);
      for (let i = 0; i < 6; i++) this.fx.rocks.burst(p.cx + (Math.random() - 0.3) * 12, p.body.y + 12, 1, 0.5, 3, 0x8a8178, p.body.y, 6, (Math.random() - 0.5) * 6);
    }
    this.rig.shake(dt * 0.4);
    if (!p.dead && p.body.x < e.front) this.kill(p, 'fall');
  }

  private async finaleScene() {
    const d = this.director;
    const p = this.player;
    this.escape.active = false;
    this.escape.done = true;
    this.danger = 0;
    this.escapeLight.intensity = 0;
    if (this.dustWall) this.dustWall.group.visible = false;
    p.control = false;
    this.ui.hint(null);
    p.scriptMove = { x: 1, z: 0 };
    p.scriptJump = true;
    this.director.syncFromCamera();
    this.rig.setCinematic(true);
    this.ui.letterbox(true);
    this.renderer.setDof(true, this.rig.cinLook);
    this.timeScale = 0.35;
    await d.camTo({ x: p.cx - 3.2, y: p.body.y + 2.3, z: p.cz + 6.4 }, { x: p.cx + 1.6, y: p.body.y + 1.5, z: p.cz }, 44, 0.6, ease.out);
    await d.wait(0.45);
    p.frozen = true;
    this.ui.fade(1, 1.2, '#fff4e0');
    this.audio.setMood('silent', 1.5);
    await d.wait(0.5);
    this.timeScale = 1;
    this.state = 'ending';
    p.scriptMove = { x: 0, z: 0 };
    const v = this.hooks.valleySpot;
    p.teleport(v.x, v.y + 0.05, v.z);
    p.frozen = false;
    // at rest in the valley Loam is clay again (also keeps the depth-tested close-ups sharp)
    p.setForm('clay', true);
    this.hero.setForm('clay');
    p.heading = -Math.PI * 0.75;
    this.mood.snap();
    this.colossus.root.position.set(p.cx + 10, 0, p.cz - 40);
    this.colossus.root.rotation.y = 0.4;
    this.colossus.eye = 0.4;
    this.rig.cinPos.set(p.cx + 3, 1.8, p.cz + 6);
    this.rig.cinLook.set(p.cx, 1.2, p.cz - 8);
    this.rig.cinFov = 44;
    await d.wait(1.5);
    this.ui.fade(0, 2.5, '#fff4e0');
    this.audio.setMood('triumph', 2);
    this.hero.forceAnim('idle');
    await d.camTo({ x: p.cx + 6, y: 3.5, z: p.cz + 12 }, { x: p.cx - 2, y: 4, z: p.cz - 30 }, 48, 4, ease.inOut);
    for (const c of ['stone', 'wood', 'glass', 'life'] as const) void restore(c, new THREE.Vector3(p.cx, p.body.y + 1, p.cz), 7, 300);
    this.ui.story('Everything Loam touched remembered what it was made of.');
    this.audio.say('vo_finale_1', 'interrupt');
    await d.camTo({ x: p.cx + 11, y: 6, z: p.cz + 12 }, { x: p.cx - 6, y: 6, z: p.cz - 40 }, 50, 6, ease.sine);
    this.ui.story('And the valley of the Makers began to bloom again.');
    this.audio.say('vo_finale_2');
    this.hero.forceAnim('sit');
    await d.camTo({ x: p.cx + 2.6, y: 1.8, z: p.cz + 3.4 }, { x: p.cx, y: 0.8, z: p.cz }, 36, 4, ease.inOut);
    this.ui.story(null);
    this.ui.titleCardShow('MATTERBORN', 'Thank you for playing');
    this.audio.say('vo_thanks');
    await d.wait(4);
    this.ui.titleCardShow(null);
    this.ui.credits(true);
  }
}
