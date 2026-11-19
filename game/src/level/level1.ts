// "The Hollow Atelier" in 3D. The route runs roughly along +x through real rooms with depth.
//   A  The Atelier      wake beside the kiln; run, jump and ledge-climb onto the balcony
//   B  Stone court      pound through the cracked balcony floor; in the chamber below, shove the
//                       stone block east and then south into the alcove plate to lift the
//                       portcullis; charge the cracked wall; wall-jump the shaft as Clay
//   C  The aqueduct     clay melts; sink as Stone under the curtain wall; float up as Wood;
//                       cross the fire trough as Clay/Stone; climb to the hall of light
//   D  Hall of light    imprint Glass on the cradled block so the beam reaches the sealed door
//   E  Colossus escape  the hall collapses behind you across a causeway: dash, charge, swim,
//                       and run through the beam as Glass to keep the last gate open
//   F  The valley       ending

import * as THREE from 'three';
import { Level, Gate, Altar, MAT } from './Level';
import { CameraZone } from '../camera/CameraRig';
import { Atmosphere } from '../render/Atmosphere';
import { simplex3 } from '../render/noise';

export interface LevelHooks {
  kiln: THREE.Vector3;
  wakeSpot: { x: number; y: number; z: number };
  altars: Record<string, Altar>;
  colossusAnchor: THREE.Vector3;
  escapeStartX: number;
  escapeEndX: number;
  valleySpot: { x: number; y: number; z: number };
  lightDoor: Gate;
  zones: CameraZone[];
}

// ---------------------------------------------------------------- fallback decoration shapes
const stoneDeco = MAT.stone;
const woodDeco = MAT.wood;
const shadow = (g: THREE.Object3D) => {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  return g;
};
function pillar(h = 6) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, h, 10, 4), stoneDeco);
  shaft.position.y = h / 2;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), stoneDeco);
  cap.position.y = h;
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.7), stoneDeco);
  base.position.y = 0.25;
  g.add(shaft, cap, base);
  return shadow(g);
}
function arch(w = 5, h = 7) {
  const g = new THREE.Group();
  for (const sx of [-w / 2, w / 2]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9), stoneDeco);
    p.position.set(sx, h / 2, 0);
    g.add(p);
  }
  const top = new THREE.Mesh(new THREE.TorusGeometry(w / 2, 0.45, 8, 20, Math.PI), stoneDeco);
  top.position.y = h;
  g.add(top);
  return shadow(g);
}
function kiln() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), stoneDeco);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20), new THREE.MeshStandardMaterial({ color: 0x080404, emissive: 0x3a1004, emissiveIntensity: 1.5 }));
  mouth.position.set(0, 0.9, 2.45);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 10), stoneDeco);
  chimney.position.y = 3.6;
  g.add(dome, mouth, chimney);
  return shadow(g);
}
function crate() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), woodDeco);
  m.position.y = 0.6;
  return shadow(m);
}
function statue() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.5, 8), stoneDeco);
  body.position.y = 2.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), stoneDeco);
  head.position.y = 5;
  g.add(body, head);
  return shadow(g);
}
function tree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 6, 8), new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9 }));
  trunk.position.y = 3;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 1), new THREE.MeshStandardMaterial({ color: 0xc27a2c, roughness: 0.8 }));
  crown.position.y = 6.5;
  crown.scale.y = 0.7;
  g.add(trunk, crown);
  return shadow(g);
}
function mushrooms() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d5f5a, emissive: 0x2fffd8, emissiveIntensity: 1.4 });
  for (let i = 0; i < 4; i++) {
    const s = 0.4 + ((i * 37) % 10) / 20;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s * 2, 0.08 * s * 2, s * 1.2, 6), new THREE.MeshStandardMaterial({ color: 0xd8e8d0 }));
    stem.position.set((i - 1.5) * 0.4, s * 0.6, ((i * 53) % 10) / 25 - 0.2);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(s * 0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.position.set(stem.position.x, s * 1.2, stem.position.z);
    g.add(stem, cap);
  }
  return g;
}
function lantern() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xffa040, emissiveIntensity: 3 }));
  body.position.y = -0.3;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2, 4), MAT.iron);
  chain.position.y = 1;
  g.add(body, chain);
  return g;
}
function gear() {
  const m = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.45, 8, 16), MAT.iron);
  m.position.y = 2.6;
  return shadow(m);
}
function scaffold() {
  const g = new THREE.Group();
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 8, 0.15), woodDeco);
    p.position.set(x, 4, z);
    g.add(p);
  }
  for (let y = 1; y < 8; y += 2.4) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.4), woodDeco);
    deck.position.y = y;
    g.add(deck);
  }
  return shadow(g);
}
function crystal() {
  const g = new THREE.Group();
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.1, 8), MAT.stoneDark);
  ped.position.y = 0.55;
  const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), MAT.crystal);
  c.position.y = 1.5;
  c.scale.y = 1.5;
  g.add(ped, c);
  return shadow(g);
}
function rocks() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + i * 0.25, 0), MAT.stone);
    r.position.set(i * 0.9 - 0.9, 0.4 + i * 0.1, (i % 2) * 0.6 - 0.3);
    g.add(r);
  }
  return shadow(g);
}

