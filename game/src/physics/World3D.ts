// Axis-separated 3D box physics for a third-person platformer. y is up, units are metres.
// Each axis is swept separately, so fast bodies cannot tunnel through thin colliders, and
// sliding along walls in any direction falls out naturally.

export interface Box {
  x: number; // min x
  y: number; // min y (bottom)
  z: number; // min z
  w: number; // size along x
  h: number; // size along y
  d: number; // size along z
}

export type ColliderKind = 'solid' | 'oneway';

let nextId = 1;

export class Collider implements Box {
  readonly id = nextId++;
  enabled = true;
  /** Light beams stop at colliders that block light. */
  blocksLight = true;
  /** The follow camera pulls in when these block its view (invisible guard walls do not). */
  blocksCamera = true;
  tag = '';
  owner: unknown = null;
  constructor(
    public x: number,
    public y: number,
    public z: number,
    public w: number,
    public h: number,
    public d: number,
    public kind: ColliderKind = 'solid',
  ) {}
  get maxX() {
    return this.x + this.w;
  }
  get top() {
    return this.y + this.h;
  }
  get maxZ() {
    return this.z + this.d;
  }
}

export interface Body extends Box {
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundCollider: Collider | null;
  hitCeiling: boolean;
  /** -1/+1 when the last horizontal move was stopped by a wall on that side, else 0. */
  hitX: -1 | 0 | 1;
  hitZ: -1 | 0 | 1;
  hitColliderX: Collider | null;
  hitColliderZ: Collider | null;
  ignoreOneWay: boolean;
  self?: Collider | null;
}

export function makeBody(x: number, y: number, z: number, w: number, h: number, d: number): Body {
  return { x, y, z, w, h, d, vx: 0, vy: 0, vz: 0, grounded: false, groundCollider: null, hitCeiling: false, hitX: 0, hitZ: 0, hitColliderX: null, hitColliderZ: null, ignoreOneWay: false, self: null };
}

export interface RayHit {
  x: number;
  y: number;
  z: number;
  dist: number;
  nx: number;
  ny: number;
  nz: number;
  collider: Collider | null;
  extra: Box | null;
}

export interface WaterVolume extends Box {
  id: number;
}

const EPS = 1e-4;

export class World3D {
  colliders: Collider[] = [];
  water: WaterVolume[] = [];
  gravity = 38;

