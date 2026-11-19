// Lighting values many custom shaders share (water, grass, fog...), updated once per frame from
// the blended area mood. Shaders reference these uniform objects directly.

import * as THREE from 'three';

export const SUN = {
  /** Direction toward the sun. */
  dir: { value: new THREE.Vector3(0, 1, 0) },
  /** Sun colour times intensity. */
  color: { value: new THREE.Color(0xffffff) },
};
