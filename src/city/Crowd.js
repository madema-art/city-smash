import * as THREE from 'three';
import { HumanRenderer } from './HumanRenderer.js';
import { ROAD_CENTERS, CITY_HALF } from '../world/City.js';
import { Held } from '../core/Held.js';
import { pick } from '../core/util.js';

const SHIRTS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad, 0xe67e22, 0x34495e, 0xd35400, 0x16a085, 0xf5b7b1, 0x1abc9c, 0x5d6d7e];
const PANTS = [0x2c3e50, 0x1b2631, 0x5d4037, 0x34495e, 0x7f8c8d, 0x212f3d, 0x6e2c00];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x7a4a2a];
const col = (h) => new THREE.Color(h);

// Tiny civilians: stroll the sidewalks, notice danger, panic, flee, pour out of damaged
// buildings, and can be snatched up and eaten for health.
export class Crowd {
  constructor(ctx, count = 300) {
    this.ctx = ctx;
    this.renderer = new HumanRenderer(ctx.root, 700);
    this.people = [];
    this.target = count;
    this.kills = 0;
    this.eaten = 0;
    this.frame = 0;
    for (let i = 0; i < count; i++) this._spawnWalker();
  }

  _colors() {
    return { shirt: col(pick(SHIRTS)), pants: col(pick(PANTS)), skin: col(pick(SKIN)) };
  }

  _spawnWalker(farFrom = null) {
    for (let tries = 0; tries < 10; tries++) {
      const c = pick(ROAD_CENTERS);
      const side = Math.random() < 0.5 ? -1 : 1;
      const along = (Math.random() * 2 - 1) * (CITY_HALF - 6);
      const vertical = Math.random() < 0.5;
      const off = side * (8.2 + Math.random() * 2.2);
      const x = vertical ? c + off : along;
      const z = vertical ? along : c + off;
      if (farFrom && Math.hypot(x - farFrom.x, z - farFrom.z) < 140) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const h = {
        x, y: 0, z, yaw: 0, phase: Math.random() * 10, anim: 'walk', state: 'walk',
        vertical, line: vertical ? c + off : c + off, dir, speed: 1.3 + Math.random() * 0.6,
        colors: this._colors(), panic: 0, vx: 0, vy: 0, vz: 0, dead: 0, scale: 1.05,
        fleeX: 0, fleeZ: 0, idle: 0,
      };
      h.yaw = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.people.push(h);
      return h;
    }
    return null;
  }

  // People run out of a building that is being smashed.
  exodus(b, count) {
    for (let k = 0; k < count && b.occupants > 0; k++) {
      b.occupants--;
      const side = Math.floor(Math.random() * 4);
      let x, z, nx = 0, nz = 0;
      if (side === 0) { x = b.x0 - 0.6; z = b.z0 + Math.random() * b.depth; nx = -1; }
      else if (side === 1) { x = b.x0 + b.width + 0.6; z = b.z0 + Math.random() * b.depth; nx = 1; }
      else if (side === 2) { x = b.x0 + Math.random() * b.width; z = b.z0 - 0.6; nz = -1; }
      else { x = b.x0 + Math.random() * b.width; z = b.z0 + b.depth + 0.6; nz = 1; }
      const h = {
        x, y: 0, z, yaw: Math.atan2(nx, nz), phase: Math.random() * 10, anim: 'panic', state: 'flee',
        colors: this._colors(), panic: 10, vx: 0, vy: 0, vz: 0, dead: 0, scale: 1.05,
        fleeX: nx, fleeZ: nz, speed: 6, vertical: Math.abs(nz) > 0.5, line: 0, dir: 1, idle: 0,
      };
      this.people.push(h);
    }
  }

  alarm(p, radius, roar = false) {
    const r2 = radius * radius;
    for (const h of this.people) {
      if (h.state === 'dead' || h.state === 'fly' || h.state === 'held') continue;
      const dx = h.x - p.x, dz = h.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      h.state = 'flee';
      h.panic = 8 + Math.random() * 6 + (roar ? 4 : 0);
      h.fleeX = dx / d; h.fleeZ = dz / d;
      h.speed = 5.5 + Math.random() * 2.5;
      if (Math.random() < 0.3 && this.ctx.events) this.ctx.events.emit('scream', { x: h.x, z: h.z });
    }
  }

  _fling(h, vx, vy, vz) {
    h.state = 'fly';
    h.anim = 'fly';
    h.vx = vx; h.vy = vy; h.vz = vz;
    h.spin = (Math.random() - 0.5) * 14;
  }

  hit(p, radius, dir, power) {
    let n = 0;
    for (const h of this.people) {
      if (h.state === 'dead' || h.state === 'held') continue;
      const dx = h.x - p.x, dy = h.y + 1 - p.y, dz = h.z - p.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      this._fling(h, dir.x * 22 * power + dx, 10 + Math.random() * 10, dir.z * 22 * power + dz);
      n++;
    }
    return n;
  }

  shock(p, radius, power) {
    for (const h of this.people) {
      if (h.state === 'dead' || h.state === 'held' || h.state === 'fly') continue;
      const dx = h.x - p.x, dz = h.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const k = (1 - d / radius) * power;
      this._fling(h, (dx / (d || 1)) * 14 * k, 8 + 14 * k, (dz / (d || 1)) * 14 * k);
    }
  }

  crush(x, z, radius) {
    for (const h of this.people) {
      if (h.state === 'dead' || h.state === 'held') continue;
      if (Math.abs(h.x - x) > radius || Math.abs(h.z - z) > radius) continue;
      if (Math.hypot(h.x - x, h.z - z) > radius) continue;
      this._kill(h, true);
    }
  }

