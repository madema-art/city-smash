import * as THREE from 'three';
import { CELL } from '../config.js';

const S = CELL.size;
const H = CELL.height;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// A detached chunk of building (everything above a failed floor, or a floating island).
// It sags, tilts toward the weak side, then drops; every cell that sinks below whatever is
// beneath it (the remaining structure, rubble, or the street) is crushed into debris, dust and
// rubble. Heavy sections pancake the floors below them.
export class CollapseSection {
  constructor(building, members, opts) {
    this.b = building;
    this.ctx = building.ctx;
    this.members = Int32Array.from(members);
    this.live = new Uint8Array(members.length).fill(1);
    this.remaining = members.length;
    this.baseY = opts.baseY;
    this.sag = opts.sag ?? 0.6;
    this.pancake = opts.pancake ?? 0.3;
    this.major = !!opts.major;
    this.t = 0;
    this.vy = 0;
    this.offset = new THREE.Vector3();
    this.angle = 0;
    this.angVel = 0;
    const tilt = opts.tilt || new THREE.Vector2();
    let tl = tilt.length();
    if (tl < 0.12) {
      // nearly symmetric damage: pick a slight random lean so collapses never look canned
      const a = Math.random() * Math.PI * 2;
      tilt.set(Math.cos(a), Math.sin(a)).multiplyScalar(0.15);
      tl = 0.15;
    }
    this.tiltMag = Math.min(1, tl);
    const td = tilt.clone().normalize();
    this.axis = new THREE.Vector3(td.y, 0, -td.x).normalize();
    this.pivot = new THREE.Vector3(
      building.width / 2 + td.x * building.width * 0.35,
      this.baseY,
      building.depth / 2 + td.y * building.depth * 0.35,
    );
    this.done = false;
    this.crushedThisFrame = 0;

    // build the moving mesh from the member cells
    const n = members.length;
    this.mesh = new THREE.InstancedMesh(building.geo, building.material, n);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    // Reuse the building's per-cell info by giving this mesh its own geometry view.
    const geo = new THREE.BufferGeometry();
    geo.index = building.geo.index;
    geo.setAttribute('position', building.geo.attributes.position);
    geo.setAttribute('normal', building.geo.attributes.normal);
    geo.setAttribute('uv', building.geo.attributes.uv);
    const info = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const i = members[k];
      info[k * 3] = building.info[i * 3];
      info[k * 3 + 1] = Math.max(0.15, building.info[i * 3 + 1]);
      info[k * 3 + 2] = building.info[i * 3 + 2];
    }
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
    // the section's lights flicker as it gives way, then die as it falls
    this.pow = new Float32Array(n);
    for (let k = 0; k < n; k++) this.pow[k] = Math.min(0.6, building.power[members[k]]);
    this.powAttr = new THREE.InstancedBufferAttribute(this.pow, 1);
    geo.setAttribute('aPow', this.powAttr);
    this.lightsOut = false;
    this.geo = geo;
    this.mesh.geometry = geo;
    this.centers = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      building.cellCenterLocal(members[k], _p);
      this.centers[k * 3] = _p.x; this.centers[k * 3 + 1] = _p.y; this.centers[k * 3 + 2] = _p.z;
      _m.makeTranslation(_p.x, _p.y, _p.z);
      this.mesh.setMatrixAt(k, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.local = new THREE.Matrix4();
    this._updateMatrix();
    this.ctx.root.add(this.mesh);
    this.dustTimer = 0;
    this.sumX = 0; this.sumZ = 0;
  }

