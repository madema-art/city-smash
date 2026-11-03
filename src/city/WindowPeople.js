import * as THREE from 'three';
import { HumanRenderer } from './HumanRenderer.js';
import { Held } from '../core/Held.js';
import { CELL } from '../config.js';
import { pick } from '../core/util.js';
import { BIT } from '../world/Building.js';

const S = CELL.size, H = CELL.height;
const SHIRTS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad, 0xe67e22, 0x16a085, 0xf5b7b1, 0xd35400];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x7a4a2a];
const FACES = [
  { bit: BIT.PX, nx: 1, nz: 0 }, { bit: BIT.NX, nx: -1, nz: 0 },
  { bit: BIT.PZ, nx: 0, nz: 1 }, { bit: BIT.NZ, nx: 0, nz: -1 },
];

// Lightweight "window occupants": office workers and residents who appear in upper-floor
// windows near the monster. They are busts standing in an opened, lit window (the facade shader
// paints the room behind them), react to the monster, duck inside, fall when their floor is
// smashed, and can be plucked out and eaten while climbing. Only a few dozen exist at a time,
// all near the action; nothing simulates whole interiors.
export class WindowPeople {
  constructor(ctx) {
    this.ctx = ctx;
    this.renderer = new HumanRenderer(ctx.root, 70);
    this.list = [];
    this.timer = 0;
    this.max = 46;
  }

  _spawn(b, i, face, side) {
    const [x, y, z] = b.coords(i);
    if (y < 1) return null;
    // window centre on that face (two windows per cell)
    const along = (side === 0 ? 0.25 : 0.75) * S;
    let px, pz;
    const out = 0.3;
    if (face.nx !== 0) { px = b.x0 + (face.nx > 0 ? (x + 1) * S + out : x * S - out); pz = b.z0 + z * S + along; }
    else { pz = b.z0 + (face.nz > 0 ? (z + 1) * S + out : z * S - out); px = b.x0 + x * S + along; }
    const p = {
      b, i, face, x: px, y: y * H + 0.25, z: pz, baseY: y * H + 0.25,
      yaw: Math.atan2(face.nx, face.nz), phase: Math.random() * 10, anim: 'idle', state: 'idle', bust: true,
      colors: { shirt: new THREE.Color(pick(SHIRTS)), pants: new THREE.Color(0x2c3e50), skin: new THREE.Color(pick(SKIN)) },
      scale: 1.35, t: 0, panic: 0, duck: 0, tx: 0, hidden: false, scream: 0,
    };
    this.list.push(p);
    this._setLit(b, i, true);
    return p;
  }

  _setLit(b, i, on) {
    const k = i * 3 + 2;
    const frac = b.info[k] % 1;
    const occupied = on || this.list.some((o) => o.b === b && o.i === i && o.state !== 'gone' && !o.hidden);
    b.info[k] = frac + (occupied ? 1 : 0);
    b.infoAttr.needsUpdate = true;
  }

  // pick a random exterior side window on building b, optionally near (u, y) on a given face
  _randomSlot(b, faceFilter = null, near = null) {
    for (let tries = 0; tries < 16; tries++) {
      let x, y, z;
      if (near) {
        y = Math.floor((near.y + (Math.random() * 2 - 1) * near.dy) / H);
        const u = near.u + (Math.random() * 2 - 1) * near.du;
        if (faceFilter.nx !== 0) { z = Math.floor((u - b.z0) / S); x = faceFilter.nx > 0 ? b.nx - 1 : 0; }
        else { x = Math.floor((u - b.x0) / S); z = faceFilter.nz > 0 ? b.nz - 1 : 0; }
        // walk inward from the outer edge to the first existing cell on that face
        if (faceFilter.nx !== 0) { while (x >= 0 && x < b.nx && !b.aliveAt(x, y, z)) x -= faceFilter.nx; }
        else { while (z >= 0 && z < b.nz && !b.aliveAt(x, y, z)) z -= faceFilter.nz; }
      } else {
        x = Math.floor(Math.random() * b.nx); z = Math.floor(Math.random() * b.nz);
        y = 1 + Math.floor(Math.random() * (b.ny - 1));
      }
      if (y < 1 || !b.aliveAt(x, y, z)) continue;
      const i = b.idx(x, y, z);
      const m = b.mask[i];
      const faces = FACES.filter((f) => (m & f.bit) && (!faceFilter || f === faceFilter || (f.nx === faceFilter.nx && f.nz === faceFilter.nz)));
      if (!faces.length) continue;
      if (this.list.some((o) => o.b === b && o.i === i)) continue;
      if (b.dmg[i] > 0.7) continue;
      return { i, face: pick(faces) };
    }
    return null;
  }