// ---------------------------------------------------------------- the valley's rolling land
/** Ground height around the valley meadow (the walkable meadow itself is the flat floor at y = 0). */
export function valleyHeight(x: number, z: number) {
  const dx = Math.max(0, Math.abs(x - 370.5) - 21);
  const back = Math.max(0, -11 - z);
  const front = Math.max(0, z - 11);
  const d = Math.hypot(dx, back);
  let h = -0.3 + THREE.MathUtils.smoothstep(d, 0, 46) * 13;
  h += (simplex3(x * 0.018, 3.1, z * 0.018) * 5 + simplex3(x * 0.06, 7.7, z * 0.06) * 1.4) * THREE.MathUtils.smoothstep(d, 2, 22);
  // gentle far rise only: the Aholo World splat valley provides the distant mountains and towers
  h += THREE.MathUtils.smoothstep(-z, 90, 150) * (6 + simplex3(x * 0.012, 1.0, 0) * 4);
  h -= front * 0.35;
  // a ridge closes the west side, so the valley never reads as an island edge in wide shots
  h += THREE.MathUtils.smoothstep(-x, -344, -324) * 22;
  return h;
}

function valleyLand(L: Level) {
  // x 322..522 only: west of that is the escape causeway, which must stay open air
  const geo = new THREE.PlaneGeometry(200, 250, 100, 125);
  geo.rotateX(-Math.PI / 2);
  geo.translate(422, 0, -80);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = valleyHeight(x, z);
    pos.setY(i, y);
    uv.setXY(i, x * 0.3, z * 0.3);
    const shade = 0.8 + simplex3(x * 0.05, 0, z * 0.05) * 0.15 + THREE.MathUtils.clamp(y * 0.004, 0, 0.15);
    col[i * 3] = shade;
    col[i * 3 + 1] = shade;
    col[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // same rock material as the level (its moss layer greens the hills once life is restored)
  const land = new THREE.Mesh(geo, MAT.rock);
  land.receiveShadow = true;
  land.castShadow = true;
  L.root.add(land);
  return land;
}

/** High windows: a wall with solid lower half and pillars above, so light pours in from the top. */
function windowedWall(L: Level, x0: number, x1: number, z0: number, z1: number, yBase: number, yMid: number, yTop: number, spacing = 9, gap = 4) {
  L.wall(x0, z0, x1, z1, yBase, yMid, { dark: true });
  for (let x = x0; x < x1; x += spacing) {
    L.wall(x, z0, Math.min(x1, x + spacing - gap), z1, yMid, yTop, { dark: true });
  }
  L.rock(x0, yTop, z0, x1, yTop + 2, z1, { dark: true, collide: false });
}

export function buildLevel1(L: Level, atmo: Atmosphere): LevelHooks {
  const zones: CameraZone[] = [];
  const altars: Record<string, Altar> = {};

  // ===================================================================== A: the Atelier
  L.floor(-14, -10, 20, 8, 0, 6, { moss: false });
  windowedWall(L, -16, 72, -12.5, -10, -4, 9, 18, 9, 5.5);
  L.wall(-16, -10, -14, 9, 0, 16, { dark: true });
  L.rock(-14, 0, 8, 20, 0.7, 9, { dark: true }); // low front parapet
  L.invisible(-14, 0.7, 8, 20, 8, 9);
  // the right side of the hall is solid rock; the only way on is up onto the balcony
  L.rock(20, -4, -2, 42, 12, 10, { dark: true });
  L.cap(20, 12, -2, 42, 10); // its top is not a shortcut over the stone court
  L.rock(10, -1, -6, 14, 1.2, -1, { moss: false }); // a step up toward the balcony
  L.rock(14, -4, -10, 30, 4.8, -2); // balcony (west part, solid)

  // the Atelier and its balcony are an interior: sunlight only enters through the high windows
  L.shadowRoof(-18, 20, -16, 42, 22, 36);
  L.shadowRoof(-22, -6, -16, -16, 22, 36); // west side, so the sun's sideways slant cannot leak in
  L.prop('env_kiln', -9, 0, -7, 6.5, { rotY: 0.4, fallback: kiln, solid: 2.2 });
  L.prop('env_workbench', -2.5, 0, -6.8, 1.6, { rotY: 0.1, category: 'wood', fallback: crate, solid: 0.9 });
  L.prop('env_statue', 7, 0, -8.6, 7.5, { rotY: 0.2, fallback: statue, solid: 1.1 });
  L.prop('env_pillar', -12, 0, -8, 10, { fallback: () => pillar(10), solid: 0.8 });
  L.prop('env_pillar', 12, 0, -8.8, 8, { fallback: () => pillar(8), solid: 0.8 }); // behind the play space, never between camera and player
  L.prop('env_crate', 3.5, 0, -7.8, 1.2, { rotY: 0.4, category: 'wood', fallback: crate, solid: 0.55 });
  L.prop('env_crate', 4.8, 0, -7.6, 1.0, { rotY: -0.2, category: 'wood', fallback: crate, solid: 0.45 });
  L.prop('env_scaffold', 16.5, 4.8, -8.5, 8, { category: 'wood', fallback: scaffold, solid: 1.1 });
  L.prop('env_lantern', -4, 7, -3, 1.1, { fallback: lantern });
  L.prop('env_lantern', 9, 7.5, 2, 1.1, { fallback: lantern });
  L.light(-4, 6.2, -3, 0xffa050, 16, 14);
  L.light(9, 6.7, 2, 0xffa050, 14, 14);
  for (const x of [-7.5, 1.5, 10.5]) atmo.addShaft(x, 18, -11, 26, 3.6, 0xffd9a0, 0.16);
  L.checkpoint(6.5, 0, -1.5); // clear of the wake-up close-ups
  L.sigil(0.5, 0, -0.5, 4.2, 0xffa040, 1); // Loam wakes at the heart of the workshop's sigil
  L.hint(-6, 0, -6, 9, 4, 8, 'Move with WASD.  Jump with Space.');
  L.hint(9, 0, -7, 14, 4, 0, 'Jump onto the step, then jump again in mid-air to reach the balcony.');
  zones.push({ x0: -20, x1: 20, y1: 3.5, yaw: -0.38, pitch: 0.58, distance: 13.5, lookAhead: 1.4 });

  // ===================================================================== B: the Stone court
  altars.stone = L.altar(24, 4.8, -6, 'stone');
  L.checkpoint(19, 4.8, -4);
  // thin east part of the balcony with a cracked panel in the middle
  L.rock(30, 3.9, -10, 33, 4.8, -2);
  L.rock(36, 3.9, -10, 40, 4.8, -2);
  L.rock(33, 3.9, -10, 36, 4.8, -8);
  L.rock(33, 3.9, -4, 36, 4.8, -2);
  L.crack(33, 3.9, -8, 36, 4.8, -4, 'floor');
  L.wall(40, -12, 42, -2, 3.9, 14, { dark: true });
  L.rock(14, 4.8, -2, 40, 5.5, -1.6, { dark: true }); // balcony railing
  L.invisible(14, 5.5, -2, 40, 9, -1.6);
  L.hint(28, 4.8, -10, 40, 8, -2, 'As Stone (2), press C in mid-air to pound through cracked floors.', () => altars.stone.used);
  // the chamber below
  L.floor(30, -12, 70, 6, -3, 6, { dark: true, moss: false });
  // beyond the balcony the chamber opens into a sunken courtyard (no ceiling, so the camera can look down)
  L.wall(42, 6, 70, 8, -3, 9, { dark: true });
  L.wall(30, -14, 70, -12, -3, 9, { dark: true });
  const block = L.block(37.5, -3, -6.5, 'stone');
  // the second weight: east until it stops at the lip, then north against the wall onto the second plate
  L.block(44.5, -3, 2, 'stone');
  L.rock(51.4, -3, -10, 52.2, -2.6, 6, { dark: true }); // floor lip across the chamber: a shoved block always stops in line with the plates
  const plate = L.plate(50.8, -3, 5.2);
  const plate2 = L.plate(50.8, -3, -9.3);
  L.light(50.8, 0.8, -8.2, 0xffb060, 12, 10);
  L.sigil(46, -3, -3.5, 5.5, 0xffb060, 2);
  L.gate(62, -3, -12, 62.6, 4, 6, () => plate.pressed && plate2.pressed);
  L.wall(62, -12, 62.6, 6, 4, 9, { dark: true }); // lintel: the raised portcullis is the only way through
  L.hint(33, -3, -10, 45, 1, 6, 'Only Stone can shove stone. The portcullis needs both plates held down: shove a block onto each.');
  L.checkpoint(34.5, -3, -9);
  L.checkpoint(60, -3, 3);
  // corridor with the cracked wall, then the wall-jump shaft
  L.wall(62.6, -12, 77, -3, -3, 9, { dark: true });
  // the corridor and shaft are open to the south like a cutaway: low lip + invisible guard
  L.rock(62.6, -3, 3, 77, -1.6, 4, { dark: true });
  L.invisible(62.6, -1.6, 3, 77, 16, 4);
  L.crack(66, -3, -3, 67, 1.6, 3, 'wall');
  L.rock(66, 1.6, -3, 67, 4, 3, { dark: true });
  L.cap(66, 4, -3, 67, 3); // invisible above: the charge is the only way through (a tall wall here hid the view)
  L.hint(62.6, -3, -3, 66, 1, 3, 'As Stone, press Shift to charge through cracked walls.');
  L.floor(69, -3.6, 77, 3.6, -3, 6, { dark: true, moss: false }); // shaft floor
  L.rock(69, -0.4, -3, 70, 16, 3, { dark: true });
  L.rock(73, -3, -3, 77, 8, 3, { dark: true });
  L.rock(70, -3, -3.6, 73, 16, -2, { dark: true });
  L.invisible(70, -3, 2, 73, 16, 3.6);
  L.checkpoint(67.8, -3, 1.6);
  L.hint(67, -3, -3, 73, 6, 3, 'Stone is too heavy to climb. Press 1 for Clay and jump from wall to wall.');
  L.prop('env_gear', 57, -3, -8.8, 6, { rotY: 0.2, fallback: gear, solid: 1.2 });
  L.prop('env_lantern', 47, 3.4, 0, 1, { fallback: lantern });
  L.light(47, 2.4, 0, 0xffa050, 14, 14);
  L.light(56, 1, -6, 0xffa050, 10, 12);
  L.light(68, 0.5, 0, 0xffa050, 8, 9);
  // the wall-jump shaft: warm at the bottom, cool moonlight falling from the top
  L.light(71.5, -1.2, 1.2, 0xffa860, 9, 9);
  L.light(71.5, 9.5, 0.8, 0x9fc8ff, 8, 13);
  L.prop('env_lantern', 71.5, 6.8, -1.55, 0.9, { fallback: lantern }); // on the back wall, never between camera and Loam
  L.light(36, 0.5, -6, 0xffb060, 14, 13);
  L.light(44, 1.5, -8.5, 0xffa050, 10, 12);
  L.light(50.8, 1.2, 3.6, 0xffb060, 14, 12);
  L.prop('env_lantern', 36, 2.2, -9.2, 1, { fallback: lantern });
  L.prop('env_lantern', 50.8, 2.6, 4.8, 1, { fallback: lantern });
  void block;
  zones.push({ x0: 14, x1: 42, y0: 3.5, yaw: -0.5, pitch: 0.62, distance: 12.5, lookAhead: 1.4 });
  zones.push({ x0: 30, x1: 42, y1: 3.8, yaw: -0.3, pitch: 0.32, distance: 6.5, lookAhead: 0.8 });
  zones.push({ x0: 42, x1: 62.6, y1: 3.8, yaw: -0.12, pitch: 0.88, distance: 15, lookAhead: 1.0 });
  zones.push({ x0: 62.6, x1: 77, y1: 9, yaw: -0.08, pitch: 0.52, distance: 13, lookAhead: 0.6 });

  // ===================================================================== C: the aqueduct
  L.floor(77, -6, 90, 6, 8, 12);
  L.wall(77, -8, 90, -6, 8, 14, { dark: true });
  L.rock(77, 8, 6, 90, 8.6, 6.6, { dark: true });
  L.invisible(77, 8.6, 6, 90, 12, 6.6);
  altars.wood = L.altar(84, 8, -2.5, 'wood');
  L.checkpoint(79.5, 8, 2);
  // the lake cannot be crossed without Wood (it floats Loam back up), so the way down to it waits for the altar
  L.gate(89.4, 8, -6, 90, 14, 6, () => altars.wood.used);
  L.cap(89.4, 14, -6, 90, 6);
  L.hint(85.5, 8, -6, 89.4, 12, 6, 'The gate answers to the altar. Take its gift first.', () => !altars.wood.used);
  L.floor(90, -6, 96, 6, 3, 9);
  L.checkpoint(92.5, 3, 0);
  L.floor(96, -12, 124, 10, -3, 6, { dark: true });
  L.water(96, -12, 124, 10, -3, 2.2);
  L.wall(96, -14, 124, -12, -3, 14, { dark: true });
  L.rock(96, -3, 10, 124, 2.7, 11, { dark: true });
  L.invisible(96, 2.7, 10, 124, 8, 11);
  L.wall(90, -8, 96, -6, 3, 12, { dark: true });
  L.rock(90, 3, 6, 96, 3.6, 6.6, { dark: true });
  L.invisible(90, 3.6, 6, 96, 12, 6.6); // the low lip alone let Loam hop off the front of the level
  L.rock(108, -1.2, -12, 109.5, 14, 10, { dark: true });
  // close the lake's corners outside the two shores
  L.rock(94, -9, -12, 96, 6, -6, { dark: true });
  L.rock(94, -9, 6, 96, 6, 11, { dark: true });
  L.rock(124, -9, -12, 126, 6, -6, { dark: true });
  L.rock(124, -9, 6, 126, 6, 11, { dark: true });
  L.block(101, 1.2, 4, 'wood');
  L.hint(90, 3, -6, 96, 7, 6, 'Clay melts in water. Stone sinks to the bottom. Wood floats.');
  L.hint(102, -3, -12, 108, 3, 10, 'Sink as Stone (2) and walk under the wall...', () => altars.wood.used);
  L.hint(109.5, -3, -12, 116, 3, 10, '...then become Wood (3) to float back up.', () => altars.wood.used);
  L.floor(124, -6, 134, 6, 4.2, 10);
  L.wall(124, -8, 146, -6, 4.2, 14, { dark: true });
  L.wall(124, 6, 134, 8, 4.2, 6, { dark: true });
  L.invisible(124, 6, 6, 146, 14, 8);
  L.checkpoint(127.2, 4.2, 3); // clear of the lake's edge
  L.fire(129.8, -6, 131.4, 6, 4.2);
  L.hint(124, 4.2, -6, 129.5, 8, 6, 'Wood burns! Cross the fire as Clay or Stone.');
  L.floor(134, -6, 146, 6, 8, 12);
  L.prop('env_tree', 87, 8, -4.8, 8, { category: 'life', fallback: tree, solid: 0.6 });
  L.prop('env_mushrooms', 94.5, 3, -4.6, 1.4, { category: 'life', fallback: mushrooms });
  L.prop('env_mushrooms', 126, 4.2, -4.8, 1.3, { category: 'life', fallback: mushrooms });
  L.prop('env_arch', 102, -3, -11, 11, { fallback: () => arch(8, 9) });
  L.prop('env_arch', 117, -3, -11, 11, { fallback: () => arch(8, 9) });
  L.prop('env_pillar', 113, -3, -10.5, 14, { fallback: () => pillar(14), solid: 0.8 });
  L.prop('env_rocks', 121, -3, 8, 2.2, { fallback: rocks, solid: 1.0 });
  atmo.addShaft(104, 20, -9, 26, 6, 0xbfe7ff, 0.12, -0.3);
  atmo.addShaft(118, 20, -9, 26, 5, 0xbfe7ff, 0.1, -0.3);
  zones.push({ x0: 77, x1: 96, y0: 2.5, yaw: -0.55, pitch: 0.6, distance: 13.5, lookAhead: 1.8 });
  zones.push({ x0: 96, x1: 124, yaw: -0.4, pitch: 0.62, distance: 16, lookAhead: 2.2, fov: 46 });
  zones.push({ x0: 124, x1: 146, yaw: -0.5, pitch: 0.6, distance: 13.5, lookAhead: 1.6 });

  // ===================================================================== D: the hall of light
  altars.glass = L.altar(139, 8, -2.5, 'glass');
  L.checkpoint(143, 8, 3);
  L.floor(146, -10, 177.5, 8, 8, 12, { dark: true, moss: false });
  windowedWall(L, 140, 182, -12, -10, 8, 15, 24, 10, 4);
  L.wall(146, 8, 177.5, 9, 8, 9.2, { dark: true });
  L.invisible(146, 9.2, 8, 177.5, 16, 9);
  L.wall(134, 6, 146, 8, 8, 9.2, { dark: true });
  L.invisible(134, 9.2, 6, 146, 16, 8);
  L.wall(134, -8, 146, -6, 8, 16, { dark: true });
  L.rock(146, 18, -10, 177.5, 20, 8, { dark: true, collide: false });
  L.prop('env_emitter', 148, 8, -1, 1.9, { category: 'glass', fallback: crystal, solid: 0.6 });
  L.sigil(165, 8, 2.5, 4, 0x8ff3ff, 3);
  L.beam(148.7, 9.0, -1, 1, 0, 0, 40);
  // The Prism Door answers only to light that has passed through a glass block, and the shutter by
  // the crystal lifts only while its plate is held down. Shove one block west onto the plate (a lip
  // stops it there), shove the other north into the beam (a lip stops it in line), then turn that one
  // to Glass. (Loam standing on the plate as Stone also holds the shutter, but cannot then be the glass.)
  const shutterPlate = L.plate(152.6, 8, 5.2);
  L.rock(151.6, 8, 3.2, 152, 8.4, 7.2, { dark: true }); // a block shoved west stops on the plate
  // the shutter holds the light back until its plate lifts it (a portcullis alone lets light through)
  L.gate(151.2, 8, -2.4, 151.8, 10.6, 0.4, () => shutterPlate.pressed).collider.blocksLight = true;
  L.rock(152, 8, -2.2, 174.5, 8.4, -1.8, { dark: true }); // a block shoved north stops in the beam
  const prismBlocks = [L.block(158.6, 8, 5.2, 'stone'), L.block(165.2, 8, 4.0, 'stone')];
  const receptor = L.receptor(175.4, 8.2, -1.6, 176, 9.4, -0.4);
  receptor.needsGlass = true;
  // By the blocks, say exactly what to do next: a block into the light's path, then E as Glass.
  // (The beam runs along z -1 at y 9; a block shoved north against the lip sits across it.)
  let prismSolved = false;
  const inLight = () => prismBlocks.find((b) => b.body.x > 152 && b.body.z < -1 && b.body.z + b.body.d > -1 && b.body.y < 9 && b.body.y + b.body.h > 9);
  const prismOpen = () => (prismSolved ||= receptor.isLit());
  const prismHint = (text: string, when: (b: ReturnType<typeof inLight>, open: boolean) => boolean) =>
    L.hint(160, 8, -10, 176, 12, 8, text, () => altars.glass.used && !prismOpen() && when(inLight(), shutterPlate.pressed));
  prismHint("First free the light: shove a block (as Stone) onto the plate by the crystal. It holds the shutter open.", (b, open) => !b && !open);
  prismHint('Now shove the other block into the path of the light, then make it Glass: press 4, then E beside it.', (b, open) => !b && open);
  prismHint('Now become Glass (4) and press E beside the block in the light. Light passes through glass.', (b) => !!b && b.form !== 'glass');
  prismHint("Now hold the shutter's plate down with the other block, so the light reaches the glass.", (b, open) => b?.form === 'glass' && !open);
  const door = L.gate(176, 8, -4, 177.5, 15, 4, () => receptor.isLit(), true, 'door');
  L.wall(176, -4, 177.5, 4, 15, 18, { dark: true }); // lintel: no climbing over the sealed door
  L.wall(176, -10, 177.5, -4, 8, 18, { dark: true });
  L.wall(176, 4, 177.5, 8, 8, 18, { dark: true });
  L.hint(146, 8, -10, 157, 12, 2, 'The door answers only to light that has passed through a glass block.', () => altars.glass.used);
  L.hint(146, 8, 2, 160, 12, 8, 'The shutter by the crystal lifts only while its plate is held down.', () => altars.glass.used);
  L.prop('env_statue', 166, 8, -8.6, 9, { rotY: 0.5, fallback: statue, solid: 1.1 });
  L.prop('env_pillar', 152, 8, -8.5, 9, { fallback: () => pillar(9), solid: 0.8 });
  L.prop('env_pillar', 172, 8, -8.5, 9, { fallback: () => pillar(9), solid: 0.8 });
  L.light(162, 12, -1, 0x8ff3ff, 8, 16);
  L.light(172, 11, 2.5, 0x9ff6ff, 7, 14);
  for (const x of [148, 158, 168]) atmo.addShaft(x, 26, -11, 24, 3.5, 0xd8f0ff, 0.12);
  zones.push({ x0: 134, x1: 177.5, y0: 6, yaw: -0.3, pitch: 0.72, distance: 15.5, lookAhead: 2.0, fov: 46 });

  // ===================================================================== D2: the Maker's Trial
  // Everything Loam has become, one form after another: charge a cracked wall (Stone), pound a
  // cracked floor (Stone), cross a deep pool (only Wood floats), cross a fire trough (not as
  // Wood), then turn a cradled block to Glass so the light opens the door to the causeway.
  // upper west floor, from the door of light to the cracked floor
  L.floor(177.5, -6, 188, 6, 8, 12, { dark: true, moss: false });
  L.checkpoint(179.6, 8, 3.2);
  L.crack(183, 8, -6, 184, 13, 6, 'wall');
  L.cap(183, 13, -6, 184, 6); // invisible above the cracked wall, so the camera still sees the room beyond
  L.crack(188, 7.1, -6, 191, 8, 6, 'floor');
  // a hanging wall ends the upper route: the way on is down through the cracked floor, then under it
  L.rock(191, 4.8, -6, 192, 10, 6, { dark: true });
  L.cap(191, 10, -6, 192, 6);
  // the lower level: landing, a deep pool (Wood floats across, Stone and Glass sink, Clay melts), far bank
  // the landing, with a narrow well in its south-west corner: a wooden crate floats above a plate
  L.floor(188, -6, 192, 3.8, 3, 8, { dark: true, moss: false });
  L.floor(188, 5.4, 192, 6, 3, 8, { dark: true, moss: false });
  L.floor(188, 3.8, 188.4, 5.4, 3, 8, { dark: true, moss: false });
  L.floor(190, 3.8, 192, 5.4, 3, 8, { dark: true, moss: false });
  L.floor(188.4, 3.8, 190, 5.4, -2, 6, { dark: true, moss: false });
  L.water(188.4, 3.8, 190, 5.4, -2, 2.6);
  const wellPlate = L.plate(189.2, -2, 4.6);
  L.block(189.2, 2.0, 4.6, 'wood');
  L.checkpoint(189.8, 3, 0.8);
  L.floor(192, -6, 200, 6, -2, 6, { dark: true, moss: false });
  L.water(192, -6, 200, 6, -2, 2.6);
  L.floor(200, -6, 204, 6, 3, 8, { dark: true, moss: false });
  L.checkpoint(202, 3, 3.5);
  // the far bank's gate answers to the plate at the bottom of the well
  L.gate(203.4, 3, -6, 204, 9, 6, () => wellPlate.pressed);
  L.cap(203.4, 9, -6, 204, 6);
  L.rock(204, -4, -6, 206, 5.5, 6, { dark: true }); // a step back up
  // upper east floor: the fire trough, then the light that opens the door to the causeway
  L.floor(206, -6, 225.5, 6, 8, 12, { dark: true, moss: false });
  L.checkpoint(206.8, 8, 3.5);
  L.fire(209, -6, 210.6, 6, 8);
  L.prop('env_emitter', 212.2, 8, 0, 1.9, { category: 'glass', fallback: crystal, solid: 0.6 });
  L.beam(212.9, 9.0, 0, 1, 0, 0, 14);
  L.rock(217.5, 8, -0.8, 219.1, 8.5, 0.8, { dark: true });
  L.rock(217.2, 8.5, -0.8, 217.7, 8.8, 0.8, { dark: true });
  L.rock(218.9, 8.5, -0.8, 219.4, 8.8, 0.8, { dark: true });
  L.rock(217.5, 8.5, -1.1, 219.1, 8.8, -0.6, { dark: true });
  L.rock(217.5, 8.5, 0.6, 219.1, 8.8, 1.1, { dark: true });
  L.block(218.3, 8.5, 0, 'stone');
  const trialRecv = L.receptor(224, 8.4, -0.6, 224.6, 9.6, 0.6);
  L.gate(224.6, 8, -6, 225.2, 14, 6, () => trialRecv.isLit(), true, 'door');
  L.wall(224.6, -6, 225.2, 6, 14, 20, { dark: true }); // lintel
  // the room: a tall back wall, open to the south like a cutaway (low lips and invisible guards)
  L.wall(177.5, -8, 225.5, -6, -4, 20, { dark: true });
  L.rock(177.5, 8, 6, 188, 8.6, 6.6, { dark: true });
  L.rock(188, -4, 6, 206, 3.6, 6.6, { dark: true });
  L.rock(206, 8, 6, 224.6, 8.6, 6.6, { dark: true });
  L.invisible(177.5, 8.6, 6, 188, 20, 6.6);
  L.invisible(188, 3.6, 6, 206, 20, 6.6);
  L.invisible(206, 8.6, 6, 224.6, 20, 6.6);
  L.prop('env_statue', 186, 8, -5.2, 7, { rotY: 0.3, fallback: statue, solid: 1.0 });
  L.prop('env_pillar', 207.6, 8, -5.3, 9, { fallback: () => pillar(9), solid: 0.8 });
  L.prop('env_lantern', 196, 7.6, -5.3, 1, { fallback: lantern });
  L.prop('env_crate', 202.6, 3, -4.9, 1.1, { rotY: 0.3, category: 'wood', fallback: crate, solid: 0.5 });
  L.light(180.5, 12, 1, 0xffb060, 10, 14);
  L.light(190, 6.5, 1.5, 0xffa050, 10, 12);
  L.light(196, 6.6, -4.6, 0xffa050, 9, 12);
  L.light(219, 12, 1, 0x8ff3ff, 9, 14);
  L.hint(177.5, 8, -6, 183, 12, 6, "The Maker's Trial: everything Loam has become, one form after another. Charge through as Stone (2, then Shift).");
  L.hint(184, 8, -6, 188, 12, 6, 'Pound through the cracked floor as Stone (C in mid-air).');
  L.hint(188, 2.5, -6, 192, 7, 6, 'The far gate opens while the plate at the bottom of this well is held down. Become Stone (2), stand by the floating crate and press E: it turns to stone and sinks.');
  L.light(189.2, 5.6, 3.2, 0xffc070, 12, 8); // the well and its crate, warmly lit
  L.hint(192, 2.5, -6, 203.4, 7, 6, 'Then cross the pool as Wood (3). The gate opens once the plate is held down.');
  L.hint(204, 5, -6, 209, 11, 6, 'Wood burns: cross the fire as Clay (1) or Stone (2).');
  L.hint(211, 8, -6, 224.5, 12, 6, 'Turn the block to Glass (4, then E) and let the light open the door.');
  // the lower level of the trial gets a closer camera (the landing, the well and the pool read clearly)
  zones.push({ x0: 186, x1: 206, y1: 6, yaw: -0.22, pitch: 0.55, distance: 10.5, lookAhead: 1.6 });
  zones.push({ x0: 177.5, x1: 225.5, y0: -3, yaw: -0.1, pitch: 0.55, distance: 14, lookAhead: 2.2 });

  // ===================================================================== E: the colossus escape
  L.floor(225.5, -3, 248, 3, 8, 12);
  L.checkpoint(229, 8, 0);
  L.trigger(233, 8, -3, 234, 12, 3, 'colossus');
  L.floor(253, -3, 274, 3, 9, 12);
  L.crack(262, 9, -3, 263, 13.2, 3, 'wall');
  L.rock(259, 13.2, -3, 270, 20, 3, { dark: true });
  L.floor(274, -3, 288, 3, 4, 6, { dark: true });
  L.water(274, -3, 288, 3, 4, 8.3);
  L.rock(274, -2, -3.5, 288, 7.7, -3, { dark: true }); // the channel's banks reach its floor:
  L.rock(274, -2, 3, 288, 7.7, 3.5, { dark: true }); // a sinking Loam can never slip out sideways
  L.floor(288, -3, 315, 3, 10.5, 12);
  L.beam(288.4, 11.4, 0, 1, 0, 0, 30);
  L.prop('env_emitter', 287.8, 10.5, 0, 1.9, { category: 'glass', fallback: crystal });
  const escRecv = L.receptor(314.4, 11, -0.6, 314.9, 12.2, 0.6);
  L.gate(306, 10.5, -3, 306.6, 16.5, 3, () => escRecv.isLit(), false);
  L.cap(306, 16.5, -3, 306.6, 3); // the beam-held gate cannot be climbed over
  L.trigger(310.5, 10.5, -3, 314.4, 16, 3, 'finale');
  // side rails keep the chase fair; the void below kills
  for (const [x0, x1, top] of [[225.5, 248, 8], [253, 274, 9], [274, 288, 8.3], [288, 315, 10.5]] as const) {
    L.rock(x0, top - 0.6, -3.5, x1, top + 0.5, -3, { dark: true });
    L.rock(x0, top - 0.6, 3, x1, top + 0.5, 3.5, { dark: true });
    L.invisible(x0, top + 0.5, -3.5, x1, top + 6, -3);
    L.invisible(x0, top + 0.5, 3, x1, top + 6, 3.5);
  }
  L.kill(225, -30, -40, 318, 1, 40);
  L.prop('env_wall', 315.5, 10.5, 0, 14, { rotY: Math.PI / 2, fallback: () => arch(6, 10) });
  L.prop('env_gear', 266, 9, -6, 7, { fallback: gear });
  L.prop('env_scaffold', 281, 4, -7, 10, { category: 'wood', fallback: scaffold });
  zones.push({ x0: 225.5, x1: 318, y0: 2, yaw: -0.12, pitch: 0.36, distance: 13, lookAhead: 3.6, fov: 46 });

  // ===================================================================== F: the valley
  L.floor(348, -12, 393, 12, 0, 20, { moss: true });
  L.prop('env_tree', 374, 0, -6, 9, { category: 'life', fallback: tree });
  L.prop('env_mushrooms', 366, 0, -4, 1.4, { category: 'life', fallback: mushrooms });
  L.prop('env_rocks', 357, 0, -5, 2.5, { fallback: rocks });
  zones.push({ x0: 338, x1: 398, yaw: -0.3, pitch: 0.3, distance: 12 });

  valleyLand(L);
  const F = L.foliage;
  // the valley meadow and the hills around it
  F.grass([{ x0: 348, z0: -12, x1: 393, z1: 12, y: 0, density: 26 }], { seed: 3, height: 0.42 });
  F.grass(
    [
      { x0: 333, z0: -46, x1: 408, z1: -12, y: 0, density: 9 },
      { x0: 328, z0: -12, x1: 348, z1: 14, y: 0, density: 9 },
      { x0: 393, z0: -12, x1: 413, z1: 14, y: 0, density: 9 },
    ],
    { seed: 4, height: 0.55, heightAt: valleyHeight, color: 0x5a8a2c, tipColor: 0xd8d27a },
  );
  F.flowers([{ x0: 348, z0: -12, x1: 393, z1: 12, y: 0 }], { perM2: 0.55 });
  F.flowers([{ x0: 336, z0: -40, x1: 406, z1: -12, y: 0 }], { perM2: 0.18, heightAt: valleyHeight, seed: 31 });
  F.blossoms(374, 7.2, -6, 3.6, 1.8, 3.2, 1400);
  F.fireflyCloud(370, 0.5, -2, 40, 140, 9);
  // the aqueduct comes alive when the wood altar restores living things
  F.grass(
    [
      { x0: 77.5, z0: -5.8, x1: 89.8, z1: 5.8, y: 8, density: 11 },
      { x0: 90.2, z0: -5.8, x1: 95.8, z1: 5.8, y: 3, density: 9 },
      { x0: 124.3, z0: -5.8, x1: 129.4, z1: 5.8, y: 4.2, density: 9 },
      { x0: 131.8, z0: -5.8, x1: 133.8, z1: 5.8, y: 4.2, density: 9 },
      { x0: 134.2, z0: -5.8, x1: 145.8, z1: 5.8, y: 8, density: 9 },
    ],
    { seed: 7, height: 0.5 },
  );
  F.flowers([{ x0: 78, z0: -5.5, x1: 95.5, z1: 5.5, y: 8 }], { perM2: 0.25, seed: 13, colors: [0x9fd8ff, 0xd9a0ff, 0xffffff] });
  F.fireflyCloud(108, 2.5, 0, 26, 70, 21);
  F.fireflyCloud(86, 9, -2, 12, 30, 22);
  // the crumbling causeway of the escape: sparse tufts
  F.grass(
    [
      { x0: 226, z0: -2.8, x1: 247.8, z1: 2.8, y: 8, density: 3 },
      { x0: 253.2, z0: -2.8, x1: 273.8, z1: 2.8, y: 9, density: 3 },
      { x0: 288.2, z0: -2.8, x1: 314.8, z1: 2.8, y: 10.5, density: 3 },
    ],
    { seed: 8, height: 0.42, color: 0x5a6a30, tipColor: 0xa8a050 },
  );

  L.kill(-40, -40, -40, 400, -14, 40);

  return {
    kiln: new THREE.Vector3(-9, 1.2, -7),
    wakeSpot: { x: 0, y: 0, z: 0 },
    altars,
    colossusAnchor: new THREE.Vector3(263, 0, -34),
    escapeStartX: 233,
    escapeEndX: 314,
    valleySpot: { x: 364, y: 0, z: 2 },
    lightDoor: door,
    zones,
  };
}
