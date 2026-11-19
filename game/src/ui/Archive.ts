// The Maker's Archive: an in-game gallery of every Aholo-generated model, reachable from the
// title screen. Each model stands on a pedestal in a quiet studio built far below the level (so
// the full lighting pipeline applies), turning slowly, with the Aholo operation that made it,
// its prompt and its numbers. The rigged hero performs its retargeted animations, the colossus
// swings its articulated shoulder and the moth flaps its hinged wings.

import * as THREE from 'three';
import { getManifest, loadModel, loadGLTF, instantiate, BASE } from '../core/Assets';
import { loadArticulated, fitToHeight, setJoint, ArticulatedJoint } from '../core/Articulated';
import { VLight } from '../render/LightPool';
import { makeSoftDot } from '../render/noise';

export const ARCHIVE_ORIGIN = new THREE.Vector3(0, -400, 0);

const NAMES: Record<string, string> = {
  hero_rig: 'Loam, rigged',
  hero_model: 'Loam',
  hero_stone: 'Loam · Stone form',
  hero_wood: 'Loam · Wood form',
  obj_block: 'Puzzle block',
  obj_block_wood: 'Puzzle block · wood',
  obj_crack_slab: 'Cracked slab',
  obj_crack_slab_parts: 'Cracked slab · parts',
  env_kiln: 'Kiln',
  env_workbench: 'Workbench',
  env_pillar: 'Broken pillar',
  env_arch: 'Ruined arch',
  env_crate: 'Crate',
  env_emitter: 'Light crystal',
  env_lantern: 'Lantern',
  env_tree: 'Ancient tree',
  env_rocks: 'Mossy rocks',
  env_mushrooms: 'Glow mushrooms',
  env_gear: 'Bronze gear',
  env_statue: 'Hooded sculptor',
  env_wall: 'Ruined wall',
  env_scaffold: 'Scaffold',
  cr_colossus: 'The colossus',
  cr_moth: 'Lantern moth',
};

const KIND: Record<string, string> = {
  text3d: 'Lux3D text → 3D',
  img3d: 'Lux3D image → 3D (from a Lux3D concept image)',
  material: 'Lux3D material transfer',
  split: 'Lux3D part split',
  rig: 'Lux3D humanoid auto-rig + 30 retargeted animations',
};

const ORDER = ['hero_rig', 'hero_stone', 'hero_wood', 'cr_colossus', 'cr_moth', 'obj_block', 'obj_block_wood', 'obj_crack_slab', 'obj_crack_slab_parts', 'env_kiln', 'env_statue', 'env_workbench', 'env_tree', 'env_mushrooms', 'env_emitter', 'env_lantern', 'env_gear', 'env_arch', 'env_wall', 'env_pillar', 'env_crate', 'env_rocks', 'env_scaffold'];
const HERO_CLIPS = ['Idle_Loop', 'Jog_Fwd_Loop', 'NinjaJump_Start', 'Spell_Simple_Idle_Loop', 'Push_Loop', 'Swim_Fwd_Loop', 'Dance_Loop', 'Yes', 'Sitting_Idle_Loop'];

export class Archive {
  readonly group = new THREE.Group();
  index = 0;
  private ids: string[] = [];
  private holder = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationAction[] = [];
  private clipAt = 0;
  private clipIndex = 0;
  private clipNames: string[] = [];
  private joints: ArticulatedJoint[] = [];
  private jointKind: 'colossus' | 'moth' | null = null;
  private t = 0;
  private token = 0;
  private panel: HTMLElement;
  height = 2;
  /** Camera framing size: the larger of height and footprint. */
  frame = 2;

