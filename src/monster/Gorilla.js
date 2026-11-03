import * as THREE from 'three';
import { GORILLA, CELL } from '../config.js';
import { instantiateGorilla } from './GorillaModel.js';
import { Pose, Poses, applyPose, UPPER, BI } from './GorillaAnimator.js';
import { clamp, damp, dampAngle, angleDiff } from '../core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Action definitions: duration (s), normalized hit time, whether legs keep locomotion.
const ACTIONS = {
  punch: { dur: 0.56, hit: 0.42, upper: true },
  smash: { dur: 1.0, hit: 0.48, upper: false },
  stomp: { dur: 0.95, hit: 0.48, upper: false },
  roar: { dur: 2.5, hit: 0.2, upper: false },
  grab: { dur: 0.62, hit: 0.45, upper: true },
  eat: { dur: 1.25, hit: 0.5, upper: true },
  throw: { dur: 0.7, hit: 0.46, upper: true },
  climbPunch: { dur: 0.5, hit: 0.42, upper: false },
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
      this._updateClimb(dt, input, fwdIn, strafe);
    } else {
      this._updateMove(dt, input, fwdIn, strafe, sprint);
    }

    // ---- actions ----
    const busy = this.action && this.action.name !== 'hit';
    const lmb = input.hit('punch'), rmb = input.hit('smash');
    if (this.state === 'climb') {
      if (lmb && !busy) this._start('climbPunch', { side: this.punchSide = this.punchSide === 'L' ? 'R' : 'L' });
      if (rmb && !busy) this._start('climbPunch', { side: this.punchSide = this.punchSide === 'L' ? 'R' : 'L', heavy: true });
    } else if (this.state === 'air') {
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
      if (this.held) {
        if (this.held.edible) this._start('eat');
        else this._start('throw');
      } else if (this.state !== 'climb') {
        this._start('grab');
      }
    }
    if (input.hit('climb')) {
      if (this.state === 'climb') this._leaveClimb(false);
      else if (this.state === 'ground' || this.state === 'air') this._tryClimb();
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
    if (this.slamming) {
      this.slamming = false;
      this.ctx.combat.groundShock(p, 22, 1.6, 'slam');
      this.ctx.events.emit('slam', { p, power: 1.6 });
    } else if (impactSpeed > 16) {
      this.ctx.combat.groundShock(p, 12 + impactSpeed * 0.2, 0.5 + impactSpeed / 50, 'land');
      this.ctx.events.emit('land', { p, power: impactSpeed / 30 });
    } else {
      this.ctx.events.emit('step', { p, power: 0.5 });
    }
  }

  // ---------------- climbing ----------------
  _tryClimb() {
    const city = this.ctx.city;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const fwd = this.forward;
    let best = null;
    for (const [dx, dz] of dirs) {
      // probe a wall in this direction within reach at chest height
      for (let d = GORILLA.radius; d <= GORILLA.radius + 5; d += 1) {
        const px = this.pos.x + dx * d, pz = this.pos.z + dz * d;
        const y = this.pos.y + 8;
        const hit = city.cellQuery(px, y, pz);
        if (hit) {
          const score = d - (fwd.x * dx + fwd.z * dz) * 3;
          if (!best || score < best.score) best = { score, dx, dz, b: hit.b, d };
          break;
        }
      }
    }
    if (!best) {
      this.ctx.events.emit('hint', { text: 'Get closer to a building to climb' });
      return;
    }
    const b = best.b;
    // wall plane
    let wallCoord;
    if (best.dx === 1) wallCoord = b.x0 + Math.floor((this.pos.x + best.d - b.x0) / CELL.size) * CELL.size;
    else if (best.dx === -1) wallCoord = b.x0 + (Math.floor((this.pos.x - best.d - b.x0) / CELL.size) + 1) * CELL.size;
    else if (best.dz === 1) wallCoord = b.z0 + Math.floor((this.pos.z + best.d - b.z0) / CELL.size) * CELL.size;
    else wallCoord = b.z0 + (Math.floor((this.pos.z - best.d - b.z0) / CELL.size) + 1) * CELL.size;
    this.climb = { b, nx: -best.dx, nz: -best.dz, wall: wallCoord, phase: 0, moving: 0 };
    this.state = 'climb';
    this.vel.set(0, 0, 0);
    this.action = null;
    if (this.held) this._dropHeld();
    this.ctx.events.emit('climbStart', { p: this.pos.clone() });
  }

  _updateClimb(dt, input, fwdIn, strafe) {
    const c = this.climb;
    const city = this.ctx.city;
    const off = GORILLA.radius * 0.75;
    // stick to the wall plane
    if (c.nx !== 0) this.pos.x = c.wall + c.nx * off; else this.pos.z = c.wall + c.nz * off;
    this.yaw = Math.atan2(-c.nx, -c.nz);
    // sideways direction: right of facing
    const rx = -c.nz, rz = c.nx; // facing (-nx,-nz); right = facing x up
    const tx = -rx, tz = -rz;
    const busy = this.action && this.action.name === 'climbPunch';
    const vy = busy ? 0 : fwdIn * GORILLA.climbSpeed;
    const vs = busy ? 0 : strafe * GORILLA.climbSpeed * 0.8;
    const moving = Math.min(1, Math.abs(fwdIn) + Math.abs(strafe));
    c.moving = damp(c.moving, moving, 8, dt);
    c.phase += dt * moving * 0.9;
    let ny = this.pos.y + vy * dt;
    let nx = this.pos.x + tx * vs * dt, nz = this.pos.z + tz * vs * dt;
    // probe the wall surface in front at hands / body height
    const probe = (x, y, z) => city.solidAt(x - c.nx * (off + 1.5), y, z - c.nz * (off + 1.5));
    const bodyHold = probe(nx, ny + 6, nz) || probe(nx, ny + 2, nz);
    const handHold = probe(nx, ny + 12, nz);
    if (!bodyHold && !probe(this.pos.x, this.pos.y + 6, this.pos.z)) {
      // wall gone beneath us
      this._leaveClimb(true);
      return;
    }
    if (!probe(nx, ny + 6, nz) && !probe(nx, ny + 2, nz)) { nx = this.pos.x; nz = this.pos.z; }
    if (!handHold && fwdIn > 0) {
      // reached the top: mantle onto the roof if there is one
      const roofX = nx - c.nx * (off + 4), roofZ = nz - c.nz * (off + 4);
      const top = city.groundAt(roofX, roofZ, ny + 14);
      if (top > ny + 2) {
        this.pos.set(roofX, top, roofZ);
        this.state = 'ground';
        this.grounded = true;
        this.climb = null;
        this.vel.set(-c.nx * 2, 0, -c.nz * 2);
        this.landT = 0; this.landK = 0.4;
        this.ctx.events.emit('mantle', { p: this.pos.clone() });
        return;
      }
      ny = this.pos.y;
    }
    const ground = city.groundAt(nx, nz, ny + 1);
    if (ny < ground) { ny = ground; if (fwdIn < 0) { this._leaveClimb(false); return; } }
    this.pos.set(nx, ny, nz);
    if (input.hit('jump')) {
      this.state = 'air';
      this.vel.set(c.nx * 14, 14, c.nz * 14);
      this.yaw = Math.atan2(c.nx, c.nz);
      this.climb = null;
      this.ctx.events.emit('jump', { p: this.pos.clone() });
    }
    this.speed = 0;
  }

  _leaveClimb(fall) {
    const c = this.climb;
    this.state = 'air';
    this.grounded = false;
    if (c) this.vel.set(c.nx * 4, fall ? -2 : 0, c.nz * 4);
    this.climb = null;
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
        const hand = a.side === 'L' ? this.handL : this.handR;
        const p = hand.clone().addScaledVector(fwd, 2.5);
        ctx.combat.strike(p, a.heavy ? 6.5 : 5, (a.heavy ? 1.9 : 1.2) * rageK, fwd, a.heavy ? 'smash' : 'punch');
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

  _dropHeld() {
    if (!this.held) return;
    const h = this.held;
    this.held = null;
    h.release(this.handR.clone(), this.forward.clone().multiplyScalar(4).add(new THREE.Vector3(0, 2, 0)));
  }

  damage(amount, from) {
    if (this.state === 'dead' || this.invuln > 0) return;
    this.health -= amount;
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 10);
    this.ctx.events.emit('hurt', { amount, from });
    if (amount >= 4 && (!this.action || this.action.name === 'hit')) this._start('hit');
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'dead';
      this.action = null;
      if (this.held) this._dropHeld();
      this.ctx.events.emit('gorillaDeath', { p: this.pos.clone() });
    }
  }

  heal(v) { this.health = Math.min(GORILLA.maxHealth, this.health + v); }

  // ---------------- animation ----------------
  _animate(dt) {
    const base = this.base;
    const s = GORILLA.modelScale;
    if (this.state === 'dead') {
      Poses.death(this.out, this.deathT);
    } else if (this.state === 'climb') {
      Poses.climb(base, this.climb ? this.climb.phase : 0, this.climb ? this.climb.moving : 0);
      this.out.copy(base);
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
        case 'climbPunch': Poses.climbPunch(this.act, t, a.side, this.out); break;
        case 'hit': Poses.hit(this.act, t, this.out); break;
      }
      const fadeIn = Math.min(1, a.t / 0.06), fadeOut = Math.min(1, (a.dur - a.t) / 0.12);
      const w = Math.min(fadeIn, fadeOut);
      if (a.upper && this.speed > 1) this.out.lerpMasked(this.act, w, UPPER);
      else this.out.lerp(this.act, w);
    }
    // look toward the camera's aim (alive, not in big actions)
    if (this.state !== 'dead') {
      const want = clamp(angleDiff(this.yaw, this.camYaw), -0.9, 0.9);
      this.headYaw = damp(this.headYaw, want, 5, dt);
      this.out.add('neck', 0, this.headYaw * 0.4, 0);
      this.out.add('head', -this.aimPitch * 0.3, this.headYaw * 0.4, 0);
      if (this.hurtFlash > 0) this.out.add('jaw', this.hurtFlash * 0.3, 0, 0);
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
