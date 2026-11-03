import * as THREE from 'three';
import { GORILLA, CELL } from '../config.js';
import { instantiateGorilla } from './GorillaModel.js';
import { Pose, Poses, applyPose, UPPER, BI } from './GorillaAnimator.js';
import { clamp, damp, dampAngle, angleDiff } from '../core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// Root distance from a facade while climbing (matches the solved climbing poses).
const CLIMB_OFF = 3.2;

// Action definitions: duration (s), normalized hit time, whether legs keep locomotion.
const ACTIONS = {
  punch: { dur: 0.56, hit: 0.42, upper: true },
  smash: { dur: 1.0, hit: 0.48, upper: false },
  stomp: { dur: 0.95, hit: 0.48, upper: false },
  roar: { dur: 2.5, hit: 0.2, upper: false },
  grab: { dur: 0.62, hit: 0.45, upper: true },
  eat: { dur: 1.25, hit: 0.5, upper: true },
  throw: { dur: 0.7, hit: 0.46, upper: true },
  climbPunch: { dur: 0.45, hit: 0.4, upper: false },
  climbSmash: { dur: 0.8, hit: 0.53, upper: false },
  climbKick: { dur: 0.6, hit: 0.45, upper: false },
  climbGrab: { dur: 0.55, hit: 0.44, upper: false },
  climbEat: { dur: 1.15, hit: 0.5, upper: false },
  climbSwat: { dur: 0.5, hit: 0.42, upper: false },
  climbThrow: { dur: 0.55, hit: 0.45, upper: false },
  climbRoar: { dur: 2.2, hit: 0.2, upper: false },
  hit: { dur: 0.4, hit: 1, upper: true },
};

// The player monster: controller, combat, climbing and animation driver.
export class Gorilla {
  constructor(ctx, start) {
    this.ctx = ctx;
    const m = instantiateGorilla({ scale: GORILLA.modelScale });
    this.model = m;
    this.object = m.group;
    ctx.root.add(this.object);
    this.pos = start.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // facing -Z (towards downtown)
    this.health = GORILLA.maxHealth;
    this.state = 'ground'; // ground | air | climb | dead
    this.grounded = true;
    this.action = null;
    this.queued = null;
    this.punchSide = 'R';
    this.held = null;
    this.t = 0;
    this.phase = 0;
    this.speed = 0;
    this.landT = 1;
    this.landK = 0;
    this.slamming = false;
    this.rage = 0;
    this.roarCd = 0;
    this.stompCd = 0;
    this.chargeCd = 0;
    this.hurtFlash = 0;
    this.deathT = 0;
    this.climb = null;
    this.aimPitch = 0;
    this.camYaw = Math.PI;
    this.lastStepPhase = 0;
    this.base = new Pose();
    this.tmp = new Pose();
    this.act = new Pose();
    this.out = new Pose();
    this.headYaw = 0;
    this.body = ctx.physics.kinematicCapsule(4.5, GORILLA.radius, { x: this.pos.x, y: this.pos.y + 7.5, z: this.pos.z });
    this.handL = new THREE.Vector3();
    this.handR = new THREE.Vector3();
    this.stats = { punches: 0, eaten: 0 };
    this.invuln = 0;
    this.reattachCd = 0;
    this.trans = null;
    this.leapTarget = null;
    // diegetic condition
    this.woundVis = 0; // displayed damage (eases toward real health)
    this.healPulse = 0;
    this.twitch = 0;
    this.twitchDir = 1;
    this.breathT = 0;
    this.hits = [];
    this.hitSamples = m.mesh.geometry.userData.hitSamples || [];
    this._apply();
  }

