// Lux3D articulation results arrive as a URDF package: the model split into part GLBs ("links")
// plus revolute joints (pivot position, rotation axis, limits). process.mjs turns that into a
// small JSON descriptor; this assembles it into a three.js hierarchy whose joints can be driven.

import * as THREE from 'three';
import { loadGLTF, BASE } from './Assets';

interface JointDesc {
  name: string;
  type: string;
  parent: string;
  child: string;
  xyz: number[];
  rpy: number[];
  axis: number[];
  lower: number;
  upper: number;
}
interface Descriptor {
  type: 'urdf';
  root: string;
  links: Record<string, string>;
  joints: JointDesc[];
}

export interface ArticulatedJoint {
  name: string;
  child: string;
  pivot: THREE.Object3D;
  axis: THREE.Vector3;
  lower: number;
  upper: number;
  /** Joint origin in the parent link's frame (unscaled model units). */
  origin: THREE.Vector3;
}
export interface Articulated {
  root: THREE.Group;
  joints: ArticulatedJoint[];
}

export async function loadArticulated(file: string): Promise<Articulated | null> {
  let desc: Descriptor;
  try {
    const res = await fetch(BASE + file);
    if (!res.ok) return null;
    desc = await res.json();
  } catch {
    return null;
  }
  if (desc?.type !== 'urdf' || !desc.links?.[desc.root]) return null;
  const scenes = new Map<string, THREE.Object3D>();
  await Promise.all(
    Object.entries(desc.links).map(async ([name, f]) => {
      const g = await loadGLTF(BASE + f);
      if (g) scenes.set(name, g.scene.clone(true));
    }),
  );
  if (!scenes.has(desc.root)) return null;
  const links = new Map<string, THREE.Group>();
  const link = (name: string) => {
    const g = new THREE.Group();
    g.name = `link:${name}`;
    const sc = scenes.get(name);
    if (sc) g.add(sc);
    links.set(name, g);
    return g;
  };
  const root = new THREE.Group();
  root.add(link(desc.root));
  const joints: ArticulatedJoint[] = [];
  let pending = [...desc.joints];
  for (let guard = 0; pending.length && guard < 64; guard++) {
    pending = pending.filter((j) => {
      const parent = links.get(j.parent);
      if (!parent) return true;
      // URDF: the joint frame sits at xyz in the parent frame, rotated by fixed-axis roll/pitch/yaw
      const frame = new THREE.Group();
      frame.name = `frame:${j.name}`;
      frame.position.fromArray(j.xyz);
      frame.rotation.set(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX');
      const pivot = new THREE.Group();
      pivot.name = `joint:${j.name}`;
      frame.add(pivot);
      pivot.add(link(j.child));
      parent.add(frame);
      joints.push({ name: j.name, child: j.child, pivot, axis: new THREE.Vector3().fromArray(j.axis).normalize(), lower: j.lower, upper: j.upper, origin: new THREE.Vector3().fromArray(j.xyz) });
      return false;
    });
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  return { root, joints };
}

/** Rotate a revolute joint to `angle` radians about its axis. */
export function setJoint(j: ArticulatedJoint, angle: number) {
  j.pivot.quaternion.setFromAxisAngle(j.axis, angle);
}

/** The same joints inside a clone of an assembled model (pivots are named "joint:<name>"). */
export function jointsIn(root: THREE.Object3D, joints: ArticulatedJoint[]): ArticulatedJoint[] {
  return joints.map((j) => ({ ...j, pivot: root.getObjectByName(`joint:${j.name}`) as THREE.Object3D })).filter((j) => j.pivot);
}

/** Wrap an object so it stands on y = 0, centred in x/z, scaled to `height`; returns the wrapper and scale. */
export function fitToHeight(obj: THREE.Object3D, height: number) {
  const holder = new THREE.Group();
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const s = height / Math.max(box.max.y - box.min.y, 1e-6);
  obj.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b2.min.y;
  holder.updateMatrixWorld(true);
  return { holder, scale: s };
}