  constructor(scene: THREE.Scene) {
    this.group.position.copy(ARCHIVE_ORIGIN);
    // a dark stone plinth on a soft glowing ring, with a warm key and a cool rim light
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x15171f, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 0.36, 64), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6, metalness: 0.1 }));
    plinth.position.y = 0.18;
    plinth.receiveShadow = plinth.castShadow = true;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.86, 1.95, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(2.5), side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.37;
    const key = new VLight(0xffe2c0, 30, 14, 2);
    key.position.set(2.5, 5, 3.5);
    key.priority = 4;
    const rim = new VLight(0x8fc8ff, 26, 14, 2);
    rim.position.set(-3, 4, -3.2);
    rim.priority = 4;
    const fill = new VLight(0xffb070, 8, 9, 2);
    fill.position.set(0, 1.2, 3.2);
    fill.priority = 4;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSoftDot(64), color: 0x3a3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(9, 5, 1);
    glow.position.set(0, 2, -6);
    this.holder.position.y = 0.36;
    this.group.add(floor, plinth, ring, key, rim, fill, glow, this.holder);
    this.group.visible = false;
    scene.add(this.group);
    this.panel = document.createElement('div');
    this.panel.id = 'archive';
    this.panel.className = 'hidden';
    document.body.appendChild(this.panel);
  }

  open() {
    const models = getManifest().models;
    this.ids = ORDER.filter((id) => models[id]);
    for (const id of Object.keys(models)) if (!this.ids.includes(id) && id !== 'hero_model') this.ids.push(id);
    this.group.visible = true;
    this.panel.classList.remove('hidden');
    void this.show(this.index);
  }

  close() {
    this.group.visible = false;
    this.panel.classList.add('hidden');
  }

  /** Position of a model in the browse order (after open()). */
  indexOf(id: string) {
    return this.ids.indexOf(id);
  }

  next(d: number) {
    if (!this.ids.length) return;
    this.index = (this.index + d + this.ids.length) % this.ids.length;
    void this.show(this.index);
  }

  private async show(i: number) {
    const id = this.ids[i];
    const token = ++this.token;
    this.renderPanel(id);
    let obj: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const clips: THREE.AnimationAction[] = [];
    let joints: ArticulatedJoint[] = [];
    let jointKind: 'colossus' | 'moth' | null = null;
    const anims = getManifest().anims ?? {};
    const height = id.startsWith('hero') ? 1.9 : id === 'cr_colossus' ? 2.8 : id === 'cr_moth' ? 1.1 : id.startsWith('obj_') ? 1.5 : 2.6;
    if (id === 'cr_colossus' && anims.colossus_slam?.endsWith('.json')) {
      const art = await loadArticulated(anims.colossus_slam);
      if (art) {
        obj = fitToHeight(art.root, height).holder;
        joints = art.joints;
        jointKind = 'colossus';
      }
    } else if (id === 'cr_moth' && anims.moth_flap?.endsWith('.json')) {
      const art = await loadArticulated(anims.moth_flap);
      if (art) {
        obj = fitToHeight(art.root, height).holder;
        joints = art.joints;
        jointKind = 'moth';
      }
    }
    if (!obj) {
      const g = await loadModel(id);
      if (!g) return;
      obj = instantiate(g, height);
      if (id === 'hero_rig') {
        const skinned = obj.children[0];
        mixer = new THREE.AnimationMixer(skinned);
        for (const name of HERO_CLIPS) {
          const file = anims[name];
          if (!file) continue;
          const cg = await loadGLTF(BASE + file);
          const clip = cg?.animations?.[0];
          if (clip) clips.push(mixer.clipAction(clip));
        }
        if (clips.length) clips[0].play();
        this.clipNames = HERO_CLIPS.filter((n) => anims[n]);
      }
    }
    if (token !== this.token) return; // the player moved on while this loaded
    if (this.current) this.holder.remove(this.current);
    this.current = obj;
    this.mixer = mixer;
    this.clips = clips;
    this.clipIndex = 0;
    this.clipAt = 0;
    this.joints = joints;
    this.jointKind = jointKind;
    const sz = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    this.height = sz.y;
    this.frame = Math.max(sz.y, Math.max(sz.x, sz.z) * 0.85);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
    this.holder.add(obj);
  }

  private renderPanel(id: string) {
    const m = getManifest().models[id] as Record<string, unknown> | undefined;
    const kind = String(m?.kind ?? '');
    const lines: string[] = [];
    let op = KIND[kind] ?? 'Lux3D';
    if (id === 'cr_colossus') op = 'Lux3D text → 3D · articulation (URDF shoulder + neck joints)';
    if (id === 'cr_moth') op = 'Lux3D text → 3D · articulation (hinged wings)';
    if (kind === 'material' && m?.from) op += ` of ${NAMES[String(m.from)] ?? m.from}`;
    if (kind === 'split' && m?.from) op += ` of the ${String(NAMES[String(m.from)] ?? m.from).toLowerCase()}`;
    const facts: string[] = [];
    if (m?.tris) facts.push(`${Number(m.tris).toLocaleString('en-US')} triangles`);
    if (m?.version) facts.push(String(m.version));
    if (m?.style) facts.push(String(m.style).replace('_', '-'));
    if (m?.joints) facts.push(`${m.joints} joints`);
    if (typeof m?.seconds === 'number') facts.push(`generated in ${m.seconds} s`);
    if (m?.prompt) lines.push(`<div class="prompt">“${String(m.prompt).replace(/</g, '&lt;')}”</div>`);
    this.panel.innerHTML = `
      <div class="atitle">The Maker's Archive</div>
      <div class="aname">${NAMES[id] ?? id}</div>
      <div class="aop">${op}</div>
      ${lines.join('')}
      <div class="afacts">${facts.join(' · ')}</div>
      ${id === 'hero_rig' ? '<div class="aclip"></div>' : ''}
      <div class="anav"><b>◀ ▶</b> or <b>A D</b> browse · <b>Esc</b> back · ${this.index + 1} / ${this.ids.length}</div>`;
  }

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    this.holder.rotation.y += dt * 0.35;
    if (this.mixer) {
      this.mixer.update(dt);
      this.clipAt += dt;
      if (this.clips.length > 1 && this.clipAt > 3.2) {
        const prev = this.clips[this.clipIndex];
        this.clipIndex = (this.clipIndex + 1) % this.clips.length;
        const nx = this.clips[this.clipIndex];
        nx.reset().play();
        nx.crossFadeFrom(prev, 0.35, false);
        this.clipAt = 0;
      }
      const label = this.panel.querySelector('.aclip');
      const name = this.clipNames[this.clipIndex];
      if (label && name && label.textContent !== `▶ ${name.replace(/_/g, ' ')}`) label.textContent = `▶ ${name.replace(/_/g, ' ')}`;
    }
    if (this.jointKind === 'colossus') {
      const k = (this.t % 3.2) / 3.2;
      const a = k < 0.45 ? -THREE.MathUtils.smoothstep(k, 0, 0.45) * 2.4 : k < 0.55 ? -2.4 + ((k - 0.45) / 0.1) * 3 : 0.6 - THREE.MathUtils.smoothstep(k, 0.55, 1) * 0.6;
      for (const j of this.joints) {
        if (/arm/i.test(j.name)) setJoint(j, a);
        else if (/head/i.test(j.name)) setJoint(j, THREE.MathUtils.clamp(-a * 0.16, -0.2, 0.42));
      }
    } else if (this.jointKind === 'moth') {
      const s = Math.sin(this.t * 11);
      for (const j of this.joints) setJoint(j, THREE.MathUtils.clamp((s > 0 ? s : s * 0.6) * 0.5, j.lower, j.upper));
    }
  }
}
