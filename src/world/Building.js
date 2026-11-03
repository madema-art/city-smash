import * as THREE from 'three';
import { CELL } from '../config.js';
import { createBuildingMaterial } from './BuildingMaterial.js';
import { CollapseSection } from '../destruction/CollapseSection.js';

const S = CELL.size;
const H = CELL.height;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

let sharedBox = null;

// Face bits used in the per-cell exterior mask (must match BuildingMaterial).
const BIT = { PX: 1, NX: 2, PY: 4, NY: 8, PZ: 16, NZ: 32 };

// A destructible building made of a grid of storey-sized cells.
// Damage is localized per cell; structure is evaluated per floor (load-bearing ratio) and by
// connectivity to the ground, so smashing the base brings down everything above it while
// smashing the top only drops the top.
export class Building {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.id = def.id;
    this.def = def;
    this.x0 = def.x0;
    this.z0 = def.z0;
    this.nx = def.nx;
    this.nz = def.nz;
    this.heights = def.heights; // floors per column
    this.ny = Math.max(...def.heights);
    this.style = def.style;
    this.width = this.nx * S;
    this.depth = this.nz * S;
    this.height = this.ny * H;
    this.cx = this.x0 + this.width / 2;
    this.cz = this.z0 + this.depth / 2;
    const N = (this.N = this.nx * this.ny * this.nz);
    this.exists = new Uint8Array(N);
    this.alive = new Uint8Array(N);
    this.hp = new Float32Array(N);
    this.dmg = new Float32Array(N);
    this.mask = new Uint8Array(N);
    this.colliders = new Array(N).fill(null);
    this.floorOrig = new Int32Array(this.ny);
    this.floorAlive = new Int32Array(this.ny);
    this.colTop = new Int32Array(this.nx * this.nz); // number of alive floors from bottom (top alive index + 1)
    this.totalCells = 0;
    this.destroyedCells = 0;
    this.sections = [];
    this.props = [];
    this.structDirty = false;
    this.warn = 0;
    this.warnTimer = 0;
    this.collapsedOnce = false;
    this.occupants = def.occupants ?? 20;
    this.color = new THREE.Color(def.style.wallA);
    this.concrete = new THREE.Color(0.3, 0.285, 0.265);

