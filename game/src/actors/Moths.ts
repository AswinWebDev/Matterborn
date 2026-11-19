// Lantern moths: Lux3D text-to-3D creature with its Lux3D articulation (the model split into body
// and two wings on real hinge joints), circling the lanterns and flapping on those hinges. They
// belong to the "life" category, so they stay faded clay until the wood altar restores living
// things. Without the generated model there are simply no moths.

import * as THREE from 'three';
import { loadModel, loadGLTF, instantiate, BASE, getManifest } from '../core/Assets';
import { applyFadeDeep } from '../render/MaterialFX';
import { loadArticulated, jointsIn, fitToHeight, setJoint, ArticulatedJoint } from '../core/Articulated';

interface Moth {
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  wings: ArticulatedJoint[];
  center: THREE.Vector3;
  r: number;
  speed: number;
  phase: number;
  flap: number;
}

const SIZE = 0.34;

export class Moths {
  readonly group = new THREE.Group();
  private moths: Moth[] = [];
  private t = 0;

  async load(spots: THREE.Vector3[], perSpot = 2) {
    const anim = getManifest().anims?.moth_flap;
    // 1) Lux3D articulation (URDF descriptor): wings on hinges we can drive
    let make: (() => { obj: THREE.Object3D; wings: ArticulatedJoint[]; mixer: THREE.AnimationMixer | null }) | null = null;
    if (anim?.endsWith('.json')) {
      const art = await loadArticulated(anim);
      if (art) {
        make = () => {
          const root = art.root.clone(true);
          const wings = jointsIn(root, art.joints);
          const { holder } = fitToHeight(root, SIZE);
          return { obj: holder, wings, mixer: null };
        };
      }
    }
    // 2) a GLB with a baked clip, 3) the static model
    if (!make) {
      const src = (anim?.endsWith('.glb') ? await loadGLTF(BASE + anim) : null) ?? (await loadModel('cr_moth'));
      if (!src) return;
      make = () => {
        const obj = instantiate(src, SIZE, { castShadow: false, receiveShadow: false });
        let mixer: THREE.AnimationMixer | null = null;
        if (src.animations.length) {
          mixer = new THREE.AnimationMixer(obj.children[0]);
          const a = mixer.clipAction(src.animations[0]);
          a.setLoop(THREE.LoopRepeat, Infinity);
          a.play();
        }
        return { obj, wings: [], mixer };
      };
    }
    let i = 0;
    for (const c of spots)
      for (let k = 0; k < perSpot; k++, i++) {
        const { obj, wings, mixer } = make();
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = m.receiveShadow = false;
        });
        applyFadeDeep(obj, 'life');
        this.moths.push({
          obj,
          mixer,
          wings,
          center: c.clone(),
          r: 0.8 + ((i * 0.53) % 1) * 1.1,
          speed: (0.7 + ((i * 0.71) % 1) * 0.6) * (k % 2 ? -1 : 1),
          phase: i * 2.1,
          flap: 9 + ((i * 0.37) % 1) * 5,
        });
        this.group.add(obj);
      }
  }

  update(dt: number) {
    this.t += dt;
    for (const m of this.moths) {
      const a = m.phase + this.t * m.speed;
      const bob = Math.sin(this.t * 2.3 + m.phase) * 0.25;
      m.obj.position.set(m.center.x + Math.cos(a) * m.r, m.center.y + bob, m.center.z + Math.sin(a) * m.r);
      // face along the circle (tangent), with a slight bank into the turn
      m.obj.rotation.set(0, -a + (m.speed > 0 ? 0 : Math.PI), Math.sign(m.speed) * 0.25);
      m.mixer?.update(dt);
      if (m.wings.length) {
        // wing beat on the Lux3D hinges: quick downstroke, slower recovery, inside the joint limits
        const s = Math.sin(this.t * m.flap + m.phase);
        const beat = s > 0 ? s : s * 0.6;
        for (const w of m.wings) setJoint(w, THREE.MathUtils.clamp(beat * 0.5, w.lower, w.upper));
      }
    }
  }
}
