// Loam's movement and abilities in full 3D. Input is camera-relative; the feel is tuned to be
// responsive and forgiving: coyote time, jump buffering, variable jump height, apex hang,
// double jump, wall slide/jump, air dash, ledge climb, step-up, plus per-material behaviour
// (stone pound/charge/push, wood float, glass lets light through, clay melts).

import { Body, Collider, makeBody, World3D, boxOverlap, Box } from '../physics/World3D';
import { Input } from '../core/Input';
import { FORMS, Form, FormSpec, FORM_ORDER } from './forms';

export type PlayerAnim =
  | 'idle'
  | 'run'
  | 'sprint'
  | 'walk'
  | 'jump'
  | 'fall'
  | 'flip'
  | 'wall'
  | 'dash'
  | 'charge'
  | 'pound'
  | 'push'
  | 'swim'
  | 'swimIdle'
  | 'wade'
  | 'climb'
  | 'cast'
  | 'hurt'
  | 'dead'
  | 'wake'
  | 'sit'
  | 'dance'
  | 'interact'
  | 'lying';

export type PlayerEvent = 'jump' | 'flip' | 'land' | 'hardLand' | 'dash' | 'walljump' | 'pound' | 'poundImpact' | 'transform' | 'splash' | 'step' | 'climb' | 'imprint' | 'death' | 'respawn';

export interface Pushable {
  collider: Collider;
  /** Try to move along an axis; returns the distance actually moved. */
  push(axis: 'x' | 'z', delta: number, pusherHeavy: boolean): number;
}
export interface Transmutable {
  aabb: Box;
  form: Form;
  setForm(f: Form): void;
}

export interface EventData {
  x?: number;
  y?: number;
  z?: number;
  speed?: number;
  form?: Form;
}

export interface PlayerHost {
  world: World3D;
  input: Input;
  /** Current camera yaw, used to make input camera-relative. */
  cameraYaw(): number;
  emit(e: PlayerEvent, p: Player, data?: EventData): void;
  findPushable(p: Player, axis: 'x' | 'z', dir: -1 | 1): Pushable | null;
  findTransmutable(p: Player): Transmutable | null;
  tryBreak(c: Collider, how: 'pound' | 'charge'): boolean;
  hazardAt(a: Box): 'fire' | 'kill' | null;
  kill(p: Player, reason: string): void;
}