    for (let z = 0; z < this.nz; z++) {
      for (let x = 0; x < this.nx; x++) {
        const h = this.heights[x + z * this.nx];
        for (let y = 0; y < h; y++) {
          const i = this.idx(x, y, z);
          this.exists[i] = 1;
          this.alive[i] = 1;
          this.hp[i] = y === 0 ? 1.5 : y < 3 ? 1.25 : 1.0;
          this.floorOrig[y]++;
          this.totalCells++;
        }
      }
    }
    this.floorAlive.set(this.floorOrig);
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) this.colTop[x + z * this.nx] = this.heights[x + z * this.nx];

    // exterior masks
    for (let y = 0; y < this.ny; y++) for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const i = this.idx(x, y, z);
      if (!this.exists[i]) continue;
      let m = 0;
      if (!this._existsAt(x + 1, y, z)) m |= BIT.PX;
      if (!this._existsAt(x - 1, y, z)) m |= BIT.NX;
      if (!this._existsAt(x, y + 1, z)) m |= BIT.PY;
      if (y > 0 && !this._existsAt(x, y - 1, z)) m |= BIT.NY;
      if (!this._existsAt(x, y, z + 1)) m |= BIT.PZ;
      if (!this._existsAt(x, y, z - 1)) m |= BIT.NZ;
      this.mask[i] = m;
    }

    if (!sharedBox) sharedBox = new THREE.BoxGeometry(S, H, S);
    const geo = sharedBox.clone();
    this.info = new Float32Array(N * 3);
    this.seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.info[i * 3] = this.mask[i];
      this.info[i * 3 + 1] = 0;
      this.info[i * 3 + 2] = Math.random();
    }
    this.infoAttr = new THREE.InstancedBufferAttribute(this.info, 3);
    this.infoAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', this.infoAttr);
    // electrical state per cell (1 steady, 0 dead, between = failing/flickering)
    this.power = new Float32Array(N).fill(1);
    this.powAttr = new THREE.InstancedBufferAttribute(this.power, 1);
    this.powAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPow', this.powAttr);
    this.blackout = -1; // floor index currently failing during a cascade (-1 = none)
    this.blackoutT = 0;
    this.geo = geo;
    this.material = createBuildingMaterial(def.style);
    this.mesh = new THREE.InstancedMesh(geo, this.material, N);
    this.mesh.position.set(this.x0, 0, this.z0);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.updateMatrix();
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrixWorld(true);
    this.mesh.userData.building = this;
    for (let i = 0; i < N; i++) this._refreshCell(i, false);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.computeBoundingBox();
    ctx.root.add(this.mesh);
    this.visualDirty = false;
  }

  idx(x, y, z) { return x + this.nx * (z + this.nz * y); }
  coords(i) {
    const x = i % this.nx;
    const t = (i - x) / this.nx;
    const z = t % this.nz;
    const y = (t - z) / this.nz;
    return [x, y, z];
  }
  _existsAt(x, y, z) {
    if (x < 0 || z < 0 || y < 0 || x >= this.nx || z >= this.nz || y >= this.ny) return false;
    return this.exists[this.idx(x, y, z)] === 1;
  }
  aliveAt(x, y, z) {
    if (x < 0 || z < 0 || y < 0 || x >= this.nx || z >= this.nz || y >= this.ny) return false;
    return this.alive[this.idx(x, y, z)] === 1;
  }
  isExposed(i) {
    const [x, y, z] = this.coords(i);
    return !this.aliveAt(x + 1, y, z) || !this.aliveAt(x - 1, y, z) || !this.aliveAt(x, y + 1, z)
      || (y > 0 && !this.aliveAt(x, y - 1, z)) || !this.aliveAt(x, y, z + 1) || !this.aliveAt(x, y, z - 1);
  }
  cellCenterLocal(i, out) {
    const [x, y, z] = this.coords(i);
    return out.set((x + 0.5) * S, (y + 0.5) * H, (z + 0.5) * S);
  }
  cellCenterWorld(i, out) {
    this.cellCenterLocal(i, out);
    out.x += this.x0; out.z += this.z0;
    return out;
  }
  // world point -> cell index (or -1)
  cellAt(wx, wy, wz) {
    const x = Math.floor((wx - this.x0) / S), y = Math.floor(wy / H), z = Math.floor((wz - this.z0) / S);
    if (x < 0 || z < 0 || y < 0 || x >= this.nx || z >= this.nz || y >= this.ny) return -1;
    return this.idx(x, y, z);
  }
  solidAt(wx, wy, wz) {
    const i = this.cellAt(wx, wy, wz);
    return i >= 0 && this.alive[i] === 1;
  }
  inFootprint(wx, wz, pad = 0) {
    return wx >= this.x0 - pad && wx <= this.x0 + this.width + pad && wz >= this.z0 - pad && wz <= this.z0 + this.depth + pad;
  }
  // height of the top of the highest alive cell in the column under (wx,wz), or 0
  columnTopAt(wx, wz) {
    const x = Math.floor((wx - this.x0) / S), z = Math.floor((wz - this.z0) / S);
    if (x < 0 || z < 0 || x >= this.nx || z >= this.nz) return 0;
    return this.colTop[x + z * this.nx] * H;
  }
  // highest alive surface under a given height (for standing on broken floors / roofs)
  supportAt(wx, wz, maxY) {
    const x = Math.floor((wx - this.x0) / S), z = Math.floor((wz - this.z0) / S);
    if (x < 0 || z < 0 || x >= this.nx || z >= this.nz) return -1;
    const top = Math.min(this.ny - 1, Math.floor(maxY / H));
    for (let y = top; y >= 0; y--) {
      if (this.alive[this.idx(x, y, z)] && (y + 1) * H <= maxY + 0.01) return (y + 1) * H;
    }
    return -1;
  }

  _refreshCell(i, collider = true) {
    if (this.alive[i] && this.isExposed(i)) {
      this.cellCenterLocal(i, _p);
      const d = this.dmg[i];
      if (d > 0.25) {
        // damaged cells sag and twist a little: breaks the clean grid look around holes
        const h = this.info[i * 3 + 2] % 1;
        const k = (d - 0.25) * 1.3;
        _e.set((h - 0.5) * 0.18 * k, (h * 7 % 1 - 0.5) * 0.12 * k, ((h * 13) % 1 - 0.5) * 0.18 * k);
        _q.setFromEuler(_e);
        const sc = 1 - 0.07 * k;
        _s.set(sc, 1 - 0.04 * k, sc);
        _p.y -= 0.25 * k;
      } else {
        _q.identity();
        _s.set(1, 1, 1);
      }
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      if (collider && !this.colliders[i]) {
        this.cellCenterWorld(i, _v);
        this.colliders[i] = this.ctx.physics.fixedBox(_v.x, _v.y, _v.z, S / 2, H / 2, S / 2);
      }
    } else {
      this.mesh.setMatrixAt(i, ZERO);
      if (this.colliders[i]) {
        this.ctx.physics.removeCollider(this.colliders[i]);
        this.colliders[i] = null;
      }
    }
    this.visualDirty = true;
  }

  // Create colliders for the initial exposed shell.
  buildColliders() {
    for (let i = 0; i < this.N; i++) if (this.alive[i] && this.isExposed(i)) this._refreshCell(i, true);
  }

  _refreshNeighbors(i) {
    const [x, y, z] = this.coords(i);
    const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const [dx, dy, dz] of nb) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= this.nx || Y >= this.ny || Z >= this.nz) continue;
      const j = this.idx(X, Y, Z);
      if (this.alive[j]) this._refreshCell(j);
    }
  }

  // Remove a cell from the standing structure. `effects` = 0 none, 1 light, 2 full.
  removeCell(i, effects = 2, dir = null, intensity = 1) {
    if (!this.alive[i]) return false;
    this.alive[i] = 0;
    const [x, y, z] = this.coords(i);
    this.floorAlive[y]--;
    this.destroyedCells++;
    this.ctx.stats.destroyedCells++;
    const ci = x + z * this.nx;
    if (this.colTop[ci] === y + 1) {
      let t = y;
      while (t > 0 && !this.alive[this.idx(x, t - 1, z)]) t--;
      this.colTop[ci] = t;
    }
    this._refreshCell(i);
    this._refreshNeighbors(i);
    this.structDirty = true;
    if (this.power[i] > 0.4 && y > 0 && Math.random() < 0.05 && this.ctx.fires) {
      const c = this.cellCenterWorld(i, new THREE.Vector3());
      const en = this.exteriorNormalOf(i, new THREE.Vector3());
      if (en) { c.addScaledVector(en, 1.5); c.y -= 1.5; this.ctx.fires.start(c.x, c.y, c.z, 30 + Math.random() * 40, 0.8); }
    }
    this.power[i] = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Z = z + dz;
      if (X >= 0 && Z >= 0 && X < this.nx && Z < this.nz) this.setPower(this.idx(X, y, Z), 0.55);
    }
    this.powAttr.needsUpdate = true;
    if (effects > 0) this.spawnBreakEffects(i, dir, intensity, effects);
    for (const p of this.props) if (p.cell === i && !p.gone) this.ctx.props.detachRoofProp(p, this);
    return true;
  }

  exteriorNormalOf(i, out) {
    const m = this.mask[i];
    if (m & BIT.PX) return out.set(1, 0, 0);
    if (m & BIT.NX) return out.set(-1, 0, 0);
    if (m & BIT.PZ) return out.set(0, 0, 1);
    if (m & BIT.NZ) return out.set(0, 0, -1);
    return null;
  }

  spawnBreakEffects(i, dir, intensity = 1, level = 2) {
    const fx = this.ctx.fx;
    const c = this.cellCenterWorld(i, new THREE.Vector3());
    const extN = this.exteriorNormalOf(i, _n);
    const color = extN ? this.color : this.concrete;
    const out = extN ? extN.clone() : new THREE.Vector3(c.x - this.cx, 0, c.z - this.cz).normalize();
    const budget = this.ctx.budget;
    if (level >= 2 && budget.physics > 0) {
      budget.physics--;
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const size = new THREE.Vector3(1.4 + Math.random() * 1.8, 0.9 + Math.random() * 1.2, 1.4 + Math.random() * 1.8);
        const v = new THREE.Vector3(
          out.x * (4 + Math.random() * 8) + (Math.random() - 0.5) * 6,
          Math.random() * 6,
          out.z * (4 + Math.random() * 8) + (Math.random() - 0.5) * 6,
        );
        if (dir) v.addScaledVector(dir, 8 * intensity * (Math.random() < 0.5 ? 1 : -0.6));
        const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
        this.ctx.debris.spawn(p, v, size, _c.copy(color).multiplyScalar(0.75 + Math.random() * 0.35));
      }
    }
    if (budget.chips > 0) {
      budget.chips--;
      fx.chipBurst(c, out, color, level >= 2 ? 10 : 4, 9 * intensity, 1.2);
    }
    if (extN && budget.glass > 0) {
      budget.glass--;
      fx.glassBurst(c.clone().addScaledVector(extN, 2.1), extN, level >= 2 ? 14 : 6, 3.5);
    }
    if (budget.dust > 0) {
      budget.dust--;
      fx.impactDust(c.clone().addScaledVector(out, 2), out, level >= 2 ? 1.1 : 0.6);
    }
  }

  // Apply damage in a sphere (world space). Returns { destroyed, damaged, ground }.
  damageSphere(p, radius, amount, dir, opts = {}) {
    const res = { destroyed: 0, damaged: 0, ground: 0, glass: 0 };
    const lx = p.x - this.x0, lz = p.z - this.z0;
    const x0 = Math.max(0, Math.floor((lx - radius) / S)), x1 = Math.min(this.nx - 1, Math.floor((lx + radius) / S));
    const z0 = Math.max(0, Math.floor((lz - radius) / S)), z1 = Math.min(this.nz - 1, Math.floor((lz + radius) / S));
    const y0 = Math.max(0, Math.floor((p.y - radius) / H)), y1 = Math.min(this.ny - 1, Math.floor((p.y + radius) / H));
    if (x0 > x1 || z0 > z1 || y0 > y1) return res;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, y, z);
      if (!this.alive[i]) continue;
      // distance from sphere center to the cell box
      const cxl = Math.max(x * S, Math.min(lx, (x + 1) * S));
      const cyl = Math.max(y * H, Math.min(p.y, (y + 1) * H));
      const czl = Math.max(z * S, Math.min(lz, (z + 1) * S));
      const dx = cxl - lx, dy = cyl - p.y, dz = czl - lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) continue;
      const fall = 1 - d / radius;
      const dealt = amount * (0.25 + 0.75 * fall) * (opts.mult ?? 1);
      this.hp[i] -= dealt;
      if (y === 0) res.ground++;
      if (this.hp[i] <= 0) {
        this.removeCell(i, 2, dir, Math.min(2, amount));
        res.destroyed++;
      } else {
        const before = this.dmg[i];
        const nd = Math.min(1, 1 - this.hp[i] / (y === 0 ? 1.5 : y < 3 ? 1.25 : 1.0) + 0.1);
        this.dmg[i] = Math.max(before, nd);
        this.info[i * 3 + 1] = this.dmg[i];
        // damaged rooms: lights flicker, then die
        this.setPower(i, nd > 0.6 ? 0 : nd > 0.3 ? 0.45 : 0.85);
        this.infoAttr.needsUpdate = true;
        this._refreshCell(i);
        res.damaged++;
        if (this.mask[i] && nd - before > 0.15) {
          res.glass++;
          if (this.exteriorNormalOf(i, _n) && this.ctx.budget.glass > 0) {
            this.ctx.budget.glass--;
            const c = this.cellCenterWorld(i, new THREE.Vector3()).addScaledVector(_n, 2.1);
            this.ctx.fx.glassBurst(c, _n, 8, 3.5);
          }
          // facade panels peeling off
          if (Math.random() < 0.5 && this.ctx.budget.physics > 0 && this.exteriorNormalOf(i, _n)) {
            this.ctx.budget.physics--;
            const c = this.cellCenterWorld(i, new THREE.Vector3()).addScaledVector(_n, 2.3);
            const size = new THREE.Vector3(Math.abs(_n.x) > 0.5 ? 0.35 : 2.2, 1.4 + Math.random(), Math.abs(_n.z) > 0.5 ? 0.35 : 2.2);
            this.ctx.debris.spawn(c, _n.clone().multiplyScalar(4 + Math.random() * 4).add(new THREE.Vector3(0, 2, 0)), size, this.color);
          }
        }
      }
    }
    if (res.destroyed || res.damaged) this.structDirty = true;
    return res;
  }

  // ---------- structural evaluation ----------
  // Power only ever decreases: the city never magically repairs itself.
  setPower(i, v) {
    if (v < this.power[i]) { this.power[i] = v; this.powAttr.needsUpdate = true; }
  }

  setFloorPower(f, v) {
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) this.setPower(this.idx(x, f, z), v);
  }

  // Electrical response to structural state: floors losing their supports brown out.
  _updatePowerFromStructure() {
    for (let f = 0; f < this.ny; f++) {
      if (!this.floorOrig[f]) continue;
      const r = this.floorAlive[f] / this.floorOrig[f];
      if (r < 0.6) { this.setFloorPower(f, 0); if (f + 1 < this.ny) this.setFloorPower(f + 1, 0.5); }
      else if (r < 0.88) this.setFloorPower(f, 0.6);
    }
    if (this.warn > 0.3 && this.warnFloor >= 0) {
      for (let f = Math.max(0, this.warnFloor - 1); f < Math.min(this.ny, this.warnFloor + 3); f++) this.setFloorPower(f, 0.75);
    }
    // badly wrecked buildings lose power altogether, floor by floor from the top
    if (this.blackout < 0 && this.destroyedFraction > 0.38) { this.blackout = this.ny - 1; this.blackoutT = 0; }
  }

  analyze() {
    this.structDirty = false;
    // 1) load-bearing floor failure (lowest failing floor wins)
    let aliveAbove = 0;
    const aliveAboveArr = new Int32Array(this.ny);
    for (let f = this.ny - 1; f >= 0; f--) { aliveAboveArr[f] = aliveAbove; aliveAbove += this.floorAlive[f]; }
    let fail = -1, warn = -1, warnRatio = 0;
    for (let f = 0; f < this.ny - 1; f++) {
      if (!this.floorOrig[f] || !aliveAboveArr[f]) continue;
      let floorsAbove = 0;
      for (let g = f + 1; g < this.ny; g++) if (this.floorAlive[g] > 0) floorsAbove++;
      const ratio = this.floorAlive[f] / this.floorOrig[f];
      const req = Math.min(0.68, Math.max(0.26, 0.26 + 0.02 * floorsAbove));
      if (ratio < req) { fail = f; break; }
      // a side gouged out deep enough lets a tall section tip off that side
      if (floorsAbove >= 4 && this._sideFailure(f)) { fail = f; break; }
      if (ratio < req + 0.14 && warn < 0) { warn = f; warnRatio = (ratio - req) / 0.14; }
    }
    if (fail >= 0) {
      this._startFloorCollapse(fail);
      this.warn = 0;
    } else {
      this.warn = warn >= 0 ? 1 - warnRatio : 0;
      this.warnFloor = warn;
    }
    // 2) connectivity to the ground: anything floating falls
    this._dropIslands();
    this._updatePowerFromStructure();
  }

  // True when the two outer rows along one face of floor f are mostly gone.
  _sideFailure(f) {
    const sides = [
      (x, z) => x <= 1, (x, z) => x >= this.nx - 2, (x, z) => z <= 1, (x, z) => z >= this.nz - 2,
    ];
    if (this.nx < 4 || this.nz < 4) return false;
    for (const inSide of sides) {
      let tot = 0, dead = 0;
      for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
        if (!inSide(x, z)) continue;
        const i = this.idx(x, f, z);
        if (!this.exists[i]) continue;
        tot++;
        if (!this.alive[i]) dead++;
      }
      if (tot > 0 && dead / tot > 0.72) return true;
    }
    return false;
  }

  _startFloorCollapse(f) {
    // tilt toward the side whose supports are missing
    let mx = 0, mz = 0, miss = 0;
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const i = this.idx(x, f, z);
      if (this.exists[i] && !this.alive[i]) {
        mx += (x + 0.5) / this.nx - 0.5;
        mz += (z + 0.5) / this.nz - 0.5;
        miss++;
      }
    }
    let tx = 0, tz = 0;
    if (miss > 0) { tx = (mx / miss) * 2; tz = (mz / miss) * 2; }
    const members = [];
    for (let y = f; y < this.ny; y++) for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const i = this.idx(x, y, z);
      if (this.alive[i]) members.push(i);
    }
    if (!members.length) return;
    const floors = this.ny - f;
    this._makeSection(members, {
      baseY: f * H,
      tilt: new THREE.Vector2(tx, tz),
      sag: floors > 3 ? 0.9 : 0.45,
      pancake: Math.min(0.85, Math.max(0, (floors - 3) / 12)),
      major: true,
    });
    this.collapsedOnce = true;
  }

  _dropIslands() {
    const N = this.N;
    const seen = new Uint8Array(N);
    const stack = [];
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const i = this.idx(x, 0, z);
      if (this.alive[i]) { seen[i] = 1; stack.push(i); }
    }
    while (stack.length) {
      const i = stack.pop();
      const [x, y, z] = this.coords(i);
      const nb = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
      for (const [X, Y, Z] of nb) {
        if (X < 0 || Y < 0 || Z < 0 || X >= this.nx || Y >= this.ny || Z >= this.nz) continue;
        const j = this.idx(X, Y, Z);
        if (this.alive[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const members = [];
    let minY = 1e9, sx = 0, sz = 0;
    for (let i = 0; i < N; i++) {
      if (this.alive[i] && !seen[i]) {
        members.push(i);
        const [x, y, z] = this.coords(i);
        minY = Math.min(minY, y);
        sx += (x + 0.5) / this.nx - 0.5; sz += (z + 0.5) / this.nz - 0.5;
      }
    }
    if (members.length) {
      const k = members.length;
      this._makeSection(members, { baseY: minY * H, tilt: new THREE.Vector2(sx / k, sz / k).multiplyScalar(2), sag: 0.15, pancake: 0.2, major: members.length > 30 });
    }
  }

  _makeSection(members, opts) {
    for (const i of members) {
      this.alive[i] = 0;
      const [x, , z] = this.coords(i);
      this.floorAlive[this.coords(i)[1]]--;
      this._refreshCell(i);
      const ci = x + z * this.nx;
      let t = this.colTop[ci];
      while (t > 0 && !this.alive[this.idx(x, t - 1, z)]) t--;
      this.colTop[ci] = t;
    }
    for (const i of members) this._refreshNeighbors(i);
    const sec = new CollapseSection(this, members, opts);
    this.sections.push(sec);
    for (const p of this.props) if (!p.gone && members.includes(p.cell)) p.section = sec;
    this.ctx.events.emit('collapseStart', { building: this, section: sec, x: this.cx, z: this.cz, size: members.length, y: opts.baseY });
  }

  update(dt) {
    if (this.structDirty) this.analyze();
    if (this.blackout >= 0) {
      // cascading electrical failure: floors flicker and die one after another, with sparks
      this.blackoutT -= dt;
      if (this.blackoutT <= 0) {
        this.blackoutT = 0.12 + Math.random() * 0.12;
        const f = this.blackout;
        this.setFloorPower(f, 0);
        if (f > 0) this.setFloorPower(f - 1, 0.4);
        const side = Math.floor(Math.random() * 4);
        const sx = side < 2 ? this.x0 + (side ? this.width : 0) : this.x0 + Math.random() * this.width;
        const sz = side >= 2 ? this.z0 + (side === 3 ? this.depth : 0) : this.z0 + Math.random() * this.depth;
        if (Math.random() < 0.5) this.ctx.fx.sparks(new THREE.Vector3(sx, (f + 0.5) * H, sz), new THREE.Vector3(0, -0.3, 0), 10, [1, 0.85, 0.5]);
        if (f % 3 === 0) this.ctx.events.emit('powerFail', { x: sx, y: (f + 0.5) * H, z: sz });
        this.blackout--;
        if (this.blackout < 0) this.blackout = -2; // done
      }
    }
    for (let k = this.sections.length - 1; k >= 0; k--) {
      const s = this.sections[k];
      s.update(dt);
      if (s.done) { s.dispose(); this.sections.splice(k, 1); }
    }
    if (this.warn > 0) {
      // the structure is close to failing: shed dust and debris, groan
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.warnTimer = 0.25 + Math.random() * (1.2 - this.warn * 0.8);
        const y = (this.warnFloor + 1) * H;
        const side = Math.floor(Math.random() * 4);
        const px = side < 2 ? this.x0 + (side ? this.width : 0) : this.x0 + Math.random() * this.width;
        const pz = side >= 2 ? this.z0 + (side === 3 ? this.depth : 0) : this.z0 + Math.random() * this.depth;
        this.ctx.fx.impactDust(new THREE.Vector3(px, y, pz), new THREE.Vector3(0, -0.4, 0), 0.5);
        if (Math.random() < 0.4) this.ctx.fx.chipBurst(new THREE.Vector3(px, y, pz), new THREE.Vector3(0, -1, 0), this.concrete, 5, 3);
        if (Math.random() < 0.35 * this.warn) this.ctx.events.emit('groan', { x: this.cx, y, z: this.cz, strength: this.warn });
      }
    }
    if (this.visualDirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.visualDirty = false;
    }
  }

  get destroyedFraction() { return this.destroyedCells / this.totalCells; }

  dispose() {
    for (const s of this.sections) s.dispose();
    this.geo.dispose();
    this.material.dispose();
    this.ctx.root.remove(this.mesh);
  }
}

export { BIT };