  get forward() { return _v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get alive() { return this.state !== 'dead'; }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 10, this.pos.z); }

  // ---------------- input/update ----------------
  update(dt, input, cam) {
    const ctx = this.ctx;
    this.t += dt;
    this.camYaw = cam.yaw;
    this.aimPitch = cam.pitch;
    this.roarCd -= dt; this.stompCd -= dt; this.chargeCd -= dt;
    this.rage = Math.max(0, this.rage - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.invuln -= dt;
    this.reattachCd -= dt;

    this._updateCondition(dt);
    if (this.state === 'dead') {
      this.deathT += dt;
      this.vel.set(0, 0, 0);
      this._animate(dt);
      return;
    }

    // ---- read controls ----
    const fwdIn = input.move.y;
    const strafe = input.move.x;
    const sprint = input.down('sprint');

    if (this.state === 'climb') {
      this._updateClimb(dt, input);
    } else {
      this._updateMove(dt, input, fwdIn, strafe, sprint);
    }

    // ---- actions ----
    const busy = this.action && this.action.name !== 'hit';
    const lmb = input.hit('punch'), rmb = input.hit('smash');
    if (this.state === 'climb') {
      if (this.climb && !this.trans) {
        if (input.hit('jump')) this._wallJump();
        else if (input.hit('climb') && this.climb.attachT > 0.25) this._leaveClimb('drop');
        else if (!busy) {
          if (lmb) {
            if (this.held && !this.held.edible) this._start('climbThrow');
            else this._climbAttack();
          } else if (rmb) { if (this.held) this._dropHeld(); this._start('climbSmash'); }
          else if (input.hit('stomp')) this._start('climbKick');
          else if (input.hit('roar') && this.roarCd <= 0) { this.roarCd = 10; this._start('climbRoar'); }
          else if (input.hit('grab')) {
            if (this.held) this._start(this.held.edible ? 'climbEat' : 'climbThrow');
            else this._climbGrab();
          }
        }
      }
    } else {
      if (this.state === 'air') {
        if (rmb && !this.slamming) {
          // ground slam: dive down
          this.slamming = true;
          this.vel.y = Math.min(this.vel.y, -38);
          this.vel.x *= 0.5; this.vel.z *= 0.5;
          ctx.events.emit('slamStart', { p: this.pos.clone() });
        }
        if (lmb && !busy) this._start('punch', { side: this.punchSide = this.punchSide === 'L' ? 'R' : 'L' });
      } else {
        if (lmb) {
          if (this.held) { if (!busy) this._start('throw'); }
          else if (!busy) this._start('punch', { side: this.punchSide = this.punchSide === 'L' ? 'R' : 'L' });
          else if (this.action.name === 'punch' && this.action.t / this.action.dur > 0.45) this.queued = 'punch';
        }
        if (rmb && !busy) { if (this.held) this._dropHeld(); this._start('smash'); }
        if (input.hit('stomp') && !busy && this.stompCd <= 0) { this.stompCd = 0.9; this._start('stomp'); }
        if (input.hit('roar') && !busy && this.roarCd <= 0) { this.roarCd = 10; this._start('roar'); }
        if (input.hit('jump') && this.grounded && (!busy || this.action.name === 'punch')) this._jump();
      }
      if (input.hit('grab') && !busy) {
        if (this.held) this._start(this.held.edible ? 'eat' : 'throw');
        else this._start('grab');
      }
      if (input.hit('climb') && (this.state === 'ground' || this.state === 'air')) this._tryClimb();
    }

    this._updateAction(dt);
    this._animate(dt);
    this._syncBody();
  }

  _start(name, opts = {}) {
    const def = ACTIONS[name];
    this.action = { name, t: 0, dur: def.dur, hitAt: def.hit * def.dur, hitDone: false, upper: def.upper, ...opts };
    if (name === 'punch' || name === 'smash' || name === 'throw' || name === 'climbPunch') {
      // attacks swing the monster to face where the camera looks
      this.attackYaw = this.camYaw;
      this.assist = name === 'punch' || name === 'throw' ? this._assistTarget(name === 'throw' ? 160 : 26) : null;
      if (this.assist && this.state !== 'climb') this.attackYaw = Math.atan2(this.assist.x - this.pos.x, this.assist.z - this.pos.z);
    }
    if (name === 'roar') this.ctx.events.emit('roar', { p: this.pos.clone() });
    if (name === 'smash' || name === 'punch') this.ctx.events.emit('swing', { p: this.pos.clone(), heavy: name === 'smash' });
  }

  // Controller aim assist: pick the most threatening target near the camera's aim cone.
  _assistTarget(range) {
    const inp = this.ctx.input;
    const lt = this.leapTarget;
    if (this.state === 'air' && lt && lt.state === 'fly') return { x: lt.x, y: lt.y, z: lt.z, w: 3, air: true };
    if (!inp || inp.lastDevice !== 'pad' || !this.ctx.military) return null;
    const m = this.ctx.military;
    const cands = [];
    for (const h of m.helis) if (h.state === 'fly' && !h.held) cands.push({ x: h.x, y: h.y, z: h.z, w: 3, air: true });
    for (const t of m.tanks) if (t.hp > 0 && !t.held) cands.push({ x: t.x, y: t.y + 2, z: t.z, w: 2 });
    for (const s of m.soldiers) if (s.state === 'aim' || s.state === 'move') cands.push({ x: s.x, y: s.y + 1, z: s.z, w: 1 });
    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 1) continue;
      if (range < 50 && c.y - this.pos.y > 26) continue; // out of punching reach
      const off = Math.abs(angleDiff(this.camYaw, Math.atan2(dx, dz)));
      if (off > 0.75) continue;
      const score = c.w * 10 - d * 0.3 - off * 12;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  _updateAction(dt) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    if (a.attackTurn !== false && (a.name === 'punch' || a.name === 'smash' || a.name === 'throw') && this.state !== 'climb') {
      this.yaw = dampAngle(this.yaw, this.attackYaw, 14, dt);
    }
    if (!a.hitDone && a.t >= a.hitAt) {
      a.hitDone = true;
      this._resolveHit(a);
    }
    if (a.t >= a.dur) {
      this.action = null;
      if (this.queued === 'punch' && !this.held) {
        this.queued = null;
        this._start('punch', { side: this.punchSide = this.punchSide === 'L' ? 'R' : 'L' });
      }
      this.queued = null;
    }
  }

  // ---------------- movement ----------------
  _updateMove(dt, input, fwdIn, strafe, sprint) {
    const ctx = this.ctx;
    const cy = this.camYaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    const rx = -Math.cos(cy), rz = Math.sin(cy);
    let wx = fx * fwdIn + rx * strafe, wz = fz * fwdIn + rz * strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    // analog sticks: speed follows tilt (keyboard is always full tilt)
    const tilt = Math.min(1, input.move.mag);
    const act = this.action;
    const rooted = act && !act.upper;
    let target = (sprint ? GORILLA.runSpeed : GORILLA.walkSpeed) * (wl > 0 ? Math.max(0.35, tilt) : 0);
    if (rooted) target *= 0.15;
    if (act && act.name === 'punch') target *= 0.5;
    if (this.held && this.held.heavy) target *= 0.8;
    const control = this.state === 'air' ? 0.25 : 1;
    const accel = (wl > 0 ? GORILLA.accel : GORILLA.accel * 1.4) * control;
    const tvx = wx * target, tvz = wz * target;
    const dvx = tvx - this.vel.x, dvz = tvz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const step = Math.min(dl, accel * dt);
    if (dl > 0) { this.vel.x += (dvx / dl) * step; this.vel.z += (dvz / dl) * step; }

    // facing: heavy turn toward movement
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (wl > 0 && (!act || act.upper) && !(act && (act.name === 'punch' || act.name === 'throw'))) {
      const want = Math.atan2(wx, wz);
      const turn = GORILLA.turnRate * (sprint ? 0.7 : 1) * (this.state === 'air' ? 0.3 : 1);
      this.yaw = dampAngle(this.yaw, want, turn, dt);
    }
    this.speed = hs;

    // gravity / vertical
    this.vel.y += -34 * dt;
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const ny = this.pos.y + this.vel.y * dt;
    this.pos.x = nx; this.pos.z = nz;
    const pushed = this._collide();
    // flying into a wall while steering at it: grab on (re-attach after a leap)
    if (this.state === 'air' && pushed && this.reattachCd <= 0 && wl > 0 && this.vel.y < 14) {
      if (this._tryClimb({ auto: true, wish: { x: wx, z: wz } })) return;
    }
    // shoulder-charge: sprinting into a building smashes it
    if (pushed && sprint && hs > 14 && this.chargeCd <= 0 && this.state === 'ground') {
      this.chargeCd = 0.5;
      const p = this.chest.addScaledVector(this.forward, GORILLA.radius + 2);
      p.y = this.pos.y + 8;
      ctx.combat.strike(p, 6, 1.4, this.forward.clone(), 'charge');
      this.vel.multiplyScalar(0.25);
    }
    const ground = ctx.city.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, ny) + 4.2);
    if (ny <= ground) {
      if (this.state === 'air') this._land(-this.vel.y);
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
      this.state = 'ground';
    } else {
      this.pos.y = ny;
      if (ny > ground + 0.6) {
        this.grounded = false;
        if (this.state === 'ground' && this.vel.y < 0) this.state = 'air';
      } else if (this.state === 'ground') {
        // stick to small drops (rubble, stairs) instead of hopping
        this.pos.y = Math.max(ground, ny);
      }
    }
    // world bounds
    const lim = 420;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    this.ctx.city.groundHere = ground;
  }

  _collide() {
    const R = GORILLA.radius;
    const city = this.ctx.city;
    let pushed = false;
    const yLo = this.pos.y + 4.3, yHi = this.pos.y + 13;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of city.buildingsNear(this.pos.x, this.pos.z, R + 1)) {
        const S = CELL.size, H = CELL.height;
        const x0 = Math.max(0, Math.floor((this.pos.x - R - b.x0) / S)), x1 = Math.min(b.nx - 1, Math.floor((this.pos.x + R - b.x0) / S));
        const z0 = Math.max(0, Math.floor((this.pos.z - R - b.z0) / S)), z1 = Math.min(b.nz - 1, Math.floor((this.pos.z + R - b.z0) / S));
        const y0 = Math.max(0, Math.floor(yLo / H)), y1 = Math.min(b.ny - 1, Math.floor(yHi / H));
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          if (!b.alive[b.idx(x, y, z)]) continue;
          const minX = b.x0 + x * S, maxX = minX + S, minZ = b.z0 + z * S, maxZ = minZ + S;
          const cx = clamp(this.pos.x, minX, maxX), cz = clamp(this.pos.z, minZ, maxZ);
          let dx = this.pos.x - cx, dz = this.pos.z - cz;
          let d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d < 1e-4) {
            // centre inside the cell: push out the shortest way
            const opts = [[this.pos.x - minX, -1, 0], [maxX - this.pos.x, 1, 0], [this.pos.z - minZ, 0, -1], [maxZ - this.pos.z, 0, 1]];
            opts.sort((a, b2) => a[0] - b2[0]);
            dx = opts[0][1]; dz = opts[0][2]; d = 0;
            this.pos.x += dx * (opts[0][0] + R); this.pos.z += dz * (opts[0][0] + R);
          } else {
            const push = R - d;
            this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
            // kill velocity into the wall
            const nx = dx / d, nz = dz / d;
            const vn = this.vel.x * nx + this.vel.z * nz;
            if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
          }
          pushed = true;
        }
      }
    }
    return pushed;
  }

  _jump() {
    if (this.action && this.action.name === 'punch') this.action = null;
    this.vel.y = GORILLA.jumpVelocity;
    this.grounded = false;
    this.state = 'air';
    this.slamming = false;
    this.ctx.events.emit('jump', { p: this.pos.clone() });
  }

  _land(impactSpeed) {
    this.landT = 0;
    this.landK = clamp(impactSpeed / 30, 0.25, 1);
    const p = this.pos.clone();
    this.leapTarget = null;
    if (this.slamming) {
      this.slamming = false;
      this.ctx.combat.groundShock(p, 22, 1.6, 'slam');
      this.ctx.events.emit('slam', { p, power: 1.6 });
    } else if (impactSpeed > 16) {
      this.ctx.combat.groundShock(p, Math.min(26, 12 + impactSpeed * 0.2), Math.min(1.5, 0.5 + impactSpeed / 50), 'land');
      this.ctx.events.emit('land', { p, power: impactSpeed / 30 });
    } else {
      this.ctx.events.emit('step', { p, power: 0.5 });
    }
  }

  // ---------------- climbing ----------------
  // The monster clings to an axis-aligned facade plane. Position on the wall is (u, y): u runs
  // along the wall, y is the root height. Grip is probed against the live building cells, so
  // holes, collapses and corners all come from the same destruction data.
  _u() { return this.climb.nx !== 0 ? this.pos.z : this.pos.x; }
  _rightSign(c) { return c.nx !== 0 ? -c.nx : c.nz; } // +1 means "monster's right" increases u

  // point on/behind the plane: depth > 0 is inside the building, < 0 out in the street
  _pp(c, u, y, depth, out = _v) {
    if (c.nx !== 0) return out.set(c.wall - c.nx * depth, y, u);
    return out.set(u, y, c.wall - c.nz * depth);
  }
  _solidWall(c, u, y) {
    const city = this.ctx.city;
    this._pp(c, u, y, 2, _v);
    if (city.solidAt(_v.x, _v.y, _v.z)) return true;
    this._pp(c, u, y, 6, _v); // inner wall behind a punched-out facade cell still gives a hold
    return city.solidAt(_v.x, _v.y, _v.z);
  }
  // 0..15: how many hand/foot holds exist around the monster at (u, y)
  _grip(c, u, y) {
    let n = 0;
    for (const du of [-3, 0, 3]) for (const dy of [1, 5, 9, 13, 16]) if (this._solidWall(c, u + du, y + dy)) n++;
    return n;
  }
  _wallRow(c, u, y) {
    for (const du of [-3, 0, 3]) if (this._solidWall(c, u + du, y)) return true;
    return false;
  }
  // is the space the body occupies (out in front of the wall) free of other walls?
  _bodyFree(c, u, y) {
    const city = this.ctx.city;
    for (const dy of [3, 8, 13]) for (const d of [-1.2, -CLIMB_OFF]) {
      this._pp(c, u, y + dy, d, _v);
      if (city.solidAt(_v.x, _v.y, _v.z)) return false;
    }
    return true;
  }
  _rootFor(c, u, y, out = new THREE.Vector3()) { return this._pp(c, u, y, -CLIMB_OFF, out); }
  _faceYaw(c) { return Math.atan2(-c.nx, -c.nz); }

  _newClimb(nx, nz, wall, b) {
    return { b, nx, nz, wall, phase: 0, moving: 0, vy: 0, vu: 0, vdir: 1, slip: 0, attachT: 0 };
  }

  // Y / C: grab the nearest wall (from the street, mid-air or a roof edge).
  _tryClimb(opts = {}) {
    if (this.reattachCd > 0) return false;
    const city = this.ctx.city;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const fwd = this.forward;
    let best = null;
    for (const [dx, dz] of dirs) {
      if (opts.wish && dx * opts.wish.x + dz * opts.wish.z < 0.4) continue;
      for (let d = 1; d <= GORILLA.radius + 5; d += 0.5) {
        const px = this.pos.x + dx * d, pz = this.pos.z + dz * d;
        let hit = null;
        for (const hy of [7, 11, 3]) { hit = city.cellQuery(px, this.pos.y + hy, pz); if (hit) break; }
        if (hit) {
          const score = d - (fwd.x * dx + fwd.z * dz) * 3;
          if (!best || score < best.score) best = { score, dx, dz, b: hit.b, px, pz };
          break;
        }
      }
    }
    if (!best) {
      if (!opts.auto && this.state === 'ground' && this.pos.y > 2 && this._tryDescend()) return true;
      if (!opts.auto) this.ctx.events.emit('hint', { text: 'Get closer to a building to climb' });
      return false;
    }
    const b = best.b, S = CELL.size;
    let wall;
    if (best.dx === 1) wall = b.x0 + Math.floor((best.px - b.x0) / S) * S;
    else if (best.dx === -1) wall = b.x0 + (Math.floor((best.px - b.x0) / S) + 1) * S;
    else if (best.dz === 1) wall = b.z0 + Math.floor((best.pz - b.z0) / S) * S;
    else wall = b.z0 + (Math.floor((best.pz - b.z0) / S) + 1) * S;
    const c = this._newClimb(-best.dx, -best.dz, wall, b);
    const u = c.nx !== 0 ? this.pos.z : this.pos.x;
    let y = this.pos.y;
    // find a height where there is something to hold
    let ok = false;
    for (const dy of [0, 2, -2, 4, -4, 6]) {
      if (y + dy < -0.5) continue;
      if (this._grip(c, u, y + dy) >= 3 && this._bodyFree(c, u, y + dy)) { y += dy; ok = true; break; }
    }
    if (!ok) { if (!opts.auto) this.ctx.events.emit('hint', { text: 'Nothing to hold on to there' }); return false; }
    const to = this._rootFor(c, u, Math.max(0, y));
    this._beginTrans('attach', to, this._faceYaw(c), 0.22, c);
    this.state = 'climb';
    this.climb = c;
    this.vel.set(0, 0, 0);
    this.grounded = false;
    if (this.action && this.action.name !== 'hit') this.action = null;
    if (this.held && this.held.heavy) this._dropHeld();
    this.ctx.events.emit('climbStart', { p: this.pos.clone() });
    return true;
  }

  // Standing on a roof: Y climbs over the nearest edge and hangs on the facade below it.
  _tryDescend() {
    const city = this.ctx.city;
    const top = this.pos.y;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const fwd = this.forward;
    let best = null;
    for (const [dx, dz] of dirs) {
      for (let d = 1; d <= 9; d += 0.5) {
        const g = city.groundAt(this.pos.x + dx * d, this.pos.z + dz * d, top + 1);
        if (g < top - 3) {
          const score = d - (fwd.x * dx + fwd.z * dz) * 4;
          if (!best || score < best.score) best = { score, dx, dz, d };
          break;
        }
      }
    }
    if (!best) return false;
    const inner = city.cellQuery(this.pos.x + best.dx * (best.d - 0.75), top - 2, this.pos.z + best.dz * (best.d - 0.75));
    if (!inner) return false;
    const b = inner.b, S = CELL.size;
    const lx = this.pos.x + best.dx * (best.d - 0.75), lz = this.pos.z + best.dz * (best.d - 0.75);
    let wall;
    if (best.dx === 1) wall = b.x0 + (Math.floor((lx - b.x0) / S) + 1) * S;
    else if (best.dx === -1) wall = b.x0 + Math.floor((lx - b.x0) / S) * S;
    else if (best.dz === 1) wall = b.z0 + (Math.floor((lz - b.z0) / S) + 1) * S;
    else wall = b.z0 + Math.floor((lz - b.z0) / S) * S;
    const c = this._newClimb(best.dx, best.dz, wall, b);
    const u = c.nx !== 0 ? this.pos.z : this.pos.x;
    const y = Math.max(city.groundAt(this.pos.x + best.dx * (best.d + 4), this.pos.z + best.dz * (best.d + 4), top), top - 15);
    if (this._grip(c, u, y) < 3) return false;
    this.state = 'climb';
    this.climb = c;
    this.vel.set(0, 0, 0);
    this.action = null;
    this._beginTrans('descend', this._rootFor(c, u, y), this._faceYaw(c), 0.75, c);
    this.ctx.events.emit('climbStart', { p: this.pos.clone(), descend: true });
    return true;
  }

  _beginTrans(kind, to, yaw1, dur, c) {
    this.trans = { kind, from: this.pos.clone(), to: to.clone(), yaw0: this.yaw, yaw1, t: 0, dur, c };
  }

  _updateTrans(dt) {
    const tr = this.trans;
    tr.t += dt;
    const k = Math.min(1, tr.t / tr.dur);
    const e = k * k * (3 - 2 * k);
    const f = tr.from, to = tr.to;
    switch (tr.kind) {
      case 'mantle': {
        // haul up first, then roll forward onto the roof
        const ky = Math.min(1, k * 1.6);
        this.pos.set(f.x + (to.x - f.x) * Math.max(0, (k - 0.35) / 0.65), f.y + (to.y - f.y) * (1 - (1 - ky) * (1 - ky)) + Math.sin(k * Math.PI) * 1.2, f.z + (to.z - f.z) * Math.max(0, (k - 0.35) / 0.65));
        break;
      }
      case 'descend': {
        // step out over the edge, then swing down onto the facade
        const kx = Math.min(1, k * 1.8);
        const ky = Math.max(0, (k - 0.3) / 0.7);
        this.pos.set(f.x + (to.x - f.x) * kx, f.y + (to.y - f.y) * ky * ky, f.z + (to.z - f.z) * kx);
        break;
      }
      case 'corner': {
        // swing around the corner on an arc
        const mid = tr.mid;
        const a = 1 - e;
        this.pos.set(a * a * f.x + 2 * a * e * mid.x + e * e * to.x, f.y + (to.y - f.y) * e, a * a * f.z + 2 * a * e * mid.z + e * e * to.z);
        break;
      }
      default:
        this.pos.lerpVectors(f, to, e);
    }
    let dy = tr.yaw1 - tr.yaw0;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = tr.yaw0 + dy * e;
    if (k >= 1) {
      this.trans = null;
      this.yaw = tr.yaw1;
      if (tr.kind === 'mantle') {
        this.state = 'ground';
        this.grounded = true;
        this.climb = null;
        this.vel.set(0, 0, 0);
        this.landT = 0; this.landK = 0.45;
        this.ctx.events.emit('mantle', { p: this.pos.clone() });
      } else if (tr.c) {
        this.climb = tr.c;
      }
    }
  }

  _updateClimb(dt, input) {
    const c = this.climb;
    c.attachT += dt;
    if (this.trans) { this._updateTrans(dt); this.speed = 0; return; }
    const city = this.ctx.city;
    const rs = this._rightSign(c);
    let up = input.move.y, side = input.move.x;
    // keep "right on the stick" = right on screen, even with the camera swung around
    const camRx = -Math.cos(this.camYaw), camRz = Math.sin(this.camYaw);
    if (camRx * c.nz + camRz * -c.nx < -0.25) side = -side;
    const busy = this.action && this.action.name !== 'hit';
    const speed = GORILLA.climbSpeed * (input.down('sprint') ? 1.6 : 1) * (busy ? 0.12 : 1);
    c.vy = damp(c.vy, up * speed, 10, dt);
    c.vu = damp(c.vu, side * speed * 0.85, 10, dt);
    const u = this._u(), y = this.pos.y;
    let nu = u + c.vu * rs * dt;
    let ny = y + c.vy * dt;

    // ---- along the wall ----
    if (Math.abs(c.vu) > 0.05) {
      const dir = Math.sign(c.vu * rs);
      if (!this._bodyFree(c, nu + dir * 2.5, ny)) {
        if (Math.abs(side) > 0.5 && this._insideCorner(c, u, ny, dir)) return;
        nu = u; c.vu = 0;
      } else if (this._grip(c, nu + dir * 1.5, ny) < 3) {
        if (Math.abs(side) > 0.5 && this._outsideCorner(c, u, ny, dir)) return;
        nu = u; c.vu = 0;
      }
    }
    // ---- up / down ----
    // a hole above: reach over small gaps, or edge sideways to the nearest column that continues up
    if (c.vy > 0.05 && !this._wallRow(c, nu, ny + 16.5) && this._wallRow(c, nu, ny + 21) && this._grip(c, nu, ny) >= 3) {
      // hands reach over the gap: keep climbing
    } else if (c.vy > 0.05 && !this._wallRow(c, nu, ny + 16.5)) {
      let side = 0;
      for (const du of [4, -4, 8, -8]) {
        if (this._wallRow(c, nu + du, ny + 16.5) && this._bodyFree(c, nu + du, ny) && this._grip(c, nu + du, ny) >= 3) { side = du; break; }
      }
      const top0 = city.groundAt(this._pp(c, nu, 0, 4, _v2).x, _v2.z, ny + 22);
      if (side !== 0 && !(top0 > ny + 3 && top0 < ny + 21)) {
        nu += Math.sign(side) * GORILLA.climbSpeed * 0.8 * dt;
        ny = y + c.vy * 0.3 * dt;
      }
    }
    if (c.vy > 0.05 && !this._wallRow(c, nu, ny + 16.5) && !this._wallRow(c, nu, ny + 21)) {
      // hands have run out of wall: a roof to haul onto?
      this._pp(c, nu, 0, 4, _v2);
      const top = city.groundAt(_v2.x, _v2.z, ny + 22);
      if (top > ny + 3 && top < ny + 21) {
        if (up > 0.3) { this._startMantle(c, nu, top); return; }
        ny = y; c.vy = 0;
      } else if (this._grip(c, nu, ny) < 4) { ny = y; c.vy = 0; }
    }
    if (c.vy < -0.05) {
      const root = this._rootFor(c, nu, ny, _v2);
      const ground = city.groundAt(root.x, root.z, y + 1);
      if (ny <= ground) {
        ny = ground;
        c.vy = 0;
        if (up < -0.5 && c.attachT > 0.4) { this._leaveClimb('ground'); return; }
      }
    }
    if (!this._bodyFree(c, nu, ny)) { nu = u; ny = y; c.vu = 0; c.vy = 0; }
    if (this._grip(c, nu, ny) === 0) { nu = u; ny = y; }
    this._rootFor(c, nu, ny, this.pos);
    this.yaw = dampAngle(this.yaw, this._faceYaw(c), 12, dt);

    // ---- holding on: react to the wall being destroyed under the hands ----
    const grip = this._grip(c, nu, this.pos.y);
    if (grip === 0) { if (!this._regrip(c)) this._leaveClimb('lost'); return; }
    if (grip < 3) {
      c.slip += dt;
      const g2 = city.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
      this.pos.y = Math.max(g2, this.pos.y - 5 * dt);
      if (c.slip > 0.05 && c.slip - dt <= 0.05) this.ctx.events.emit('slip', { p: this.pos.clone() });
      if (c.slip > 0.5 && this._regrip(c)) return;
      if (c.slip > 1.6) { this._leaveClimb('lost'); return; }
    } else c.slip = Math.max(0, c.slip - dt * 2);

    const mv = Math.abs(c.vy) + Math.abs(c.vu);
    c.moving = damp(c.moving, Math.min(1, mv / GORILLA.climbSpeed), 8, dt);
    c.phase += (dt * mv) / 8;
    if (Math.abs(c.vy) > 0.3) c.vdir = c.vy > 0 ? 1 : -1;
    // hand-over-hand thumps on the facade
    const step = Math.floor(c.phase * 2);
    if (step !== c.lastStep) { c.lastStep = step; if (mv > 1) this.ctx.events.emit('climbStep', { p: this.chest }); }
    this.speed = 0;
  }

  // The hold under the hands was smashed away: lunge to the nearest solid hold (below or to the
  // side first, like a real climber), or fall if there is nothing within reach.
  _regrip(c) {
    const u = this._u(), y = this.pos.y;
    for (const [du, dy] of [[0, -4], [-4, 0], [4, 0], [-4, -4], [4, -4], [0, -8], [-8, 0], [8, 0], [0, 4], [-8, -6], [8, -6], [0, -12]]) {
      if (y + dy < 0) continue;
      if (this._grip(c, u + du, y + dy) >= 4 && this._bodyFree(c, u + du, y + dy)) {
        this._beginTrans('attach', this._rootFor(c, u + du, y + dy), this._faceYaw(c), 0.28, c);
        c.slip = 0;
        this.ctx.events.emit('regrip', { p: this.chest });
        return true;
      }
    }
    return false;
  }

  _startMantle(c, u, top) {
    this._pp(c, u, top, 4.2, _v2);
    const to = new THREE.Vector3(_v2.x, top, _v2.z);
    this._beginTrans('mantle', to, this._faceYaw(c), 0.6, null);
    this.ctx.events.emit('mantleStart', { p: to.clone() });
  }

  _outsideCorner(c, u, y, dir) {
    // the wall ends: find its edge along u, then try the face around the corner
    let e = u;
    for (let k = 0; k < 24 && this._wallRow(c, e + dir * 0.5, y + 8) && this._solidWall(c, e + dir * 0.5, y + 8); k++) e += dir * 0.5;
    const S = CELL.size;
    const edge = Math.round(e / S) * S; // facade edges sit on the cell grid
    let nx, nz;
    if (c.nx !== 0) { nx = 0; nz = dir; } else { nx = dir; nz = 0; }
    const nc = this._newClimb(nx, nz, edge + (c.b ? 0 : 0), c.b);
    // gridded relative to the building origin
    const b = c.b;
    if (b) {
      if (nx !== 0) nc.wall = b.x0 + Math.round((edge - b.x0) / S) * S;
      else nc.wall = b.z0 + Math.round((edge - b.z0) / S) * S;
    }
    const nu = c.wall - (c.nx !== 0 ? c.nx : c.nz) * 3; // 3 m around the corner, along the new face
    if (this._grip(nc, nu, y) < 3 || !this._bodyFree(nc, nu, y)) return false;
    const to = this._rootFor(nc, nu, y);
    this._beginTrans('corner', to, this._faceYaw(nc), 0.45, nc);
    const cp = c.nx !== 0 ? new THREE.Vector3(c.wall, y, nc.wall) : new THREE.Vector3(nc.wall, y, c.wall);
    this.trans.mid = cp.add(new THREE.Vector3(c.nx + nx, 0, c.nz + nz).multiplyScalar(CLIMB_OFF * 1.3));
    this.ctx.events.emit('climbCorner', { p: this.pos.clone() });
    return true;
  }

  _insideCorner(c, u, y, dir) {
    // a perpendicular wall blocks the way: turn onto it
    let f = u;
    for (let k = 0; k < 24 && this._bodyFree(c, f + dir * 0.5, y); k++) f += dir * 0.5;
    const S = CELL.size;
    const hit = this.ctx.city.cellQuery(...this._pp(c, f + dir * (CLIMB_OFF + 1), y + 8, -CLIMB_OFF * 0.5, new THREE.Vector3()).toArray());
    const b = hit ? hit.b : c.b;
    let nx, nz;
    if (c.nx !== 0) { nx = 0; nz = -dir; } else { nx = -dir; nz = 0; }
    const wallGuess = f + dir * (CLIMB_OFF + 0.5);
    const wall = nx !== 0 ? b.x0 + Math.round((wallGuess - b.x0) / S) * S : b.z0 + Math.round((wallGuess - b.z0) / S) * S;
    const nc = this._newClimb(nx, nz, wall, b);
    const nu = c.wall + (c.nx !== 0 ? c.nx : c.nz) * CLIMB_OFF;
    if (this._grip(nc, nu, y) < 3 || !this._bodyFree(nc, nu, y)) return false;
    this._beginTrans('corner', this._rootFor(nc, nu, y), this._faceYaw(nc), 0.4, nc);
    this.trans.mid = this.pos.clone().lerp(this.trans.to, 0.5).add(new THREE.Vector3(c.nx + nx, 0, c.nz + nz).multiplyScalar(0.8));
    this.ctx.events.emit('climbCorner', { p: this.pos.clone() });
    return true;
  }

  // Leave the wall. how: 'jump' | 'drop' | 'lost' | 'ground'
  _leaveClimb(how = 'drop') {
    const c = this.climb;
    this.trans = null;
    if (how === 'ground') {
      this.state = 'ground';
      this.grounded = true;
      this.vel.set(c ? c.nx * 2 : 0, 0, c ? c.nz * 2 : 0);
    } else {
      this.state = 'air';
      this.grounded = false;
      if (c) this.vel.set(c.nx * (how === 'lost' ? 5 : 4), how === 'lost' ? -3 : 0, c.nz * (how === 'lost' ? 5 : 4));
      this.reattachCd = how === 'lost' ? 0.7 : 0.45;
    }
    if (how === 'lost') this.ctx.events.emit('lostGrip', { p: this.pos.clone() });
    if (this.action && this.action.name.startsWith('climb')) this.action = null;
    this.climb = null;
  }

  // A: leap off the wall, toward a helicopter if one is in view and in range.
  _wallJump() {
    const c = this.climb;
    const chest = this.chest;
    let target = null, best = 1e9;
    const m = this.ctx.military;
    if (m) {
      const cf = this.ctx.cameraRig ? this.ctx.cameraRig.lookDir : new THREE.Vector3(c.nx, 0, c.nz);
      for (const h of m.helis) {
        if (h.state !== 'fly' || h.held) continue;
        _v2.set(h.x - chest.x, h.y - chest.y, h.z - chest.z);
        const d = _v2.length();
        const outward = (_v2.x * c.nx + _v2.z * c.nz) / d;
        if (d > 55 || outward < 0) continue;
        const cos = _v2.dot(cf) / d;
        // aimed at with the camera, or simply hovering close off the facade
        if (cos < 0.55 && !(d < 36 && outward > 0.3)) continue;
        const score = d - cos * 15;
        if (score < best) { best = score; target = h; }
      }
    }
    this._leaveClimb('jump');
    if (target) {
      // ballistic leap that peaks near the chopper
      const lead = new THREE.Vector3(target.x + target.vx * 0.5, target.y - 6, target.z + target.vz * 0.5);
      const dir = lead.sub(chest);
      const flat = Math.hypot(dir.x, dir.z);
      const T = Math.max(0.55, Math.min(1.3, flat / 30));
      this.vel.set(dir.x / T, dir.y / T + 17 * T, dir.z / T);
      this.yaw = Math.atan2(dir.x, dir.z);
      this.leapTarget = target;
    } else {
      const cf = this.ctx.cameraRig ? this.ctx.cameraRig.lookDir : new THREE.Vector3();
      this.vel.set(c.nx * 15 + cf.x * 5, 16, c.nz * 15 + cf.z * 5);
      this.yaw = Math.atan2(c.nx, c.nz);
      this.leapTarget = null;
    }
    this.ctx.events.emit('jump', { p: this.pos.clone(), wall: true });
  }

  // Where on the facade an attack lands (world space), at the monster's actual height.
  _wallPoint(c, side, heightAboveRoot, depth = 1.5) {
    const rs = this._rightSign(c);
    const u = this._u() + side * 1.8 * rs;
    return this._pp(c, u, this.pos.y + heightAboveRoot, depth, new THREE.Vector3());
  }

  // ---------------- combat ----------------
  _resolveHit(a) {
    const ctx = this.ctx;
    const fwd = this.forward.clone();
    const rageK = this.rage > 0 ? 1.5 : 1;
    this._updateHands();
    switch (a.name) {
      case 'punch': {
        this.stats.punches++;
        const hand = a.side === 'L' ? this.handL : this.handR;
        const p = hand.clone().addScaledVector(fwd, 2.2);
        p.y += this.aimPitch * 6;
        if (this.assist) {
          // pull the blow onto the assisted target if it is within arm's reach (jumping helps for choppers)
          const tp = new THREE.Vector3(this.assist.x, this.assist.y, this.assist.z);
          if (tp.distanceTo(p) < 17) p.lerp(tp, 0.9);
        }
        const res = ctx.combat.strike(p, 4.6, 1.15 * rageK, fwd, 'punch');
        this.vel.addScaledVector(fwd, 3);
        if (!res.hitSomething) ctx.events.emit('whiff', { p });
        break;
      }
      case 'climbPunch': {
        // the blow lands on the facade right where the monster hangs (not at street level)
        const c = this.climb;
        if (!c) break;
        this.stats.punches++;
        const into = new THREE.Vector3(-c.nx, 0, -c.nz);
        const p = this._wallPoint(c, a.side === 'L' ? -1 : 1, 11.5 + a.aim * 5.5, 1.6);
        const res = ctx.combat.strike(p, 4.6, 1.2 * rageK, into, 'punch');
        if (!res.hitSomething) ctx.events.emit('whiff', { p });
        ctx.events.emit('climbHit', { p, heavy: false, destroyed: res.destroyed });
        break;
      }
      case 'climbSmash': {
        const c = this.climb;
        if (!c) break;
        const into = new THREE.Vector3(-c.nx, -0.3, -c.nz).normalize();
        const hi = this._wallPoint(c, 0.6, 9.5, 2.2), lo = this._wallPoint(c, 0.4, 4.5, 2.2);
        const r1 = ctx.combat.strike(hi, 6.2, 2.0 * rageK, into, 'smash');
        const r2 = ctx.combat.strike(lo, 5.6, 1.85 * rageK, into, 'smash');
        ctx.fx.addShake(1.0);
        ctx.events.emit('climbHit', { p: hi, heavy: true, destroyed: r1.destroyed + r2.destroyed });
        break;
      }
      case 'climbKick': {
        const c = this.climb;
        if (!c) break;
        const into = new THREE.Vector3(-c.nx, 0, -c.nz);
        const p1 = this._wallPoint(c, 0, 2, 1.6), p2 = this._wallPoint(c, 0, -2.2, 1.6);
        const r1 = ctx.combat.strike(p1, 5.4, 1.6 * rageK, into, 'smash');
        const r2 = ctx.combat.strike(p2, 4.6, 1.2 * rageK, into, 'punch');
        ctx.events.emit('climbHit', { p: p1, heavy: true, destroyed: r1.destroyed + r2.destroyed });
        break;
      }
      case 'climbSwat': {
        const h = a.target;
        if (h && h.state === 'fly' && this.chest.distanceTo(new THREE.Vector3(h.x, h.y, h.z)) < 24) {
          const dir = new THREE.Vector3(h.x - this.pos.x, 0, h.z - this.pos.z).normalize();
          ctx.combat.strike(new THREE.Vector3(h.x, h.y, h.z), 3, 1.6 * rageK, dir, 'punch');
        } else ctx.events.emit('whiff', { p: this.chest });
        break;
      }
      case 'climbGrab': {
        const g = a.cand ? a.cand.take() : null;
        if (g) {
          this.held = g;
          g.attach(this);
          ctx.events.emit('grab', { kind: g.kind, high: true });
        } else ctx.events.emit('whiff', { p: this.chest });
        break;
      }
      case 'climbRoar': {
        this.rage = 9;
        ctx.combat.roar(this.chest);
        break;
      }
      case 'smash': {
        const base = this.pos.clone().addScaledVector(fwd, GORILLA.radius + 6);
        // the blow travels down the facade in front, then into the street
        const hi = base.clone(); hi.y = this.pos.y + 9;
        const lo = base.clone(); lo.y = this.pos.y + 3;
        ctx.combat.strike(hi, 6.5, 1.9 * rageK, new THREE.Vector3(fwd.x, -0.6, fwd.z).normalize(), 'smash');
        ctx.combat.strike(lo, 6.5, 2.1 * rageK, new THREE.Vector3(fwd.x, -0.3, fwd.z).normalize(), 'smash');
        ctx.combat.groundShock(new THREE.Vector3(base.x, this.pos.y, base.z), 16, 1.0 * rageK, 'smash');
        break;
      }
      case 'stomp': {
        const foot = this.pos.clone().addScaledVector(fwd, 2);
        ctx.combat.groundShock(foot, 20, 1.15 * rageK, 'stomp');
        break;
      }
      case 'roar': {
        this.rage = 9;
        ctx.combat.roar(this.pos.clone());
        break;
      }
      case 'grab': {
        const reach = this.pos.clone().addScaledVector(fwd, GORILLA.radius + 4);
        reach.y = this.pos.y;
        const g = ctx.combat.findGrabbable(reach, this.pos, fwd);
        if (g) {
          this.held = g;
          g.attach(this);
          ctx.events.emit('grab', { kind: g.kind });
        } else ctx.events.emit('whiff', { p: reach });
        break;
      }
      case 'climbEat':
      case 'eat': {
        if (this.held && this.held.edible) {
          const heal = this.held.heal || 8;
          this.heal(heal);
          this.stats.eaten++;
          this.held.consume();
          this.held = null;
          ctx.events.emit('eat', { heal, p: this.chest });
        }
        break;
      }
      case 'climbThrow':
      case 'throw': {
        if (this.held) {
          const aim = this.assist ? new THREE.Vector3(this.assist.x, this.assist.y, this.assist.z) : ctx.cameraRig.aimPoint(220);
          const from = this.handR.clone();
          const dir = aim.clone().sub(from);
          const dist = dir.length();
          dir.normalize();
          const speed = 70;
          const t = dist / speed;
          const vel = dir.multiplyScalar(speed);
          vel.y += 0.5 * 30 * t * 0.85; // arc compensation
          this.held.release(from, vel);
          this.held = null;
          ctx.events.emit('throw', { p: from });
        }
        break;
      }
    }
  }

  // RT on the wall: punch the facade, or backhand a helicopter that is within reach.
  _climbAttack() {
    const c = this.climb;
    const side = this.punchSide = this.punchSide === 'L' ? 'R' : 'L';
    const chest = this.chest;
    const m = this.ctx.military;
    let heli = null, best = 1e9;
    if (m) {
      for (const h of m.helis) {
        if (h.state !== 'fly' || h.held) continue;
        const dx = h.x - chest.x, dy = h.y - chest.y, dz = h.z - chest.z;
        const d = Math.hypot(dx, dy, dz);
        // reachable: close, out in front of the facade (behind the monster's back)
        if (d < 20 && dx * c.nx + dz * c.nz > -2 && d < best) { best = d; heli = h; }
      }
    }
    if (heli) {
      const rs = this._rightSign(c);
      const lateral = (c.nx !== 0 ? heli.z - this.pos.z : heli.x - this.pos.x) * rs;
      this._start('climbSwat', { side: lateral >= 0 ? 'R' : 'L', target: heli, aim: clamp((heli.y - chest.y) / 10, -1, 1) });
    } else {
      // aim up/down the wall with the camera pitch
      this._start('climbPunch', { side, aim: clamp(this.aimPitch * 1.8 + 0.15, -1, 1) });
    }
  }

  // X on the wall: reach into a window for a person (or snatch a hovering chopper).
  _climbGrab() {
    const c = this.climb;
    const chest = this.chest;
    const ctx = this.ctx;
    const cands = [];
    if (ctx.windows) cands.push(...ctx.windows.grabCandidates(this.pos, c, 12));
    if (ctx.military) {
      for (const g of ctx.military.grabCandidates(new THREE.Vector3(chest.x, this.pos.y + 4, chest.z), 9)) if (g.kind === 'heli' || g.kind === 'soldier') cands.push(g);
    }
    let best = null, bd = 1e9;
    for (const g of cands) {
      const d = g.pos.distanceTo(chest) - (g.edible ? 2 : 0);
      if (d < bd && g.pos.distanceTo(chest) < 13) { bd = d; best = g; }
    }
    const rs = this._rightSign(c);
    let sideK = 0.5, hK = 0;
    if (best) {
      const lat = (c.nx !== 0 ? best.pos.z - this.pos.z : best.pos.x - this.pos.x) * rs;
      sideK = clamp(lat / 7, -1, 1);
      hK = clamp((best.pos.y - (this.pos.y + 11)) / 6, -1, 1);
    }
    this._start('climbGrab', { cand: best, sideK, hK });
  }

  _dropHeld() {
    if (!this.held) return;
    const h = this.held;
    this.held = null;
    h.release(this.handR.clone(), this.forward.clone().multiplyScalar(4).add(new THREE.Vector3(0, 2, 0)));
  }

  damage(amount, from, pos = null) {
    if (this.state === 'dead' || this.invuln > 0) return;
    this.health -= amount;
    this.twitch = Math.min(1, this.twitch + 0.35 + amount * 0.1);
    this.twitchDir = Math.random() < 0.5 ? -1 : 1;
    if (pos) this._addHitSplat(pos, amount);
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 10);
    this.ctx.events.emit('hurt', { amount, from });
    if ((amount >= 4 || (amount >= 2 && this.woundVis > 0.6)) && (!this.action || this.action.name === 'hit')) this._start('hit');
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'dead';
      this.action = null;
      if (this.held) this._dropHeld();
      this.ctx.events.emit('gorillaDeath', { p: this.pos.clone() });
    }
  }

  heal(v) {
    this.health = Math.min(GORILLA.maxHealth, this.health + v);
    this.healPulse = 1;
    // fresh wounds close up first
    for (const h of this.hits) h.w *= 0.45;
  }

  // Leave a localized wound where the shot landed: pick the rest-pose surface sample whose normal
  // best faces the attacker (in the gorilla's own frame), favouring visible areas.
  _addHitSplat(worldPos, amount) {
    if (!this.hitSamples.length) return;
    const dx = worldPos.x - this.pos.x, dz = worldPos.z - this.pos.z;
    const c = Math.cos(-this.yaw), sn = Math.sin(-this.yaw);
    const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    const ly = (worldPos.y - this.pos.y) / GORILLA.modelScale;
    const len = Math.hypot(lx, lz) || 1;
    let best = null, bs = -1e9;
    for (let k = 0; k < 24; k++) {
      const smp = this.hitSamples[Math.floor(Math.random() * this.hitSamples.length)];
      const facing = (smp[3] * lx + smp[5] * lz) / len;
      const score = facing * 1.5 - Math.abs(smp[1] - Math.min(1.6, Math.max(0.6, ly))) + smp[6] * 0.8;
      if (score > bs) { bs = score; best = smp; }
    }
    const w = Math.min(1, 0.35 + amount * 0.12);
    if (this.hits.length >= 10) this.hits.sort((a, b) => a.w - b.w).shift();
    this.hits.push({ x: best[0], y: best[1], z: best[2], w });
  }

  // Push condition into the material and keep the body language in sync with health.
  _updateCondition(dt) {
    const sev = 1 - this.health / GORILLA.maxHealth;
    // damage shows immediately; recovery from feeding is gradual and visible
    this.woundVis = sev > this.woundVis ? damp(this.woundVis, sev, 6, dt) : damp(this.woundVis, sev, 0.9, dt);
    this.healPulse = Math.max(0, this.healPulse - dt * 0.6);
    this.twitch = Math.max(0, this.twitch - dt * 4);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      h.w -= dt * (0.004 + this.healPulse * 0.35 + (sev < 0.15 ? 0.05 : 0));
      if (h.w <= 0) this.hits.splice(i, 1);
    }
    const u = this.model.material.userData.u;
    if (u) {
      u.uWound.value = this.state === 'dead' ? Math.max(this.woundVis, 0.95) : this.woundVis;
      u.uHeal.value = this.healPulse;
      u.uRage.value = this.rage > 0 ? 1 : 0;
      for (let i = 0; i < 10; i++) {
        const h = this.hits[i];
        if (h) u.uHits.value[i].set(h.x, h.y, h.z, h.w); else u.uHits.value[i].set(0, -10, 0, 0);
      }
    }
    // breathing rhythm: slow and deep when healthy, quick and ragged when hurt
    const rate = 0.42 + this.woundVis * 0.75 + (this.speed > 12 ? 0.25 : 0);
    const prev = this.breathT;
    this.breathT += dt * rate;
    if (Math.floor(this.breathT) !== Math.floor(prev) && this.state !== 'dead') {
      this.ctx.events.emit('breath', { p: this.chest, sev: this.woundVis, exert: this.speed > 12 || !!this.action });
    }
  }

  // Additive body language: breathing, hunched/swaying posture when hurt, pain twitches.
  _conditionPose(out) {
    const sev = this.woundVis;
    const ph = this.breathT * Math.PI * 2;
    const br = Math.sin(ph) * (0.025 + 0.06 * sev);
    out.add('chest', br, 0, 0);
    out.add('spine', br * 0.4, 0, 0);
    out.add('clavL', 0, 0, br * 0.6);
    out.add('clavR', 0, 0, -br * 0.6);
    out.add('jaw', Math.max(0, Math.sin(ph)) * 0.12 * sev, 0, 0);
    if (this.state === 'ground' || this.state === 'air') {
      // proud when healthy, hunched and head-down when beaten
      out.add('hips', sev * 0.16 - (1 - sev) * 0.03, 0, 0);
      out.add('neck', sev * 0.22 - (1 - sev) * 0.06, 0, 0);
      if (sev > 0.65) {
        const sway = Math.sin(this.t * 1.1) * 0.05 * (sev - 0.5);
        out.add('hips', 0, sway, sway);
        out.add('head', 0, 0, sway * 1.5);
      }
    }
    if (this.twitch > 0) {
      const k = this.twitch;
      out.add('chest', -0.12 * k, 0.1 * k * this.twitchDir, 0.06 * k * this.twitchDir);
      out.add('neck', 0.12 * k, 0, 0);
    }
  }


  // ---------------- animation ----------------
  _animate(dt) {
    const base = this.base;
    const s = GORILLA.modelScale;
    if (this.state === 'dead') {
      Poses.death(this.out, this.deathT);
    } else if (this.state === 'climb') {
      const c = this.climb || (this.trans && this.trans.c);
      const tr = this.trans;
      const k = tr ? Math.min(1, tr.t / tr.dur) : 0;
      if (tr && tr.kind === 'mantle') Poses.mantle(base, k);
      else if (tr && tr.kind === 'descend') Poses.mantle(base, 1 - k);
      else Poses.climb(base, c ? c.phase + (tr ? k * 0.5 : 0) : 0, tr ? 1 : c ? c.moving : 0, c ? c.vdir : 1);
      this.out.copy(base);
      if (this.held && !this.action) {
        // carry the snack in the right hand, hold on with the left
        Poses.climbEat(this.tmp, 0.12, base);
        this.out.copy(this.tmp);
      }
    } else {
      // locomotion blend
      const sp = this.speed;
      const walkK = clamp(sp / GORILLA.walkSpeed, 0, 1);
      const runK = clamp((sp - GORILLA.walkSpeed) / (GORILLA.runSpeed - GORILLA.walkSpeed), 0, 1);
      const stride = 9 + runK * 6; // metres per cycle
      if (this.grounded) this.phase = (this.phase + (sp / stride) * dt) % 1;
      Poses.idle(base, this.t);
      if (walkK > 0.01) {
        Poses.walk(this.tmp, this.phase, Math.min(1, 0.4 + walkK * 0.6));
        base.lerp(this.tmp, walkK);
      }
      if (runK > 0.01) {
        Poses.run(this.tmp, this.phase);
        base.lerp(this.tmp, runK);
      }
      if (this.state === 'air') {
        Poses.air(this.tmp, this.vel.y);
        base.lerp(this.tmp, 0.9);
      }
      this.landT += dt;
      if (this.landT < 0.45) {
        const k = Math.sin((this.landT / 0.45) * Math.PI) * this.landK;
        Poses.land(this.tmp, 1);
        base.lerp(this.tmp, k);
      }
      // footfall events
      const contactPhases = runK > 0.5 ? [0.2, 0.7] : [0.0, 0.5];
      for (const cp of contactPhases) {
        const prev = this.lastStepPhase, cur = this.phase;
        const crossed = prev <= cur ? prev < cp && cur >= cp : prev < cp || cur >= cp;
        if (crossed && this.grounded && sp > 2) {
          this._updateHands();
          this.ctx.events.emit('step', { p: this.pos.clone(), power: 0.35 + runK * 0.65, hand: this.handL.clone() });
        }
      }
      this.lastStepPhase = this.phase;
      this.out.copy(base);
      if (this.held && !this.action) {
        Poses.hold(this.tmp, base);
        this.out.lerpMasked(this.tmp, 1, UPPER);
      }
    }
    // action overlay
    const a = this.action;
    if (a && this.state !== 'dead') {
      const t = a.t / a.dur;
      const holdBase = this.held ? Poses.hold(this.tmp.clear(), this.out) : this.out;
      switch (a.name) {
        case 'punch': {
          Poses.punch(this.act, t, a.side, this.out);
          // aim the strike up/down with the camera
          let pitch = this.aimPitch;
          if (this.assist) pitch = Math.max(pitch, Math.min(0.9, Math.atan2(this.assist.y - (this.pos.y + 11), 12)));
          this.act.addSide('upperArm', a.side, -pitch * 0.9 * Math.sin(Math.min(1, t * 2) * Math.PI * 0.5), 0, 0);
          break;
        }
        case 'smash': Poses.smash(this.act, t, this.out); break;
        case 'stomp': Poses.stomp(this.act, t, this.out); break;
        case 'roar': Poses.roar(this.act, t, this.out); break;
        case 'grab': Poses.grab(this.act, t, this.out); break;
        case 'eat': Poses.eat(this.act, t, holdBase); break;
        case 'throw': Poses.throw(this.act, t, holdBase); break;
        case 'climbPunch': Poses.climbPunch(this.act, t, a.side, this.out, a.aim || 0); break;
        case 'climbSmash': Poses.climbSmash(this.act, t, this.out); break;
        case 'climbKick': Poses.climbKick(this.act, t, this.out); break;
        case 'climbGrab': Poses.climbGrab(this.act, t, this.out, a.sideK ?? 0.5, a.hK ?? 0); break;
        case 'climbEat': Poses.climbEat(this.act, t, this.out); break;
        case 'climbSwat': Poses.climbSwat(this.act, t, a.side, this.out, a.aim || 0); break;
        case 'climbThrow': Poses.climbSwat(this.act, t, 'R', this.out, 0.3); break;
        case 'climbRoar': Poses.climbRoar(this.act, t, this.out); break;
        case 'hit': Poses.hit(this.act, t, this.out); break;
      }
      const fadeIn = Math.min(1, a.t / 0.06), fadeOut = Math.min(1, (a.dur - a.t) / 0.12);
      const w = Math.min(fadeIn, fadeOut);
      if (a.upper && this.speed > 1) this.out.lerpMasked(this.act, w, UPPER);
      else this.out.lerp(this.act, w);
    }
    // look toward the camera's aim (alive, not in big actions)
    if (this.state !== 'dead') {
      const want = this.state === 'climb' ? 0 : clamp(angleDiff(this.yaw, this.camYaw), -0.9, 0.9);
      this.headYaw = damp(this.headYaw, want, 5, dt);
      this.out.add('neck', 0, this.headYaw * 0.4, 0);
      this.out.add('head', -this.aimPitch * 0.3, this.headYaw * 0.4, 0);
      if (this.hurtFlash > 0) this.out.add('jaw', this.hurtFlash * 0.3, 0, 0);
      this._conditionPose(this.out);
    }
    applyPose(this.model.bones, this.out, this.model.rest);
    this._apply();
    void s;
  }

  _apply() {
    this.object.position.copy(this.pos);
    // slight lean into turns/acceleration
    this.object.rotation.set(0, this.yaw, 0);
    this.object.updateMatrixWorld(true);
  }

  _updateHands() {
    this.object.updateMatrixWorld(true);
    this.handL.setFromMatrixPosition(this.model.bones.handL.matrixWorld);
    this.handR.setFromMatrixPosition(this.model.bones.handR.matrixWorld);
  }

  _syncBody() {
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 7.5, z: this.pos.z });
  }

  // world-space position of the right hand grip (for held objects)
  gripMatrix(out) {
    const hb = this.model.bones.handR;
    out.copy(hb.matrixWorld);
    return out;
  }

  dispose() {
    this.ctx.root.remove(this.object);
    this.model.material.dispose();
  }
}

export { ACTIONS };