const COYOTE = 0.1;
const JUMP_BUFFER = 0.13;
const DASH_TIME = 0.2;
const DASH_SPEED = 15.5;
const DASH_COOLDOWN = 0.32;
const CHARGE_TIME = 0.34;
const CHARGE_SPEED = 11;
const WALLJUMP_LOCK = 0.18;
const TRANSFORM_COOLDOWN = 0.22;

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class Player {
  readonly body: Body;
  form: Form = 'clay';
  unlocked = new Set<Form>(['clay']);
  /** Facing angle around Y; direction = (sin, 0, cos). */
  heading = 0;
  anim: PlayerAnim = 'idle';
  animTime = 0;
  control = true;
  /** Scripted world-space movement used by cutscenes when control is false. */
  scriptMove = { x: 0, z: 0 };
  scriptJump = false;
  dead = false;
  frozen = false;
  respawn = { x: 0, y: 0, z: 0 };

  private coyote = 0;
  private airJumps = 0;
  private airDashUsed = false;
  private dashTime = 0;
  private dashDir = { x: 0, z: 1 };
  private dashCooldown = 0;
  private chargeTime = 0;
  private wallLock = 0;
  private wall: { nx: number; nz: number } | null = null;
  /** Normal of the last wall jumped off since touching ground: chains must alternate between facing walls. */
  private lastWallJump: { nx: number; nz: number } | null = null;
  private transformCooldown = 0;
  private pounding = false;
  private dropTimer = 0;
  private climb: { t: number; dur: number; from: [number, number, number]; to: [number, number, number] } | null = null;
  private castTime = 0;
  private stepTimer = 0;
  private inWater = false;
  private wasGrounded = false;
  lastFallSpeed = 0;
  submerged = 0;
  speedRatio = 0;
  /** Normalised move intent this step (world space), exposed for the camera/visuals. */
  intent = { x: 0, z: 0 };

  constructor(private host: PlayerHost, x: number, y: number, z: number) {
    this.body = makeBody(x - 0.31, y, z - 0.31, 0.62, 1.15, 0.62);
    this.respawn = { x, y, z };
  }

  get spec(): FormSpec {
    return FORMS[this.form];
  }
  get cx() {
    return this.body.x + this.body.w / 2;
  }
  get cz() {
    return this.body.z + this.body.d / 2;
  }
  get cy() {
    return this.body.y + this.body.h / 2;
  }
  get grounded() {
    return this.body.grounded;
  }
  get hspeed() {
    return Math.hypot(this.body.vx, this.body.vz);
  }

  setAnim(a: PlayerAnim) {
    if (this.anim !== a) {
      this.anim = a;
      this.animTime = 0;
    }
  }
  unlock(f: Form) {
    this.unlocked.add(f);
  }
  setForm(f: Form, silent = false) {
    if (f === this.form || !this.unlocked.has(f)) return false;
    this.form = f;
    this.transformCooldown = TRANSFORM_COOLDOWN;
    if (!silent) this.host.emit('transform', this, { form: f, x: this.cx, y: this.cy, z: this.cz });
    if (f !== 'stone') this.pounding = false;
    return true;
  }
  teleport(x: number, y: number, z: number) {
    this.body.x = x - this.body.w / 2;
    this.body.y = y;
    this.body.z = z - this.body.d / 2;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.climb = null;
    this.dashTime = this.chargeTime = 0;
    this.pounding = false;
    this.lastWallJump = null;
  }
  cast(duration = 0.6) {
    this.castTime = duration;
    this.setAnim('cast');
  }
  faceTowards(x: number, z: number) {
    this.heading = Math.atan2(x - this.cx, z - this.cz);
  }

  update(dt: number) {
    const b = this.body;
    const inp = this.host.input;
    const spec = this.spec;
    const w = this.host.world;
    this.animTime += dt;
    if (this.dead || this.frozen) return;

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.wallLock = Math.max(0, this.wallLock - dt);
    this.transformCooldown = Math.max(0, this.transformCooldown - dt);
    this.dropTimer = Math.max(0, this.dropTimer - dt);
    b.ignoreOneWay = this.dropTimer > 0;

    // --- ledge climb tween
    if (this.climb) {
      const c = this.climb;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const up = easeOut(Math.min(1, k / 0.65));
      const over = easeInOut(Math.max(0, (k - 0.35) / 0.65));
      b.x = c.from[0] + (c.to[0] - c.from[0]) * over;
      b.z = c.from[2] + (c.to[2] - c.from[2]) * over;
      b.y = c.from[1] + (c.to[1] - c.from[1]) * up;
      b.vx = b.vy = b.vz = 0;
      this.setAnim('climb');
      if (k >= 1) {
        this.climb = null;
        b.grounded = true;
        this.airJumps = spec.doubleJump ? 1 : 0;
        this.airDashUsed = false;
      }
      return;
    }

    // --- input (camera relative)
    const ctl = this.control;
    let mx = 0;
    let mz = 0;
    if (ctl) {
      const yaw = this.host.cameraYaw();
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      mx = rx * inp.axisX + fx * inp.axisY;
      mz = rz * inp.axisX + fz * inp.axisY;
    } else {
      mx = this.scriptMove.x;
      mz = this.scriptMove.z;
    }
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    if (this.wallLock > 0) {
      mx *= 0.2;
      mz *= 0.2;
    }
    this.intent.x = mx;
    this.intent.z = mz;
    const jumpPressed = ctl ? inp.buffered('jump', JUMP_BUFFER) : this.scriptJump;
    const jumpHeld = ctl ? inp.held('jump') : this.scriptJump;
    const jumpReleased = ctl ? inp.released('jump') : false;
    if (!ctl) this.scriptJump = false;

    if (ctl && this.transformCooldown <= 0) {
      const want: Form | null = inp.pressed('form1')
        ? 'clay'
        : inp.pressed('form2')
          ? 'stone'
          : inp.pressed('form3')
            ? 'wood'
            : inp.pressed('form4')
              ? 'glass'
              : inp.pressed('cycle')
                ? this.nextForm()
                : null;
      if (want) this.setForm(want);
    }

    // --- water
    const water = w.waterAt(b);
    if (water) this.submerged = clamp01((water.y + water.h - b.y) / b.h);
    else this.submerged = 0;
    const entering = water && !this.inWater;
    this.inWater = Boolean(water) && this.submerged > 0.2;
    if (entering) this.host.emit('splash', this, { x: this.cx, y: water!.y + water!.h, z: this.cz, speed: Math.abs(b.vy) });
    if (this.inWater && spec.water === 'melt' && this.submerged > 0.55) {
      this.host.kill(this, 'melt');
      return;
    }

    // --- facing
    if (mag > 0.1 && this.dashTime <= 0 && this.chargeTime <= 0 && this.castTime <= 0) {
      const target = Math.atan2(mx, mz);
      this.heading = lerpAngle(this.heading, target, 1 - Math.exp(-dt * 16));
    }
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);

    // --- dash / charge
    if (ctl && inp.pressed('dash') && this.dashCooldown <= 0 && this.dashTime <= 0 && this.chargeTime <= 0 && !this.inWater) {
      const dx = mag > 0.2 ? mx / mag : hx;
      const dz = mag > 0.2 ? mz / mag : hz;
      if (spec.dash === 'roll' && (b.grounded || !this.airDashUsed)) {
        this.dashTime = DASH_TIME;
        this.dashDir = { x: dx, z: dz };
        this.heading = Math.atan2(dx, dz);
        this.dashCooldown = DASH_COOLDOWN;
        if (!b.grounded) this.airDashUsed = true;
        this.pounding = false;
        this.host.emit('dash', this, { x: this.cx, y: this.cy, z: this.cz });
      } else if (spec.dash === 'charge' && b.grounded) {
        this.chargeTime = CHARGE_TIME;
        this.dashDir = { x: dx, z: dz };
        this.heading = Math.atan2(dx, dz);
        this.dashCooldown = DASH_COOLDOWN + 0.2;
        this.host.emit('dash', this, { x: this.cx, y: this.cy, z: this.cz });
      }
    }

    // --- horizontal velocity
    const swimming = this.inWater && spec.water === 'float';
    const wading = this.inWater && spec.water === 'sink';
    const maxSpeed = spec.runSpeed * (swimming ? 0.72 : wading ? 0.6 : 1);
    if (this.castTime > 0) {
      this.castTime -= dt;
      mx = mz = 0;
      mag = 0;
    }
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      b.vx = this.dashDir.x * DASH_SPEED;
      b.vz = this.dashDir.z * DASH_SPEED;
      b.vy = Math.max(b.vy, 0) * 0.2;
    } else if (this.chargeTime > 0) {
      this.chargeTime -= dt;
      b.vx = this.dashDir.x * CHARGE_SPEED;
      b.vz = this.dashDir.z * CHARGE_SPEED;
    } else {
      const tx = mx * maxSpeed;
      const tz = mz * maxSpeed;
      const turning = b.vx * tx + b.vz * tz < 0 && this.hspeed > 0.5;
      const accel = b.grounded ? (turning ? 95 : 70) : 46;
      const decel = b.grounded ? 80 : 26;
      const rate = mag > 0.01 ? accel : decel;
      const ex = tx - b.vx;
      const ez = tz - b.vz;
      const el = Math.hypot(ex, ez);
      if (el > 1e-6) {
        const step = Math.min(el, rate * dt);
        b.vx += (ex / el) * step;
        b.vz += (ez / el) * step;
      }
    }

    // --- gravity / buoyancy
    const g = w.gravity * spec.gravityScale;
    if (this.dashTime > 0) {
      // hold altitude
    } else if (swimming) {
      const target = water!.y + water!.h - b.h * 0.62;
      b.vy += ((target - b.y) * 40 - b.vy * 6) * dt;
      b.vy = Math.max(b.vy, -6);
    } else if (wading) {
      b.vy -= g * 0.35 * dt;
      b.vy = Math.max(b.vy, -3.5);
    } else {
      let gs = 1;
      if (!b.grounded && Math.abs(b.vy) < 2.2 && jumpHeld) gs = 0.55;
      if (b.vy < 0 && !this.pounding) gs *= 1.15;
      b.vy -= g * gs * dt;
      b.vy = Math.max(b.vy, -spec.maxFall);
    }

    // --- ground pound (stone)
    if (ctl && spec.heavy && !b.grounded && !this.inWater && inp.pressed('pound') && !this.pounding) {
      this.pounding = true;
      this.dashTime = 0;
      b.vx *= 0.2;
      b.vz *= 0.2;
      b.vy = 4;
      this.host.emit('pound', this, { x: this.cx, y: this.cy, z: this.cz });
    }
    if (this.pounding) {
      b.vx = b.vz = 0;
      b.vy = Math.max(b.vy - 140 * dt, -34);
    }

    // --- coyote and air jumps
    if (b.grounded || swimming) {
      this.coyote = b.grounded ? COYOTE : 0;
      this.airJumps = spec.doubleJump ? 1 : 0;
      this.airDashUsed = false;
      this.lastWallJump = null;
    } else this.coyote = Math.max(0, this.coyote - dt);
    if (!spec.doubleJump) this.airJumps = 0;

    // --- wall slide: airborne and pushing into a wall
    this.wall = null;
    if (!b.grounded && !this.inWater && spec.wallGrip > 0 && this.dashTime <= 0 && !this.pounding && mag > 0.3) {
      for (const [nx, nz] of DIRS) {
        if (mx * nx + mz * nz < 0.45) continue;
        if (w.wallAt(b, nx, nz, 0.06)) {
          this.wall = { nx: -nx, nz: -nz };
          break;
        }
      }
      if (this.wall && b.vy < 0) {
        b.vy = Math.max(b.vy, -spec.wallGrip);
        this.heading = Math.atan2(-this.wall.nx, -this.wall.nz);
      }
    }

    // --- jumping
    const jumpV = Math.sqrt(2 * g * spec.jumpHeight);
    if (jumpPressed && this.castTime <= 0) {
      const nearWall = !b.grounded && spec.wallGrip > 0 ? this.anyWall(0.25) : null;
      if (ctl && inp.held('down') && b.grounded && b.groundCollider?.kind === 'oneway') {
        this.dropTimer = 0.28;
        b.grounded = false;
        inp.consume('jump');
      } else if (b.grounded || this.coyote > 0) {
        b.vy = jumpV;
        this.coyote = 0;
        b.grounded = false;
        if (ctl) inp.consume('jump');
        this.host.emit('jump', this, { x: this.cx, y: b.y, z: this.cz });
      } else if (swimming && this.submerged < 0.9) {
        b.vy = jumpV * 0.85;
        if (ctl) inp.consume('jump');
        this.host.emit('jump', this, { x: this.cx, y: b.y, z: this.cz });
      } else if (wading) {
        b.vy = Math.sqrt(2 * g * 0.35 * 1.1);
        if (ctl) inp.consume('jump');
      } else if ((this.wall || nearWall) && this.canWallJump(this.wall ?? nearWall!)) {
        const n = this.wall ?? nearWall!;
        this.lastWallJump = { nx: n.nx, nz: n.nz };
        b.vy = jumpV * 0.92;
        b.vx = n.nx * 7.8;
        b.vz = n.nz * 7.8;
        this.heading = Math.atan2(n.nx, n.nz);
        this.wallLock = WALLJUMP_LOCK;
        this.airJumps = spec.doubleJump ? 1 : 0;
        if (ctl) inp.consume('jump');
        this.host.emit('walljump', this, { x: this.cx, y: this.cy, z: this.cz });
      } else if (this.airJumps > 0) {
        this.airJumps--;
        b.vy = jumpV * 0.9;
        this.pounding = false;
        if (ctl) inp.consume('jump');
        this.host.emit('flip', this, { x: this.cx, y: b.y, z: this.cz });
        this.setAnim('flip');
      }
    }
    if (jumpReleased && b.vy > 0 && !this.pounding && this.dashTime <= 0) b.vy *= 0.5;

    // --- pushing blocks along the dominant input axis
    let pushing = false;
    if (b.grounded && mag > 0.3 && this.dashTime <= 0) {
      const axis: 'x' | 'z' = Math.abs(mx) >= Math.abs(mz) ? 'x' : 'z';
      const dir: -1 | 1 = (axis === 'x' ? mx : mz) > 0 ? 1 : -1;
      const p = this.host.findPushable(this, axis, dir);
      if (p) {
        const want = dir * (spec.heavy ? 3.0 : 2.2) * dt;
        const moved = p.push(axis, want, spec.heavy);
        if (axis === 'x') {
          b.vx = moved / dt;
          b.vz *= 0.5;
        } else {
          b.vz = moved / dt;
          b.vx *= 0.5;
        }
        pushing = true;
        this.heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
      }
    }

    // --- integrate
    const vyBefore = b.vy;
    this.wasGrounded = b.grounded;
    w.move(b, b.vx * dt, b.vy * dt, b.vz * dt);

    if (b.hitCeiling && b.vy > 0) b.vy = 0;
    if (b.grounded && this.wasGrounded && b.vy < 0) b.vy = 0;

    // step-up over small lips
    if (b.grounded && (b.hitX || b.hitZ) && mag > 0.3) {
      for (const [axis, hit] of [['x', b.hitX], ['z', b.hitZ]] as const) {
        if (!hit) continue;
        const lip = axis === 'x' ? w.wallAt(b, hit, 0, 0.05) : w.wallAt(b, 0, hit, 0.05);
        if (lip && lip.top - b.y > 0 && lip.top - b.y <= 0.45) {
          const probe = { x: b.x + (axis === 'x' ? hit * 0.06 : 0), y: lip.top + 0.01, z: b.z + (axis === 'z' ? hit * 0.06 : 0), w: b.w, h: b.h, d: b.d };
          if (w.isFree(probe)) {
            b.y = lip.top + 0.001;
            if (axis === 'x') {
              b.x += hit * 0.06;
              b.hitX = 0;
            } else {
              b.z += hit * 0.06;
              b.hitZ = 0;
            }
          }
        }
      }
    }
    // stone charge smashes cracked walls
    if (this.chargeTime > 0 && (b.hitX || b.hitZ)) {
      const c = b.hitColliderX ?? b.hitColliderZ;
      if (!(c && this.host.tryBreak(c, 'charge'))) {
        this.chargeTime = 0;
        b.vx = -this.dashDir.x * 2;
        b.vz = -this.dashDir.z * 2;
      }
    } else {
      if (b.hitX && this.dashTime <= 0) b.vx = 0;
      if (b.hitZ && this.dashTime <= 0) b.vz = 0;
      if ((b.hitX || b.hitZ) && this.dashTime > 0) this.dashTime = 0;
    }

    // --- landing
    if (b.grounded && !this.wasGrounded) {
      const impact = -vyBefore;
      this.lastFallSpeed = impact;
      if (this.pounding) {
        this.pounding = false;
        const ground = b.groundCollider;
        this.host.emit('poundImpact', this, { x: this.cx, y: b.y, z: this.cz, speed: impact });
        if (ground && this.host.tryBreak(ground, 'pound')) {
          b.grounded = false;
          b.vy = -10;
        }
      } else if (impact > spec.shatterSpeed) {
        this.host.kill(this, 'shatter');
        return;
      } else {
        this.host.emit(impact > 17 ? 'hardLand' : 'land', this, { x: this.cx, y: b.y, z: this.cz, speed: impact });
      }
      if (b.grounded) b.vy = 0;
    }

    // --- ledge climb: airborne, pushing into a wall whose top is near head height
    if (!b.grounded && !this.inWater && this.dashTime <= 0 && !this.pounding && mag > 0.3 && b.vy < 3) {
      for (const [nx, nz] of DIRS) {
        if (mx * nx + mz * nz < 0.5) continue;
        const wall = w.wallAt(b, nx, nz, 0.08);
        if (!wall) continue;
        const top = wall.top;
        if (top > b.y + b.h * 0.45 && top < b.y + b.h + 0.35) {
          const tx = nx > 0 ? wall.x + 0.05 : nx < 0 ? wall.maxX - b.w - 0.05 : b.x;
          const tz = nz > 0 ? wall.z + 0.05 : nz < 0 ? wall.maxZ - b.d - 0.05 : b.z;
          const probe = { x: tx, y: top + 0.01, z: tz, w: b.w, h: b.h, d: b.d };
          if (w.isFree(probe)) {
            this.climb = { t: 0, dur: 0.42, from: [b.x, b.y, b.z], to: [tx, top, tz] };
            this.heading = Math.atan2(nx, nz);
            this.host.emit('climb', this, { x: this.cx, y: top, z: this.cz });
            return;
          }
        }
      }
    }

    // --- hazards
    const hazard = this.host.hazardAt(b);
    if (hazard === 'kill') {
      this.host.kill(this, 'fall');
      return;
    }
    if (hazard === 'fire' && spec.burns) {
      this.host.kill(this, 'burn');
      return;
    }

    // --- imprint material onto objects
    if (ctl && inp.pressed('interact') && this.castTime <= 0) {
      const t = this.host.findTransmutable(this);
      if (t && t.form !== this.form) {
        t.setForm(this.form);
        this.faceTowards(t.aabb.x + t.aabb.w / 2, t.aabb.z + t.aabb.d / 2);
        this.cast(0.45);
        this.setAnim('interact');
        this.host.emit('imprint', this, { x: t.aabb.x + t.aabb.w / 2, y: t.aabb.y + t.aabb.h / 2, z: t.aabb.z + t.aabb.d / 2, form: this.form });
      }
    }

    // --- footsteps
    const hs = this.hspeed;
    if (b.grounded && hs > 1) {
      this.stepTimer -= (dt * hs) / spec.runSpeed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.32;
        this.host.emit('step', this, { x: this.cx, y: b.y, z: this.cz });
      }
    }

    // --- animation
    this.speedRatio = hs / Math.max(0.01, spec.runSpeed);
    if (this.castTime > 0 && (this.anim === 'cast' || this.anim === 'interact')) {
      // hold the casting pose
    } else if (this.pounding) this.setAnim('pound');
    else if (this.dashTime > 0) this.setAnim('dash');
    else if (this.chargeTime > 0) this.setAnim('charge');
    else if (swimming) this.setAnim(hs > 0.6 ? 'swim' : 'swimIdle');
    else if (wading && b.grounded) this.setAnim(hs > 0.4 ? 'wade' : 'idle');
    else if (b.grounded) {
      if (pushing) this.setAnim('push');
      else if (hs > 0.4) this.setAnim(spec.heavy ? 'walk' : this.speedRatio > 1.05 ? 'sprint' : 'run');
      else this.setAnim('idle');
    } else if (this.wall) this.setAnim('wall');
    else if (this.anim === 'flip' && this.animTime < 0.45) {
      // finish the flip
    } else this.setAnim(b.vy > 0 ? 'jump' : 'fall');
  }

  private anyWall(reach: number): { nx: number; nz: number } | null {
    for (const [nx, nz] of DIRS) if (this.host.world.wallAt(this.body, nx, nz, reach)) return { nx: -nx, nz: -nz };
    return null;
  }

  /**
   * Wall jumps chain only between facing walls (a shaft). Jumping off the same wall again, or off
   * a corner's other wall, waits until Loam lands, so no single wall can be climbed to skip a puzzle.
   */
  private canWallJump(n: { nx: number; nz: number }) {
    const last = this.lastWallJump;
    return !last || last.nx * n.nx + last.nz * n.nz < -0.5;
  }

  nextForm(): Form {
    const owned = FORM_ORDER.filter((f) => this.unlocked.has(f));
    const i = owned.indexOf(this.form);
    return owned[(i + 1) % owned.length];
  }

  overlaps(a: Box) {
    return boxOverlap(this.body, a);
  }
}

export function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
export function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
export function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
