// The clay colossus that wakes for the escape sequence. Uses the Lux3D model (with its
// articulation animation) when available, otherwise a primitive stand-in with the same beats.

import * as THREE from 'three';
import { loadModel, instantiate, loadGLTF, BASE, getManifest } from '../core/Assets';
import { applyFadeDeep } from '../render/MaterialFX';
import { loadArticulated, setJoint, fitToHeight, ArticulatedJoint } from '../core/Articulated';
import { VLight } from '../render/LightPool';

export class Colossus {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private armR = new THREE.Group();
  private eyeMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xffa040, emissiveIntensity: 0 });
  private eyeLight = new VLight(0xffa040, 0, 40, 2);
  private mixer: THREE.AnimationMixer | null = null;
  private slamAction: THREE.AnimationAction | null = null;
  private slamT = -1;
  private clockT = 0;
  eye = 0;
  awake = false;

  constructor() {
    const clay = new THREE.MeshStandardMaterial({ color: 0x9c7a62, roughness: 0.95 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(9, 11, 6, 3, 3, 3), clay);
    torso.position.y = 11;
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 1), clay);
    head.position.y = 19;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), this.eyeMat);
    eye.position.set(0, 19.4, 2.8);
    this.eyeLight.position.set(0, 19.4, 6);
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 12, 8), clay);
    armL.position.set(-6.5, 10, 0);
    armL.rotation.z = 0.15;
    const armRMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 12, 8), clay);
    armRMesh.position.y = -6;
    this.armR.position.set(6.5, 16, 0);
    this.armR.add(armRMesh);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 5), clay);
    legs.position.y = 3;
    this.body.add(torso, head, eye, armL, this.armR, legs);
    this.body.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.root.add(this.body, this.eyeLight);
    applyFadeDeep(this.body, 'stone');
  }

  /** Swap in the Lux3D model (and its articulation). Call after the asset manifest has loaded. */
  async loadAssets() {
    const anim = getManifest().anims?.colossus_slam;
    let model: THREE.Object3D | null = null;
    let scale = 1;
    // 1) Lux3D articulation (URDF): the colossus split into body, head and arm on real pivots
    if (anim?.endsWith('.json')) {
      const art = await loadArticulated(anim);
      if (art) {
        const fit = fitToHeight(art.root, 24);
        model = fit.holder;
        scale = fit.scale;
        this.armJoint = art.joints.find((j) => /arm/i.test(j.name) || /arm/i.test(j.child)) ?? art.joints[0] ?? null;
        this.headJoint = art.joints.find((j) => /head/i.test(j.name) || /head/i.test(j.child)) ?? null;
      }
    }
    // 2) an articulation GLB with a baked clip, 3) the static Lux3D model
    if (!model && anim?.endsWith('.glb')) {
      const ag = await loadGLTF(BASE + anim);
      if (ag && ag.animations.length) {
        model = instantiate(ag, 24);
        this.mixer = new THREE.AnimationMixer(model.children[0]);
        this.slamAction = this.mixer.clipAction(ag.animations[0]);
        this.slamAction.setLoop(THREE.LoopOnce, 1);
        this.slamAction.clampWhenFinished = true;
      }
    }
    if (!model) {
      const g = await loadModel('cr_colossus');
      if (!g) return;
      model = instantiate(g, 24);
    }
    applyFadeDeep(model, 'stone');
    // put the glowing eye on the actual face: the most forward surface point of the head
    // (measured before parenting, so the ray works in the model's own space)
    model.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    let best: THREE.Vector3 | null = null;
    for (const k of [0.92, 0.88, 0.84, 0.8, 0.76, 0.72]) {
      ray.set(new THREE.Vector3(0, 24 * k, 60), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(model, true)[0];
      if (hit && (!best || hit.point.z > best.z)) best = hit.point.clone();
    }
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const eyePos = best ? best.add(new THREE.Vector3(0, 0, 0.25)) : new THREE.Vector3(0, 24 * 0.85, size.z * 0.45);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), this.eyeMat);
    this.eyeLight.position.copy(eyePos).add(new THREE.Vector3(0, 0, 3));
    if (this.headJoint) {
      // ride on the head so the eye follows its tilt (undo the model's scale on the sphere)
      const local = this.headJoint.pivot.worldToLocal(eyePos.clone());
      eye.position.copy(local);
      eye.scale.setScalar(1 / scale);
      this.headJoint.pivot.add(eye);
    } else {
      eye.position.copy(eyePos);
      this.root.add(eye);
    }
    this.root.remove(this.body);
    this.model = model;
    this.root.add(model);
  }
  private armJoint: ArticulatedJoint | null = null;
  private headJoint: ArticulatedJoint | null = null;
  private model: THREE.Object3D | null = null;

  slam() {
    this.slamT = 0;
    if (this.slamAction) {
      this.slamAction.reset();
      this.slamAction.play();
    }
  }

  update(dt: number) {
    this.mixer?.update(dt);
    this.clockT += dt;
    this.eyeMat.emissiveIntensity = this.eye * (6 + Math.sin(this.clockT * 8) * 1.5);
    this.eyeLight.intensity = this.eye * 120;
    if (this.slamT >= 0) {
      this.slamT += dt;
      const t = this.slamT;
      // raise (0..0.9s), slam (0.9..1.1s), recover
      const a = t < 0.9 ? -THREE.MathUtils.smoothstep(t, 0, 0.9) * 2.4 : t < 1.1 ? -2.4 + ((t - 0.9) / 0.2) * 3.0 : 0.6 - Math.min(1, (t - 1.1) / 1.5) * 0.6;
      this.armR.rotation.x = a;
      if (this.armJoint) {
        // Lux3D's own shoulder joint: raise the arm high, slam it down, settle
        setJoint(this.armJoint, a);
        if (this.headJoint) setJoint(this.headJoint, THREE.MathUtils.clamp(-a * 0.16, -0.2, 0.42));
      } else if (this.model && !this.slamAction) this.model.rotation.x = -a * 0.07; // static model: rear back and lunge
      if (t > 2.6) this.slamT = -1;
    }
  }
}