  _kill(h, squash = false) {
    if (h.state === 'dead') return;
    h.state = 'dead';
    h.anim = 'dead';
    h.dead = 0;
    h.tx = -Math.PI / 2;
    h.y = 0.15;
    if (squash) { h.squash = 0.25; h.tx = 0; }
    this.kills++;
    this.ctx.stats.civilians++;
  }

  grabCandidates(p, radius) {
    const out = [];
    for (const h of this.people) {
      if (h.state === 'dead' || h.state === 'held') continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d > radius || Math.abs(h.y - p.y) > 8) continue;
      out.push({
        kind: 'person', edible: true, pos: new THREE.Vector3(h.x, h.y, h.z),
        take: () => this._take(h),
      });
    }
    return out;
  }

  _take(h) {
    h.state = 'held';
    h.hidden = true;
    const mesh = HumanRenderer.makeFigure(h.colors);
    const held = new Held(this.ctx, {
      kind: 'person', mesh, edible: true, heal: 7,
      offset: new THREE.Vector3(0, -1.1, 0.6),
      localRot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)),
      half: new THREE.Vector3(0.4, 1, 0.4),
      onConsume: () => {
        this.people.splice(this.people.indexOf(h), 1);
        this.eaten++;
        this.ctx.stats.eaten++;
      },
      onRelease: (pos, vel) => {
        this.ctx.root.remove(mesh);
        h.hidden = false;
        h.x = pos.x; h.y = pos.y; h.z = pos.z;
        this._fling(h, vel.x, vel.y, vel.z);
      },
    });
    return held;
  }

  update(dt, camPos) {
    this.frame++;
    const city = this.ctx.city;
    const g = this.ctx.gorilla;
    const gp = g ? g.pos : null;
    let alive = 0;
    for (let i = this.people.length - 1; i >= 0; i--) {
      const h = this.people[i];
      if (h.state === 'held') continue;
      if (h.state === 'dead') {
        h.dead += dt;
        if (h.dead > 12) this.people.splice(i, 1);
        continue;
      }
      if (h.state === 'fly') {
        h.vy -= 30 * dt;
        h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
        h.tx = (h.tx || 0) + h.spin * dt;
        h.phase += dt * 6;
        const floor = city.groundAt(h.x, h.z, h.y + 0.5);
        if (h.y <= floor) {
          h.y = floor;
          if (Math.abs(h.vy) > 14) this._kill(h, false);
          else { h.state = 'flee'; h.tx = 0; h.vx = h.vz = 0; h.panic = 6; h.y = floor; }
        }
        continue;
      }
      alive++;
      // distant people update at a lower rate
      const dxg = gp ? h.x - gp.x : 999, dzg = gp ? h.z - gp.z : 999;
      const dg = Math.hypot(dxg, dzg);
      const step = dg > 140 ? 4 : 1;
      if ((i + this.frame) % step !== 0) continue;
      const sdt = dt * step;
      // notice the monster nearby
      if (h.state === 'walk' && dg < 55) {
        h.state = 'flee'; h.panic = 8; h.fleeX = dxg / (dg || 1); h.fleeZ = dzg / (dg || 1); h.speed = 6 + Math.random() * 2;
      }
      if (h.state === 'walk') {
        h.anim = 'walk';
        h.phase += sdt * h.speed * 4;
        const v = h.dir * h.speed * sdt;
        if (h.vertical) h.z += v; else h.x += v;
        // turn at intersections sometimes / reverse at city edge
        const along = h.vertical ? h.z : h.x;
        if (Math.abs(along) > CITY_HALF - 4) { h.dir *= -1; }
        if (Math.random() < 0.002 * step) h.dir *= -1;
        h.yaw = h.vertical ? (h.dir > 0 ? 0 : Math.PI) : (h.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      } else if (h.state === 'flee') {
        h.anim = h.panic > 4 ? 'panic' : 'run';
        h.phase += sdt * 14;
        h.panic -= sdt;
        // run away from the monster, steering around buildings
        let fx = h.fleeX, fz = h.fleeZ;
        if (gp && dg < 120) { fx = fx * 0.4 + (dxg / dg) * 0.6; fz = fz * 0.4 + (dzg / dg) * 0.6; }
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl; fz /= fl;
        const sp = h.speed * sdt;
        let nx = h.x + fx * sp, nz = h.z + fz * sp;
        if (city.solidAt(nx, 1, nz)) {
          // slide along the wall
          if (!city.solidAt(nx, 1, h.z)) nz = h.z;
          else if (!city.solidAt(h.x, 1, nz)) nx = h.x;
          else { nx = h.x; nz = h.z; h.fleeX = -h.fleeX + (Math.random() - 0.5); h.fleeZ = -h.fleeZ + (Math.random() - 0.5); }
        }
        h.x = nx; h.z = nz;
        h.y = city.groundAt(h.x, h.z, h.y + 1.5);
        h.yaw = Math.atan2(nx - (h.x - fx), nz - (h.z - fz));
        h.yaw = Math.atan2(fx, fz);
        if (h.panic <= 0 && dg > 90) {
          h.state = 'walk';
          // snap back to the nearest sidewalk line
          h.vertical = Math.random() < 0.5;
          h.dir = Math.random() < 0.5 ? 1 : -1;
        }
        if (Math.abs(h.x) > 600 || Math.abs(h.z) > 600) { this.people.splice(i, 1); }
      }
      // trampled by the monster's feet
      if (g && g.alive && dg < 3.5 && g.speed > 2 && h.y < g.pos.y + 1) this._kill(h, true);
    }
    // keep the city populated
    if (alive < this.target * 0.6 && this.frame % 30 === 0 && gp) this._spawnWalker(gp);
    this.renderer.write(this.people, camPos);
  }
}