  add(c: Collider) {
    this.colliders.push(c);
    return c;
  }
  addBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: ColliderKind = 'solid') {
    return this.add(new Collider(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), kind));
  }
  remove(c: Collider) {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }
  addWater(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const v: WaterVolume = { id: nextId++, x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), d: Math.abs(z1 - z0) };
    this.water.push(v);
    return v;
  }

  /** Move a body by (dx, dy, dz) resolving collisions; updates contact flags. */
  move(body: Body, dx: number, dy: number, dz: number) {
    body.hitX = body.hitZ = 0;
    body.hitColliderX = body.hitColliderZ = null;
    body.hitCeiling = false;
    this.moveX(body, dx);
    this.moveZ(body, dz);
    const wasGrounded = body.grounded;
    body.grounded = false;
    body.groundCollider = null;
    this.moveY(body, dy);
    if (!body.grounded && dy <= 0 && wasGrounded) {
      const g = this.groundBelow(body, 0.02);
      if (g) {
        body.grounded = true;
        body.groundCollider = g;
      }
    }
  }

  moveX(body: Body, dx: number) {
    if (dx === 0) return;
    let nx = body.x + dx;
    for (const c of this.colliders) {
      if (!c.enabled || c.kind !== 'solid' || c === body.self) continue;
      if (body.y + body.h <= c.y + EPS || body.y >= c.top - EPS) continue;
      if (body.z + body.d <= c.z + EPS || body.z >= c.maxZ - EPS) continue;
      if (dx > 0 && body.x + body.w <= c.x + EPS && nx + body.w > c.x) {
        nx = c.x - body.w;
        body.hitX = 1;
        body.hitColliderX = c;
      } else if (dx < 0 && body.x >= c.maxX - EPS && nx < c.maxX) {
        nx = c.maxX;
        body.hitX = -1;
        body.hitColliderX = c;
      }
    }
    body.x = nx;
  }

  moveZ(body: Body, dz: number) {
    if (dz === 0) return;
    let nz = body.z + dz;
    for (const c of this.colliders) {
      if (!c.enabled || c.kind !== 'solid' || c === body.self) continue;
      if (body.y + body.h <= c.y + EPS || body.y >= c.top - EPS) continue;
      if (body.x + body.w <= c.x + EPS || body.x >= c.maxX - EPS) continue;
      if (dz > 0 && body.z + body.d <= c.z + EPS && nz + body.d > c.z) {
        nz = c.z - body.d;
        body.hitZ = 1;
        body.hitColliderZ = c;
      } else if (dz < 0 && body.z >= c.maxZ - EPS && nz < c.maxZ) {
        nz = c.maxZ;
        body.hitZ = -1;
        body.hitColliderZ = c;
      }
    }
    body.z = nz;
  }

  moveY(body: Body, dy: number) {
    if (dy === 0) return;
    let ny = body.y + dy;
    for (const c of this.colliders) {
      if (!c.enabled || c === body.self) continue;
      if (body.x + body.w <= c.x + EPS || body.x >= c.maxX - EPS) continue;
      if (body.z + body.d <= c.z + EPS || body.z >= c.maxZ - EPS) continue;
      if (dy < 0) {
        if (body.y >= c.top - EPS && ny < c.top) {
          if (c.kind === 'oneway' && body.ignoreOneWay) continue;
          ny = c.top;
          body.grounded = true;
          body.groundCollider = c;
        }
      } else if (c.kind === 'solid') {
        if (body.y + body.h <= c.y + EPS && ny + body.h > c.y) {
          ny = c.y - body.h;
          body.hitCeiling = true;
        }
      }
    }
    body.y = ny;
  }

  groundBelow(body: Body, reach: number): Collider | null {
    let best: Collider | null = null;
    for (const c of this.colliders) {
      if (!c.enabled || c === body.self) continue;
      if (c.kind === 'oneway' && body.ignoreOneWay) continue;
      if (body.x + body.w <= c.x + EPS || body.x >= c.maxX - EPS) continue;
      if (body.z + body.d <= c.z + EPS || body.z >= c.maxZ - EPS) continue;
      const gap = body.y - c.top;
      if (gap >= -EPS && gap <= reach) if (!best || c.top > best.top) best = c;
    }
    return best;
  }

  /**
   * Solid collider touching the body's side in an axis direction (nx,nz) is one of
   * (+1,0) (-1,0) (0,+1) (0,-1), within `reach`.
   */
  wallAt(b: Box, nx: number, nz: number, reach = 0.05, self?: Collider | null): Collider | null {
    for (const c of this.colliders) {
      if (!c.enabled || c.kind !== 'solid' || c === self) continue;
      if (b.y + b.h <= c.y + 0.05 || b.y >= c.top - 0.05) continue;
      if (nx !== 0) {
        if (b.z + b.d <= c.z + 0.02 || b.z >= c.maxZ - 0.02) continue;
        const gap = nx > 0 ? c.x - (b.x + b.w) : b.x - c.maxX;
        if (gap >= -EPS && gap <= reach) return c;
      } else {
        if (b.x + b.w <= c.x + 0.02 || b.x >= c.maxX - 0.02) continue;
        const gap = nz > 0 ? c.z - (b.z + b.d) : b.z - c.maxZ;
        if (gap >= -EPS && gap <= reach) return c;
      }
    }
    return null;
  }

  overlaps(a: Box, filter?: (c: Collider) => boolean): Collider[] {
    const out: Collider[] = [];
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (filter && !filter(c)) continue;
      if (boxOverlap(a, c)) out.push(c);
    }
    return out;
  }

  isFree(a: Box, self?: Collider | null) {
    for (const c of this.colliders) {
      if (!c.enabled || c.kind !== 'solid' || c === self) continue;
      if (boxOverlap(a, c, 0.001)) return false;
    }
    return true;
  }

  waterAt(a: Box): WaterVolume | null {
    for (const v of this.water) if (boxOverlap(a, v)) return v;
    return null;
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, light: boolean | 'camera', extras: Box[] = []): RayHit | null {
    let best: RayHit | null = null;
    const test = (b: Box, collider: Collider | null, extra: Box | null) => {
      const hit = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (hit && hit.t <= maxDist && (!best || hit.t < best.dist)) {
        best = { x: ox + dx * hit.t, y: oy + dy * hit.t, z: oz + dz * hit.t, dist: hit.t, nx: hit.nx, ny: hit.ny, nz: hit.nz, collider, extra };
      }
    };
    for (const c of this.colliders) {
      if (!c.enabled || c.kind !== 'solid') continue;
      if (light === true && !c.blocksLight) continue;
      if (light === 'camera' && !c.blocksCamera) continue;
      test(c, c, null);
    }
    for (const e of extras) test(e, null, e);
    return best;
  }
}

export function boxOverlap(a: Box, b: Box, shrink = 0) {
  return (
    a.x + shrink < b.x + b.w &&
    a.x + a.w - shrink > b.x &&
    a.y + shrink < b.y + b.h &&
    a.y + a.h - shrink > b.y &&
    a.z + shrink < b.z + b.d &&
    a.z + a.d - shrink > b.z
  );
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const axes: [number, number, number, number, 0 | 1 | 2][] = [
    [ox, dx, b.x, b.x + b.w, 0],
    [oy, dy, b.y, b.y + b.h, 1],
    [oz, dz, b.z, b.z + b.d, 2],
  ];
  for (const [o, d, lo, hi, axis] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    const tn = Math.min(t1, t2);
    const tf = Math.max(t1, t2);
    if (tn > tmin) {
      tmin = tn;
      nx = ny = nz = 0;
      const s = d > 0 ? -1 : 1;
      if (axis === 0) nx = s;
      else if (axis === 1) ny = s;
      else nz = s;
    }
    tmax = Math.min(tmax, tf);
  }
  if (tmax < tmin || tmax < 0 || tmin < 0) return null;
  return { t: tmin, nx, ny, nz };
}