  update(dt, camPos) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    this.timer -= dt;
    if (this.timer <= 0 && g) {
      this.timer = 0.4;
      // keep a few people near the climbing monster so there is always someone to grab
      const c = g.climb;
      if (c && g.state === 'climb' && c.b) {
        const face = FACES.find((f) => f.nx === c.nx && f.nz === c.nz);
        const u = c.nx !== 0 ? g.pos.z : g.pos.x;
        const mine = this.list.filter((o) => o.b === c.b && o.face === face && o.state !== 'held');
        const chestY = g.pos.y + 10.5;
        const inReach = mine.filter((o) => !o.hidden && Math.hypot((c.nx !== 0 ? o.z : o.x) - u, o.y + 1.6 - chestY) < 10).length;
        // curious (or trapped) people come to the windows right next to the climbing monster
        if (inReach < 2 && this.list.length < this.max) {
          const slot = this._randomSlot(c.b, face, { u, du: 5, y: chestY - 1, dy: 6 });
          if (slot) this._spawn(c.b, slot.i, slot.face, Math.random() < 0.5 ? 0 : 1);
        } else if (mine.length < 6 && this.list.length < this.max) {
          const slot = this._randomSlot(c.b, face, { u, du: 12, y: chestY, dy: 16 });
          if (slot) this._spawn(c.b, slot.i, slot.face, Math.random() < 0.5 ? 0 : 1);
        }
      }
      // ambient population on nearby buildings
      if (this.list.length < this.max * 0.7) {
        const bs = ctx.city.buildingsNear(g.pos.x, g.pos.z, 110).filter((b) => b.ny >= 3 && b.destroyedFraction < 0.6);
        if (bs.length) {
          const b = pick(bs);
          const slot = this._randomSlot(b);
          if (slot) this._spawn(b, slot.i, slot.face, Math.random() < 0.5 ? 0 : 1);
        }
      }
    }
    const gp = g ? g.pos : null;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const o = this.list[k];
      if (o.state === 'held') continue;
      o.t += dt;
      o.phase += dt * 6;
      // floor gone / section collapsing: tumble out
      if (!o.b.alive[o.i]) { this._fall(o, 2 + Math.random() * 3); continue; }
      const dx = gp ? o.x - gp.x : 999, dy = gp ? o.y - (gp.y + 9) : 999, dz = gp ? o.z - gp.z : 999;
      const d = Math.hypot(dx, dy, dz);
      if (gp && (Math.hypot(dx, dz) > 170)) { this._remove(k); continue; }
      if (o.hidden) {
        o.duck -= dt;
        if (o.duck <= 0) {
          // pop back up at a neighbouring window
          o.hidden = false;
          this._setLit(o.b, o.i, true);
        }
        continue;
      }
      if (d < 38) {
        o.state = 'panic';
        o.anim = 'panic';
        o.panic = 4;
        // lean out and wave for help, shuffle side to side in the window
        o.tx = 0.35 + Math.sin(o.phase * 0.7) * 0.15;
        o.scream -= dt;
        if (o.scream <= 0) { o.scream = 1.5 + Math.random() * 3; ctx.events.emit('scream', { x: o.x, z: o.z, y: o.y }); }
        // the brave ones stay; the rest duck when the monster gets very close
        if (d < 10 && Math.random() < dt * 0.25) { o.hidden = true; o.duck = 1.5 + Math.random() * 2.5; this._setLit(o.b, o.i, false); }
      } else {
        o.panic -= dt;
        if (o.panic <= 0) { o.state = 'idle'; o.anim = 'idle'; o.tx = Math.sin(o.phase * 0.2) * 0.05; }
      }
      // damaged window: they lean further out
      if (o.b.dmg[o.i] > 0.3) o.tx = Math.max(o.tx, 0.5);
      const side = Math.sin(o.phase * 0.9) * (o.state === 'panic' ? 0.25 : 0.05);
      o.rx = o.face.nz !== 0 ? side : 0;
      o.rz = o.face.nx !== 0 ? side : 0;
    }
    // render (offset the lateral shuffle without moving the logical anchor)
    for (const o of this.list) { o._x = o.x; o._z = o.z; o.x += o.rx || 0; o.z += o.rz || 0; }
    this.renderer.write(this.list.filter((o) => o.state !== 'held'), camPos);
    for (const o of this.list) { o.x = o._x; o.z = o._z; }
  }

  _remove(k) {
    const o = this.list[k];
    this.list.splice(k, 1);
    this._setLit(o.b, o.i, false);
  }

  _fall(o, out = 4) {
    const k = this.list.indexOf(o);
    if (k >= 0) this._remove(k);
    if (this.ctx.crowd) this.ctx.crowd.spawnFlying(o.x, o.y + 1, o.z, o.face.nx * out + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, o.face.nz * out + (Math.random() - 0.5) * 2, o.colors);
  }

  // punches / debris knock people out of their windows
  hit(p, radius, dir, power) {
    let n = 0;
    for (const o of [...this.list]) {
      if (o.state === 'held' || o.hidden) continue;
      if (Math.hypot(o.x - p.x, o.y + 1.5 - p.y, o.z - p.z) > radius) continue;
      this._fall(o, 8 + power * 6);
      n++;
    }
    return n;
  }

  // people reachable from a climbing monster (root position + climb data)
  grabCandidates(root, c, reach) {
    const out = [];
    const chest = new THREE.Vector3(root.x, root.y + 10.5, root.z);
    for (const o of this.list) {
      if (o.state === 'held' || o.hidden) continue;
      const p = new THREE.Vector3(o.x, o.y + 1.6, o.z);
      if (p.distanceTo(chest) > reach) continue;
      // must be on the facade the monster is facing
      if (c && (o.face.nx !== c.nx || o.face.nz !== c.nz)) continue;
      // from the street: only windows facing the monster
      if (!c && (root.x - o.x) * o.face.nx + (root.z - o.z) * o.face.nz < 0) continue;
      out.push({ kind: 'person', edible: true, pos: p, take: () => this._take(o) });
    }
    return out;
  }

  _take(o) {
    o.state = 'held';
    this._setLit(o.b, o.i, false);
    const mesh = HumanRenderer.makeFigure(o.colors);
    mesh.scale.setScalar(1.2);
    const held = new Held(this.ctx, {
      kind: 'person', mesh, edible: true, heal: 9,
      offset: new THREE.Vector3(0, -1.1, 0.6),
      localRot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)),
      half: new THREE.Vector3(0.4, 1, 0.4),
      onConsume: () => { const k = this.list.indexOf(o); if (k >= 0) this.list.splice(k, 1); this.ctx.stats.eaten++; },
      onRelease: (pos, vel) => {
        this.ctx.root.remove(mesh);
        const k = this.list.indexOf(o); if (k >= 0) this.list.splice(k, 1);
        if (this.ctx.crowd) this.ctx.crowd.spawnFlying(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, o.colors);
      },
    });
    this.ctx.events.emit('windowGrab', { x: o.x, y: o.y, z: o.z });
    return held;
  }
}