  _updateMatrix() {
    // local = T(offset) * T(pivot) * R(axis, angle) * T(-pivot)
    _q.setFromAxisAngle(this.axis, this.angle);
    this.local.makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z);
    _m2.makeRotationFromQuaternion(_q);
    this.local.premultiply(_m2);
    _m2.makeTranslation(this.pivot.x + this.offset.x, this.pivot.y + this.offset.y, this.pivot.z + this.offset.z);
    this.local.premultiply(_m2);
    this.mesh.matrix.multiplyMatrices(this.b.mesh.matrix, this.local);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.worldMatrix = this.mesh.matrix;
  }

  update(dt) {
    const b = this.b;
    this.t += dt;
    const g = 30;
    if (!this.lightsOut && this.t > this.sag * 0.6) {
      this.lightsOut = true;
      this.pow.fill(0);
      this.powAttr.needsUpdate = true;
      const c = new THREE.Vector3(b.cx, this.baseY + 2, b.cz);
      this.ctx.fx.sparks(c.clone().add(new THREE.Vector3(b.width * 0.5, 0, 0)), new THREE.Vector3(1, 0, 0), 14);
      this.ctx.fx.sparks(c.clone().add(new THREE.Vector3(-b.width * 0.5, 0, 0)), new THREE.Vector3(-1, 0, 0), 14);
      this.ctx.events.emit('powerFail', { x: b.cx, y: this.baseY, z: b.cz, big: true });
    }
    if (this.t < this.sag) {
      // sag: a slow, ominous give before the fall
      const k = this.t / this.sag;
      this.vy = -0.6 - k * 1.5;
      this.angVel = this.tiltMag * 0.05 * k;
    } else {
      const maxSpeed = this.major ? 24 : 32;
      this.vy = Math.max(-maxSpeed, this.vy - g * 0.75 * dt);
      // tipping accelerates as the lean grows (gravity torque ~ sin(angle))
      this.angVel += (this.tiltMag * 0.35 + Math.sin(this.angle) * 1.2) * dt;
      this.angVel = Math.min(this.angVel, 1.4);
    }
    // crushing resists the fall a little
    const resist = Math.min(0.6, this.crushedThisFrame * 0.02);
    this.vy *= 1 - resist;
    this.offset.y += this.vy * dt;
    this.angle = Math.min(1.45, this.angle + this.angVel * dt);
    this._updateMatrix();

    this.crushedThisFrame = 0;
    const n = this.members.length;
    const M = this.local.elements;
    const ox = b.x0, oz = b.z0;
    let lowest = 1e9;
    this.sumX = 0; this.sumZ = 0;
    let liveCount = 0;
    for (let k = 0; k < n; k++) {
      if (!this.live[k]) continue;
      const cx = this.centers[k * 3], cy = this.centers[k * 3 + 1], cz = this.centers[k * 3 + 2];
      // transform center by local matrix
      const x = M[0] * cx + M[4] * cy + M[8] * cz + M[12];
      const y = M[1] * cx + M[5] * cy + M[9] * cz + M[13];
      const z = M[2] * cx + M[6] * cy + M[10] * cz + M[14];
      const bottom = y - H * 0.5;
      lowest = Math.min(lowest, bottom);
      liveCount++;
      this.sumX += x; this.sumZ += z;
      // what is underneath this cell?
      const wx = x + ox, wz = z + oz;
      let floorY = this.ctx.rubble.heightAt(wx, wz) * 0.6;
      let underIdx = -1;
      const gx = Math.floor(x / S), gz = Math.floor(z / S);
      if (gx >= 0 && gz >= 0 && gx < b.nx && gz < b.nz) {
        const top = b.colTop[gx + gz * b.nx];
        if (top > 0 && top * H > floorY) {
          floorY = top * H;
          underIdx = b.idx(gx, top - 1, gz);
        }
      } else if (this.t > this.sag && (k & 3) === (Math.floor(this.t * 60) & 3)) {
        // toppling outside the footprint: may smash into neighbouring buildings
        const hit = this.ctx.city.cellQuery(wx, y, wz, b);
        if (hit) {
          hit.b.removeCell(hit.i, 2, new THREE.Vector3(x - this.pivot.x, 0, z - this.pivot.z).normalize(), 1.5);
          this.ctx.events.emit('impact', { x: wx, y, z: wz, power: 1.3, kind: 'concrete' });
          this._crush(k, x + ox, y, z + oz, true);
          continue;
        }
      }
      if (bottom < floorY) {
        this._crush(k, wx, y, wz, false);
        if (underIdx >= 0 && b.alive[underIdx] && Math.random() < this.pancake) {
          b.removeCell(underIdx, 1, null, 1);
        }
      }
    }
    if (liveCount > 0) { this.sumX /= liveCount; this.sumZ /= liveCount; }

    // rolling dust at the crush front
    this.dustTimer -= dt;
    if (this.crushedThisFrame > 0 && this.dustTimer <= 0) {
      this.dustTimer = 0.16;
      const cx = this.sumX + ox, cz = this.sumZ + oz;
      const r = Math.max(b.width, b.depth) * 0.6;
      const strength = Math.min(1.6, 0.4 + this.crushedThisFrame * 0.15);
      this.ctx.fx.collapseDust(cx, Math.max(2, lowest + 2), cz, r, strength, null);
      this.ctx.fx.addShake(0.05 * strength);
    }
    if (this.remaining <= 0 || this.t > 16) {
      // finish: crush whatever is left
      for (let k = 0; k < n; k++) if (this.live[k]) {
        const cx = this.centers[k * 3], cy = this.centers[k * 3 + 1], cz = this.centers[k * 3 + 2];
        _p.set(cx, cy, cz).applyMatrix4(this.local);
        this._crush(k, _p.x + ox, _p.y, _p.z + oz, false);
      }
      this.done = true;
      const cx = this.sumX + ox, cz = this.sumZ + oz;
      this.ctx.events.emit('collapseEnd', { building: b, x: cx || b.cx, z: cz || b.cz, size: n, major: this.major });
      this.ctx.fx.collapseDust(cx || b.cx, 3, cz || b.cz, Math.max(b.width, b.depth) * 0.9, Math.min(2.5, n / 120));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _crush(k, wx, wy, wz, violent) {
    const b = this.b;
    this.live[k] = 0;
    this.remaining--;
    this.crushedThisFrame++;
    b.destroyedCells++;
    this.ctx.stats.destroyedCells++;
    this.mesh.setMatrixAt(k, ZERO);
    const i = this.members[k];
    const ext = b.mask[i] & (1 | 2 | 16 | 32);
    const color = ext ? b.color : b.concrete;
    // rubble mound: keeps building up where the structure came down
    const rx = wx + (Math.random() - 0.5) * 4, rz = wz + (Math.random() - 0.5) * 4;
    this.ctx.rubble.add(rx, rz, 1.8 + Math.random() * 1.6, _c.copy(color).multiplyScalar(0.7 + Math.random() * 0.35));
    if (Math.random() < 0.5) this.ctx.rubble.add(wx + (Math.random() - 0.5) * 6, wz + (Math.random() - 0.5) * 6, 1.2 + Math.random(), _c.copy(b.concrete).multiplyScalar(0.8 + Math.random() * 0.3));
    const budget = this.ctx.budget;
    const out = _w.set(wx - b.cx, 0, wz - b.cz);
    if (out.lengthSq() < 0.01) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize();
    if (budget.physics > 0 && (violent || Math.random() < 0.35)) {
      budget.physics--;
      const size = new THREE.Vector3(1.4 + Math.random() * 2, 0.9 + Math.random() * 1.3, 1.4 + Math.random() * 2);
      const v = new THREE.Vector3(out.x * (6 + Math.random() * 10), 2 + Math.random() * 6, out.z * (6 + Math.random() * 10));
      this.ctx.debris.spawn(new THREE.Vector3(wx, Math.max(wy, 2), wz), v, size, _c.copy(color).multiplyScalar(0.8 + Math.random() * 0.3));
    }
    if (budget.chips > 0 && Math.random() < 0.6) {
      budget.chips--;
      this.ctx.fx.chipBurst(_p.set(wx, Math.max(wy, 1.5), wz), out, color, 6, 10, 1.3);
    }
    if (ext && budget.glass > 0 && Math.random() < 0.5) {
      budget.glass--;
      this.ctx.fx.glassBurst(_p.set(wx, Math.max(wy, 1.5), wz), out, 8, 4);
    }
    if (wy < 12) this.ctx.events.emit('crush', { x: wx, y: wy, z: wz });
    if (wy < 8 && Math.random() < 0.012 && this.ctx.fires) this.ctx.fires.start(wx, this.ctx.rubble.heightAt(wx, wz) + 0.5, wz, 45 + Math.random() * 40, 1.1);
  }

  dispose() {
    this.ctx.root.remove(this.mesh);
    this.geo.dispose();
    this.mesh.dispose();
  }
}
