import * as THREE from 'three';
import { HumanRenderer } from '../city/HumanRenderer.js';
import { ROAD_CENTERS, CITY_HALF } from '../world/City.js';
import { Held } from '../core/Held.js';
import { part, merge, box, cyl, sphere } from '../core/geom.js';
import { pick, clamp, dampAngle, angleDiff } from '../core/util.js';
import { GORILLA } from '../config.js';
import { patchCityLight } from '../render/CityLights.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// Escalation table: quotas per response level.
const LEVELS = [
  { soldiers: 0, tanks: 0, helis: 0, name: '' },
  { soldiers: 7, tanks: 0, helis: 0, name: 'INFANTRY DEPLOYED' },
  { soldiers: 10, tanks: 0, helis: 1, name: 'AIR SUPPORT INBOUND' },
  { soldiers: 14, tanks: 2, helis: 1, name: 'ARMOR ROLLING IN' },
  { soldiers: 18, tanks: 3, helis: 2, name: 'HEAVY RESPONSE' },
  { soldiers: 24, tanks: 4, helis: 3, name: 'FULL ASSAULT' },
  { soldiers: 30, tanks: 5, helis: 4, name: 'LAST STAND' },
];

function tankGeometry() {
  const O = 0x4e5532, D = 0x1e201a, M = 0x3f4529, T = 0x2b2d24, H = new THREE.Color(5, 4.6, 3.6);
  const hull = merge([
    part(box(3.4, 1.1, 7.0), O, { y: 1.35 }),
    part(box(3.2, 0.55, 1.5), M, { y: 1.62, z: 3.35, rx: -0.55 }),
    part(box(3.2, 0.45, 1.0), M, { y: 1.5, z: -3.45, rx: 0.4 }),
    // tracks and running gear
    part(box(0.95, 1.15, 7.4), T, { x: 1.95, y: 0.6 }),
    part(box(0.95, 1.15, 7.4), T, { x: -1.95, y: 0.6 }),
    ...[-2.8, -1.4, 0, 1.4, 2.8].flatMap((z) => [
      part(cyl(0.48, 0.48, 1.0, 12), 0x33352b, { x: 1.95, y: 0.55, z, rz: Math.PI / 2 }),
      part(cyl(0.48, 0.48, 1.0, 12), 0x33352b, { x: -1.95, y: 0.55, z, rz: Math.PI / 2 }),
    ]),
    // armoured side skirts, fenders, stowage boxes
    part(box(0.12, 0.75, 7.0), O, { x: 2.47, y: 1.0 }),
    part(box(0.12, 0.75, 7.0), O, { x: -2.47, y: 1.0 }),
    part(box(1.1, 0.1, 7.7), O, { x: 1.95, y: 1.42 }),
    part(box(1.1, 0.1, 7.7), O, { x: -1.95, y: 1.42 }),
    part(box(0.8, 0.45, 1.4), M, { x: 1.9, y: 1.7, z: -2.4 }),
    part(box(0.8, 0.45, 1.4), M, { x: -1.9, y: 1.7, z: -2.4 }),
    // engine grille and exhausts
    part(box(2.4, 0.08, 1.8), D, { y: 1.92, z: -2.5 }),
    part(cyl(0.16, 0.16, 0.5, 8), D, { x: 1.2, y: 1.6, z: -3.75, rx: Math.PI / 2 }),
    part(cyl(0.16, 0.16, 0.5, 8), D, { x: -1.2, y: 1.6, z: -3.75, rx: Math.PI / 2 }),
    // headlight housings + lamps (lit)
    part(box(0.45, 0.3, 0.2), D, { x: 1.2, y: 1.85, z: 3.75 }),
    part(box(0.45, 0.3, 0.2), D, { x: -1.2, y: 1.85, z: 3.75 }),
    part(box(0.32, 0.18, 0.04), H, { x: 1.2, y: 1.85, z: 3.86 }),
    part(box(0.32, 0.18, 0.04), H, { x: -1.2, y: 1.85, z: 3.86 }),
  ]);
  const turret = merge([
    part(box(2.8, 0.95, 3.2), O, { y: 0.47 }),
    part(box(2.4, 0.7, 1.1), M, { y: 0.4, z: 1.8, rx: 0.45 }),
    part(box(2.5, 0.8, 1.3), O, { y: 0.45, z: -2.1 }),
    // commander's cupola, sights, MG, antennas, smoke dischargers
    part(cyl(0.48, 0.52, 0.45, 10), M, { x: 0.7, y: 1.15, z: -0.5 }),
    part(box(0.12, 0.12, 1.1), D, { x: 0.7, y: 1.45, z: -0.1 }),
    part(box(0.45, 0.4, 0.5), D, { x: -0.75, y: 1.15, z: 0.6 }),
    part(box(0.05, 2.4, 0.05), D, { x: -1.0, y: 2.0, z: -2.4 }),
    part(box(0.05, 1.8, 0.05), D, { x: 1.0, y: 1.7, z: -2.5 }),
    ...[-0.25, 0, 0.25].flatMap((dz) => [
      part(cyl(0.08, 0.08, 0.35, 6), D, { x: 1.4, y: 0.75, z: 0.9 + dz, rz: -0.9 }),
      part(cyl(0.08, 0.08, 0.35, 6), D, { x: -1.4, y: 0.75, z: 0.9 + dz, rz: 0.9 }),
    ]),
  ]);
  const barrel = merge([
    part(cyl(0.17, 0.2, 5.0, 10), D, { z: 2.5, rx: Math.PI / 2 }),
    part(cyl(0.27, 0.27, 0.9, 10), D, { z: 2.1, rx: Math.PI / 2 }),
    part(cyl(0.25, 0.25, 0.55, 10), D, { z: 4.95, rx: Math.PI / 2 }),
    part(box(0.6, 0.5, 0.6), M, { y: 0.0, z: 0.1 }),
  ]);
  return { hull, turret, barrel };
}

function heliGeometry() {
  const B = 0x2c342d, L = 0x3d463c, D = 0x181b17, G = 0x0e151c, M = 0x4a4f48;
  const body = merge([
    // tapered fuselage: nose, cabin, engine deck
    part(sphere(1, 14, 10), B, { sx: 1.0, sy: 1.05, sz: 2.6, y: 0, z: 0.2 }),
    part(sphere(1, 12, 8), B, { sx: 0.72, sy: 0.8, sz: 1.6, y: -0.15, z: 2.5 }),
    part(sphere(1, 10, 8), L, { sx: 0.95, sy: 0.4, sz: 2.4, y: -0.75, z: 0.3 }),
    // tandem canopy
    part(sphere(1, 12, 8), G, { sx: 0.62, sy: 0.55, sz: 0.95, y: 0.62, z: 2.1 }),
    part(sphere(1, 12, 8), G, { sx: 0.62, sy: 0.6, sz: 0.9, y: 0.85, z: 0.9 }),
    part(box(0.08, 0.5, 1.9), M, { y: 0.85, z: 1.5 }),
    // engine nacelles + exhausts
    part(cyl(0.48, 0.42, 2.6, 10), B, { x: 0.95, y: 0.75, z: -0.4, rx: Math.PI / 2 }),
    part(cyl(0.48, 0.42, 2.6, 10), B, { x: -0.95, y: 0.75, z: -0.4, rx: Math.PI / 2 }),
    part(cyl(0.3, 0.36, 0.6, 8), D, { x: 1.1, y: 0.8, z: -1.9, rx: Math.PI / 2 - 0.3 }),
    part(cyl(0.3, 0.36, 0.6, 8), D, { x: -1.1, y: 0.8, z: -1.9, rx: Math.PI / 2 - 0.3 }),
    part(cyl(0.3, 0.42, 0.9, 10), D, { y: 1.45, z: 0.1 }),
    // tail boom, fin, stabilizer, tail wheel
    part(cyl(0.3, 0.6, 6.8, 10), B, { z: -4.9, rx: Math.PI / 2, y: 0.35 }),
    part(box(0.16, 2.1, 1.3), B, { y: 1.2, z: -8.2, rx: -0.35 }),
    part(box(3.1, 0.1, 0.85), B, { y: 0.45, z: -7.7 }),
    part(cyl(0.2, 0.2, 0.18, 8), D, { y: -0.4, z: -7.6, rz: Math.PI / 2 }),
    // stub wings with rocket pods and missile rails
    part(box(4.4, 0.14, 1.1), B, { y: -0.05, z: 0.1 }),
    part(cyl(0.3, 0.3, 1.7, 10), M, { x: 1.6, y: -0.45, z: 0.25, rx: Math.PI / 2 }),
    part(cyl(0.3, 0.3, 1.7, 10), M, { x: -1.6, y: -0.45, z: 0.25, rx: Math.PI / 2 }),
    part(box(0.12, 0.12, 1.6), D, { x: 2.2, y: -0.3, z: 0.2 }),
    part(box(0.12, 0.12, 1.6), D, { x: -2.2, y: -0.3, z: 0.2 }),
    // chin gun turret
    part(sphere(0.32, 8, 6), D, { y: -0.95, z: 2.75 }),
    part(cyl(0.07, 0.07, 1.5, 6), D, { y: -1.0, z: 3.55, rx: Math.PI / 2 }),
    // main landing gear
    part(cyl(0.32, 0.32, 0.22, 10), D, { x: 0.9, y: -1.45, z: 1.0, rz: Math.PI / 2 }),
    part(cyl(0.32, 0.32, 0.22, 10), D, { x: -0.9, y: -1.45, z: 1.0, rz: Math.PI / 2 }),
    part(box(0.12, 0.7, 0.12), D, { x: 0.85, y: -1.1, z: 1.0, rz: 0.3 }),
    part(box(0.12, 0.7, 0.12), D, { x: -0.85, y: -1.1, z: 1.0, rz: -0.3 }),
  ]);
  const rotor = merge([
    part(box(13.8, 0.07, 0.5), D, {}),
    part(box(0.5, 0.07, 13.8), D, {}),
    part(cyl(0.4, 0.4, 0.32, 8), D, {}),
  ]);
  const tail = merge([part(box(0.06, 2.4, 0.3), D, {}), part(box(0.06, 0.3, 2.4), D, {})]);
  return { body, rotor, tail };
}

const UNIFORM = { shirt: new THREE.Color(0x4f5a2a), pants: new THREE.Color(0x3c4321), helmet: new THREE.Color(0x343b1d) };
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac].map((h) => new THREE.Color(h));

export class Military {
  constructor(ctx) {
    this.ctx = ctx;
    this.soldierRenderer = new HumanRenderer(ctx.root, 80, { soldier: true });
    this.soldiers = [];
    this.tanks = [];
    this.helis = [];
    this.shots = [];
    this.level = 0;
    this.time = 0;
    this.spawnCd = { soldier: 2, tank: 6, heli: 3 };
    this.kills = { soldiers: 0, tanks: 0, helis: 0 };
    this.suppressT = 0;
    const mat = patchCityLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
    this.mat = mat;
    this.tankGeo = tankGeometry();
    this.heliGeo = heliGeometry();
    this.rotorMat = new THREE.MeshStandardMaterial({ color: 0x1a1d18, roughness: 0.6, transparent: true, opacity: 0.55 });
    // tracer pool
    const tg = new THREE.BoxGeometry(0.12, 0.12, 4);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.4), toneMapped: false });
    this.tracers = new THREE.InstancedMesh(tg, tm, 400);
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    this.tracers.userData.noAO = true;
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ctx.root.add(this.tracers);
  }

  // ---------------- director ----------------
  _targetLevel() {
    const d = this.ctx.city.destroyedPercent;
    const t = this.time;
    if (d >= 48) return 6;
    if (d >= 33 || t > 200) return 5;
    if (d >= 19 || t > 130) return 4;
    if (d >= 8 || t > 70) return 3;
    if (d >= 1.2 || t > 18) return 2;
    if (t > 3) return 1;
    return 0;
  }

  update(dt, camPos) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    this.time += dt;
    this.suppressT -= dt;
    const tl = this._targetLevel();
    if (tl > this.level) {
      this.level = tl;
      ctx.events.emit('levelUp', { level: tl, name: LEVELS[tl].name });
    }
    const L = LEVELS[this.level];
    for (const k in this.spawnCd) this.spawnCd[k] -= dt;
    if (g && g.alive && !this.retreat) {
      const aliveSoldiers = this.soldiers.filter((s) => s.state !== 'dead' && s.state !== 'held').length;
      if (aliveSoldiers < L.soldiers && this.spawnCd.soldier <= 0) {
        this._spawnSquad(Math.min(L.soldiers - aliveSoldiers, 3 + Math.floor(Math.random() * 3)));
        this.spawnCd.soldier = 4;
      }
      if (this.tanks.filter((t) => t.hp > 0 && !t.held).length < L.tanks && this.spawnCd.tank <= 0) { this._spawnTank(); this.spawnCd.tank = 10; }
      if (this.helis.filter((h) => h.hp > 0 && !h.held).length < L.helis && this.spawnCd.heli <= 0) { this._spawnHeli(); this.spawnCd.heli = 12; }
    }
    this._updateSoldiers(dt, camPos);
    this._updateTanks(dt);
    this._updateHelis(dt);
    this._updateShots(dt);
  }

  // ---------------- spawning ----------------
  _streetPointNear(center, rMin, rMax) {
    for (let k = 0; k < 30; k++) {
      const c = pick(ROAD_CENTERS);
      const along = center ? (Math.random() * 2 - 1) * rMax + (Math.random() < 0.5 ? center.x : center.z) : 0;
      const vertical = Math.random() < 0.5;
      const off = (Math.random() * 2 - 1) * 9;
      const x = vertical ? c + off : along;
      const z = vertical ? along : c + off;
      const d = Math.hypot(x - center.x, z - center.z);
      if (d < rMin || d > rMax || Math.abs(x) > CITY_HALF + 40 || Math.abs(z) > CITY_HALF + 40) continue;
      if (this.ctx.city.solidAt(x, 1, z)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  _spawnSquad(n) {
    const g = this.ctx.gorilla;
    const rooftop = Math.random() < 0.3;
    let base = null, roofB = null;
    if (rooftop) {
      const cands = this.ctx.city.buildingsNear(g.pos.x, g.pos.z, 110).filter((b) => {
        const d = Math.hypot(b.cx - g.pos.x, b.cz - g.pos.z);
        return d > 35 && b.height > 14 && b.height < 90 && !b.collapsedOnce;
      });
      if (cands.length) {
        roofB = pick(cands);
        const top = roofB.supportAt(roofB.cx, roofB.cz, 1000);
        if (top > 0) base = new THREE.Vector3(roofB.cx, top, roofB.cz);
      }
    }
    if (!base) base = this._streetPointNear(g.pos, 90, 150);
    if (!base) return;
    for (let i = 0; i < n; i++) {
      const s = {
        x: base.x + (Math.random() - 0.5) * (roofB ? roofB.width * 0.6 : 8),
        y: base.y,
        z: base.z + (Math.random() - 0.5) * (roofB ? roofB.depth * 0.6 : 8),
        yaw: 0, phase: Math.random() * 10, anim: 'run', state: roofB ? 'aim' : 'move',
        colors: { ...UNIFORM, skin: pick(SKINS) }, scale: 1.08,
        fireCd: 1 + Math.random() * 2, burst: 0, burstCd: 0, tx: 0,
        goal: null, roof: !!roofB, rocket: this.level >= 3 && Math.random() < 0.3, hp: 1,
        vx: 0, vy: 0, vz: 0, dead: 0,
      };
      if (roofB) s.y = roofB.supportAt(s.x, s.z, 1000);
      if (s.y < 0) s.y = base.y;
      this.soldiers.push(s);
    }
  }

  _spawnTank() {
    const g = this.ctx.gorilla;
    // enter from the city edge on the road nearest the monster's side
    const vertical = Math.random() < 0.5;
    const c = ROAD_CENTERS.reduce((best, rc) => (Math.abs(rc - (vertical ? g.pos.x : g.pos.z)) < Math.abs(best - (vertical ? g.pos.x : g.pos.z)) ? rc : best), ROAD_CENTERS[0]);
    const side = (vertical ? g.pos.z : g.pos.x) > 0 ? -1 : 1;
    // spawn on the far side if possible, but not right on top of the monster
    let along = side * (CITY_HALF + 25);
    if (Math.abs(along - (vertical ? g.pos.z : g.pos.x)) < 120) along = -along;
    const group = new THREE.Group();
    const hull = new THREE.Mesh(this.tankGeo.hull, this.mat);
    const turret = new THREE.Group();
    turret.position.y = 1.9;
    const tm = new THREE.Mesh(this.tankGeo.turret, this.mat);
    const barrelPivot = new THREE.Group();
    barrelPivot.position.set(0, 0.5, 1.4);
    const barrel = new THREE.Mesh(this.tankGeo.barrel, this.mat);
    barrelPivot.add(barrel);
    turret.add(tm, barrelPivot);
    group.add(hull, turret);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.ctx.root.add(group);
    const off = (Math.random() < 0.5 ? -1 : 1) * 3.5;
    const t = {
      group, turret, barrelPivot, hp: 3, vertical, c, off,
      x: vertical ? c + off : along, z: vertical ? along : c + off, y: 0,
      yaw: 0, turretYaw: 0, speed: 0, fireCd: 3 + Math.random() * 2, state: 'drive', burn: 0, body: null, held: false, flash: 0,
    };
    t.yaw = vertical ? (along < 0 ? 0 : Math.PI) : (along < 0 ? Math.PI / 2 : -Math.PI / 2);
    this.tanks.push(t);
  }

  _spawnHeli() {
    const g = this.ctx.gorilla;
    const a = Math.random() * Math.PI * 2;
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.heliGeo.body, this.mat);
    const rotor = new THREE.Mesh(this.heliGeo.rotor, this.rotorMat);
    rotor.position.y = 1.75;
    const tail = new THREE.Mesh(this.heliGeo.tail, this.mat);
    tail.position.set(0.25, 1.1, -8.3);
    group.add(body, rotor, tail);
    body.castShadow = true;
    // navigation lights: red port, green starboard, white tail strobe, red anti-collision beacon
    const navGeo = new THREE.SphereGeometry(0.16, 6, 4);
    const nav = (c, x, y, z) => { const m = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); group.add(m); return m; };
    nav(new THREE.Color(6, 0.2, 0.15), 2.3, -0.05, 0.1);
    nav(new THREE.Color(0.2, 6, 0.6), -2.3, -0.05, 0.1);
    const strobe = nav(new THREE.Color(9, 9, 9), 0, 1.9, -8.6);
    const light = nav(new THREE.Color(7, 0.3, 0.2), 0, -1.0, 0);
    this.ctx.root.add(group);
    const h = {
      group, rotor, tail, light, strobe, hp: 1, x: g.pos.x + Math.cos(a) * 220, y: 70, z: g.pos.z + Math.sin(a) * 220,
      vx: 0, vy: 0, vz: 0, yaw: 0, roll: 0, pitch: 0, orbitA: a, orbitR: 55 + Math.random() * 20, dir: Math.random() < 0.5 ? 1 : -1,
      fireCd: 3, burst: 0, burstCd: 0, rocketCd: 6 + Math.random() * 4, state: 'fly', swoop: 0, swoopCd: 8 + Math.random() * 6, t: 0, held: false, band: Math.random(),
    };
    this.helis.push(h);
    this.ctx.events.emit('heliSpawn', { h });
  }

  // ---------------- soldiers ----------------
  _updateSoldiers(dt, camPos) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    const gp = g.pos;
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i];
      if (s.state === 'held') continue;
      if (s.state === 'dead') { s.dead += dt; if (s.dead > 10) this.soldiers.splice(i, 1); continue; }
      if (s.state === 'fly') {
        s.vy -= 30 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        s.tx += (s.spin || 8) * dt;
        s.phase += dt * 6;
        const fl = ctx.city.groundAt(s.x, s.z, s.y + 0.5);
        if (s.y <= fl) { s.y = fl; this._killSoldier(s, Math.abs(s.vy) > 22); }
        continue;
      }
      const dx = gp.x - s.x, dz = gp.z - s.z;
      const d = Math.hypot(dx, dz);
      // roof gone? fall.
      const fl = ctx.city.groundAt(s.x, s.z, s.y + 0.5);
      if (fl < s.y - 1) { s.state = 'fly'; s.vx = s.vz = 0; s.vy = 0; s.anim = 'fly'; s.spin = 4; continue; }
      s.y = fl;
      if (!g.alive) { s.anim = 'idle'; continue; }
      // trampled
      if (d < GORILLA.radius + 0.5 && Math.abs(s.y - gp.y) < 3 && g.speed > 2) { this._killSoldier(s, true); continue; }
      const panic = d < 16 || this.suppressT > 0 && d < 90 || this.retreat;
      if (panic && !s.roof) {
        s.anim = 'panic';
        const sp = 7 * dt;
        this._moveTo(s, s.x - (dx / d) * sp * 10, s.z - (dz / d) * sp * 10, 7, dt);
        s.phase += dt * 14;
        continue;
      }
      if (s.state === 'move') {
        if (!s.goal || Math.random() < 0.002) {
          const want = 32 + Math.random() * 30;
          const ang = Math.atan2(s.z - gp.z, s.x - gp.x) + (Math.random() - 0.5) * 1.2;
          const gx = gp.x + Math.cos(ang) * want, gz = gp.z + Math.sin(ang) * want;
          s.goal = ctx.city.solidAt(gx, 1, gz) ? new THREE.Vector3(s.x, 0, s.z) : new THREE.Vector3(gx, 0, gz);
        }
        const gd = Math.hypot(s.goal.x - s.x, s.goal.z - s.z);
        if (gd < 2 || (d < 70 && Math.random() < 0.01)) { s.state = 'aim'; s.aimT = 2 + Math.random() * 3; }
        else { this._moveTo(s, s.goal.x, s.goal.z, 5.5, dt); s.anim = 'run'; s.phase += dt * 12; }
      } else if (s.state === 'aim') {
        s.anim = 'aim';
        s.yaw = Math.atan2(dx, dz);
        if (!s.roof) {
          s.aimT -= dt;
          if (s.aimT <= 0 || d > 95 || d < 22) { s.state = 'move'; s.goal = null; }
        }
        if (d < 130) this._soldierFire(s, dt, d);
      }
    }
    this.soldierRenderer.write(this.soldiers, camPos);
  }

  _moveTo(s, tx, tz, speed, dt) {
    const city = this.ctx.city;
    const dx = tx - s.x, dz = tz - s.z;
    const d = Math.hypot(dx, dz) || 1;
    const st = Math.min(d, speed * dt);
    let nx = s.x + (dx / d) * st, nz = s.z + (dz / d) * st;
    if (city.solidAt(nx, s.y + 1, nz)) {
      if (!city.solidAt(nx, s.y + 1, s.z)) nz = s.z;
      else if (!city.solidAt(s.x, s.y + 1, nz)) nx = s.x;
      else { nx = s.x; nz = s.z; s.goal = null; }
    }
    if (s.roof) {
      // stay on the roof
      if (this.ctx.city.groundAt(nx, nz, s.y + 0.5) < s.y - 0.5) { nx = s.x; nz = s.z; }
    }
    s.x = nx; s.z = nz;
    s.yaw = Math.atan2(dx, dz);
  }

  _soldierFire(s, dt, d) {
    if (this.retreat || this.ceaseFire) return;
    s.fireCd -= dt;
    if (s.burst > 0) {
      s.burstCd -= dt;
      if (s.burstCd <= 0) {
        s.burst--;
        s.burstCd = 0.11;
        const muzzle = new THREE.Vector3(s.x + Math.sin(s.yaw) * 0.9, s.y + 1.6, s.z + Math.cos(s.yaw) * 0.9);
        this.ctx.fx.muzzle(muzzle, 0.9);
        if (s.rocket) {
          this._fire('rocket', muzzle, 55, 0.08, 2);
          s.burst = 0;
        } else this._fire('bullet', muzzle, 170, d < 50 ? 0.07 : 0.11, 0.07);
        this.ctx.events.emit('gunfire', { x: s.x, y: s.y, z: s.z, rocket: s.rocket });
      }
    } else if (s.fireCd <= 0) {
      s.burst = s.rocket ? 1 : 3 + Math.floor(Math.random() * 3);
      s.fireCd = (s.rocket ? 6 : 2.2) + Math.random() * 2.5;
    }
  }

  _killSoldier(s, squash) {
    if (s.state === 'dead') return;
    s.state = 'dead';
    s.anim = 'dead';
    s.dead = 0;
    s.tx = squash ? 0 : -Math.PI / 2;
    s.squash = squash ? 0.25 : 1;
    s.y += 0.15;
    this.kills.soldiers++;
    this.ctx.stats.soldiers++;
  }

  // ---------------- enemy fire ----------------
  _fire(type, from, speed, spread, dmg) {
    const g = this.ctx.gorilla;
    const target = new THREE.Vector3(g.pos.x, g.pos.y + 6 + Math.random() * 6, g.pos.z);
    target.x += g.vel.x * 0.25; target.z += g.vel.z * 0.25;
    const dir = target.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.shots.push({ type, p: from.clone(), v: dir.multiplyScalar(speed), life: type === 'bullet' ? 1.6 : 5, dmg, age: 0 });
  }

  _updateShots(dt) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    let n = 0;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.age += dt;
      s.life -= dt;
      const steps = s.type === 'bullet' ? 3 : 2;
      let done = false;
      for (let k = 0; k < steps && !done; k++) {
        s.p.addScaledVector(s.v, dt / steps);
        if (s.type === 'rocket' && g.alive) {
          // mild homing
          _v.set(g.pos.x - s.p.x, g.pos.y + 9 - s.p.y, g.pos.z - s.p.z).normalize().multiplyScalar(s.v.length());
          s.v.lerp(_v, 0.6 * dt / steps);
        }
        // hit the monster?
        const dx = s.p.x - g.pos.x, dz = s.p.z - g.pos.z;
        if (g.alive && dx * dx + dz * dz < (GORILLA.radius + 1.2) ** 2 && s.p.y > g.pos.y && s.p.y < g.pos.y + 15) {
          g.damage(s.dmg, s.type, s.p.clone());
          if (s.type === 'bullet') {
            ctx.fx.sparks(s.p, _v.copy(s.v).normalize().negate(), 3, [1, 0.8, 0.5]);
            ctx.events.emit('bulletHit', { x: s.p.x, y: s.p.y, z: s.p.z });
          } else this._blast(s.p, s.type === 'shell' ? 1.0 : 0.7, false);
          done = true;
          break;
        }
        if (s.type !== 'bullet' && (ctx.city.solidAt(s.p.x, s.p.y, s.p.z) || s.p.y < 0.3)) {
          this._blast(s.p, s.type === 'shell' ? 1.0 : 0.7, true);
          done = true;
          break;
        }
      }
      if (s.type === 'rocket' || s.type === 'shell') {
        ctx.fx.glow.emit(s.p.x, s.p.y, s.p.z, 0, 0, 0, s.type === 'shell' ? 1.3 : 1.6, 0.08, 1, 0.75, 0.35, 1, { grow: 0, drag: 0 });
        if (Math.random() < 0.85) ctx.fx.dust.emit(s.p.x, s.p.y, s.p.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 1.0, 1.6, 0.75, 0.74, 0.72, 0.45, { grow: 1.8, drag: 1, gravity: 0.3 });
      }
      if (done || s.life <= 0) { this.shots.splice(i, 1); continue; }
      if (s.type === 'bullet' && n < this.tracers.instanceMatrix.count) {
        _q.setFromUnitVectors(_v2.set(0, 0, 1), _v.copy(s.v).normalize());
        _m.compose(s.p, _q, _s.set(1, 1, 1));
        this.tracers.setMatrixAt(n++, _m);
      }
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
  }

  _blast(p, power, building) {
    const ctx = this.ctx;
    ctx.fx.explosion(p, power * 0.8);
    ctx.events.emit('explosion', { x: p.x, y: p.y, z: p.z, power: power * 0.8 });
    if (building) ctx.city.damageSphere(p, 3.5, 0.7 * power, null, { kind: 'shell' });
    if (p.y < 2) ctx.city.scar(p.x, p.z, 4, 0.8, 0.2, 0);
    if (ctx.crowd) ctx.crowd.alarm(p, 40);
    // splash on the monster
    const g = ctx.gorilla;
    const d = Math.hypot(p.x - g.pos.x, p.z - g.pos.z);
    if (building && d < 9 && p.y < g.pos.y + 16) g.damage(1 * power, 'splash', p.clone());
  }

  // ---------------- tanks ----------------
  _updateTanks(dt) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    for (let i = this.tanks.length - 1; i >= 0; i--) {
      const t = this.tanks[i];
      if (t.held) continue;
      if (t.body) {
        const p = t.body.translation(), r = t.body.rotation();
        t.group.position.set(p.x, p.y - 1.1, p.z);
        t.group.quaternion.set(r.x, r.y, r.z, r.w);
        t.x = p.x; t.z = p.z; t.y = p.y - 1.1;
        t.bodyAge = (t.bodyAge || 0) + dt;
        if (t.bodyAge > 8 && t.body.isSleeping()) { ctx.physics.removeBody(t.body); t.body = null; }
      }
      if (t.burn > 0) {
        t.burn -= dt;
        if (Math.random() < 0.45) ctx.fx.smoke(t.x, t.y + 2.5, t.z, 3, 0.1, 5, 4);
        if (Math.random() < 0.5) ctx.fx.fire(t.x, t.y + 1.8, t.z, 2);
        ctx.lights.pulse(t.x, t.z, 0.9, 0.38, 0.1, 12);
      }
      if (t.hp <= 0) continue;
      const dx = g.pos.x - t.x, dz = g.pos.z - t.z;
      const d = Math.hypot(dx, dz);
      // drive along the road toward the monster, stop in firing range
      const along = t.vertical ? t.z : t.x;
      const gAlong = t.vertical ? g.pos.z : g.pos.x;
      const across = Math.abs((t.vertical ? g.pos.x : g.pos.z) - t.c);
      let target = 0;
      if (d > 75 || (d > 30 && across > 70)) target = 9;
      if (d < 26) target = -6; // back off
      if (this.retreat) target = -8;
      const dirSign = Math.sign(gAlong - along) || 1;
      // turn onto a crossing road when the monster is far off this one
      if (across > 60 && Math.abs(gAlong - along) < 12) {
        const near = ROAD_CENTERS.find((rc) => Math.abs(rc - along) < 4);
        if (near !== undefined) {
          t.vertical = !t.vertical;
          t.c = near;
          t.off = 3.5 * (Math.random() < 0.5 ? 1 : -1);
        }
      }
      t.speed += Math.sign(target - t.speed) * Math.min(Math.abs(target - t.speed), 5 * dt);
      const mv = t.speed * dirSign * dt;
      let nx = t.x, nz = t.z;
      if (t.vertical) { nz += mv; nx += (t.c + t.off - nx) * Math.min(1, dt * 2); }
      else { nx += mv; nz += (t.c + t.off - nz) * Math.min(1, dt * 2); }
      if (!ctx.city.solidAt(nx, 2, nz)) { t.x = nx; t.z = nz; }
      const wantYaw = t.vertical ? (dirSign * Math.sign(t.speed || 1) > 0 ? 0 : Math.PI) : (dirSign * Math.sign(t.speed || 1) > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (Math.abs(t.speed) > 0.5) t.yaw = dampAngle(t.yaw, t.speed >= 0 ? wantYaw : wantYaw + Math.PI, 3, dt);
      t.y = ctx.rubble.heightAt(t.x, t.z) * 0.6;
      // crush cars in the way
      if (Math.abs(t.speed) > 1 && ctx.traffic) ctx.traffic.crush(t.x, t.z, 3.2);
      t.group.position.set(t.x, t.y, t.z);
      t.group.rotation.set(0, t.yaw, 0);
      ctx.lights.pulse(t.x + Math.sin(t.yaw) * 12, t.z + Math.cos(t.yaw) * 12, 0.5, 0.48, 0.42, 11);
      // turret tracks the monster
      const aimYaw = Math.atan2(dx, dz) - t.yaw;
      t.turretYaw = dampAngle(t.turretYaw, aimYaw, 2.2, dt);
      t.turret.rotation.y = t.turretYaw;
      const elev = Math.atan2(g.pos.y + 8 - (t.y + 2.4), d);
      t.barrelPivot.rotation.x = -clamp(elev, -0.1, 0.6);
      t.flash = Math.max(0, t.flash - dt * 4);
      t.barrelPivot.position.z = 1.4 - t.flash * 0.6;
      t.fireCd -= dt;
      if (t.fireCd <= 0 && d < 140 && g.alive && !this.retreat && !this.ceaseFire && elev < 0.62 && Math.abs(angleDiff(t.turretYaw, aimYaw)) < 0.12) {
        t.fireCd = 5 + Math.random() * 3;
        t.flash = 1;
        const muzzle = new THREE.Vector3(0, 0, 5.4).applyEuler(new THREE.Euler(t.barrelPivot.rotation.x, 0, 0)).add(new THREE.Vector3(0, 0.5, 1.4));
        muzzle.applyEuler(new THREE.Euler(0, t.yaw + t.turretYaw, 0)).add(new THREE.Vector3(t.x, t.y + 1.9, t.z));
        ctx.fx.muzzle(muzzle, 5);
        ctx.fx.flashLight(muzzle, 2500, 0.12, 0xffc070);
        for (let k = 0; k < 6; k++) ctx.fx.smoke(muzzle.x, muzzle.y, muzzle.z, 2, 0.45, 2.5, 1);
        this._fire('shell', muzzle, 130, d < 60 ? 0.045 : 0.07, 5);
        ctx.events.emit('cannon', { x: t.x, y: t.y, z: t.z });
      }
    }
  }

  _damageTank(t, amount, dir) {
    if (t.hp <= 0) {
      if (t.body) t.body.applyImpulse({ x: dir.x * 400, y: 300, z: dir.z * 400 }, true);
      return;
    }
    t.hp -= amount;
    if (t.hp <= 0) {
      this.kills.tanks++;
      this.ctx.stats.tanks++;
      const p = new THREE.Vector3(t.x, t.y + 2, t.z);
      this.ctx.fx.explosion(p, 1.6);
      this.ctx.events.emit('explosion', { x: p.x, y: p.y, z: p.z, power: 1.6 });
      this.ctx.events.emit('kill', { kind: 'tank' });
      this.ctx.city.scar(t.x, t.z, 7, 1, 0.3, 0);
      t.burn = 25;
      t.group.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(0.25, 0.22, 0.2); } });
      // flip as a rigid body
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0));
      t.body = this.ctx.physics.dynamicBox({ x: t.x, y: t.y + 1.1, z: t.z }, q, 2.2, 1.0, 3.7, {
        density: 0.6,
        linvel: { x: dir.x * 9, y: 14, z: dir.z * 9 },
        angvel: { x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 6 },
      });
      t.bodyAge = 0;
      // turret pops off
      this.ctx.fx.chipBurst(p, new THREE.Vector3(0, 1, 0), new THREE.Color(0.3, 0.32, 0.2), 14, 16, 1);
    }
  }

  // ---------------- helicopters ----------------
  _updateHelis(dt) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    for (let i = this.helis.length - 1; i >= 0; i--) {
      const h = this.helis[i];
      if (h.held) continue;
      h.t += dt;
      h.rotor.rotation.y += dt * (h.state === 'fly' ? 28 : 14);
      h.tail.rotation.x += dt * 40;
      if (h.state === 'wreck') {
        h.burn -= dt;
        if (h.burn > 0) {
          if (Math.random() < 0.4) ctx.fx.smoke(h.x, h.y + 1, h.z, 3, 0.1, 5, 4);
          if (Math.random() < 0.4) ctx.fx.fire(h.x, h.y + 0.5, h.z, 2);
          ctx.lights.pulse(h.x, h.z, 0.9, 0.38, 0.1, 12);
        }
        continue;
      }
      if (h.state === 'falling') {
        h.vy -= 22 * dt;
        h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
        h.yaw += dt * 7;
        h.roll += dt * 0.6;
        if (Math.random() < 0.9) ctx.fx.smoke(h.x, h.y, h.z, 3.5, 0.08, 4, 1);
        if (Math.random() < 0.7) ctx.fx.fire(h.x, h.y, h.z, 2.2);
        ctx.fx.sparks(new THREE.Vector3(h.x, h.y, h.z), new THREE.Vector3(0, -1, 0), 2, [1, 0.8, 0.4]);
        const ground = ctx.city.groundAt(h.x, h.z, h.y + 1);
        const hitB = ctx.city.solidAt(h.x, h.y, h.z);
        if (h.y <= ground + 1 || hitB) {
          const p = new THREE.Vector3(h.x, h.y, h.z);
          ctx.fx.explosion(p, 1.8);
          ctx.events.emit('explosion', { x: p.x, y: p.y, z: p.z, power: 1.8 });
          ctx.city.damageSphere(p, 6, 1.8, new THREE.Vector3(h.vx, h.vy, h.vz).normalize(), { kind: 'crash' });
          if (h.y < 3) ctx.city.scar(h.x, h.z, 8, 1, 0.4, 0);
          if (ctx.crowd) ctx.crowd.crush(h.x, h.z, 7);
          if (ctx.traffic) ctx.traffic.shock(p, 12, 1);
          if (hitB) { h.state = 'falling'; h.vx *= 0.2; h.vz *= 0.2; h.hitOnce = true; }
          if (!hitB || h.hitOnce && h.y <= ground + 1) {
            h.state = 'wreck';
            h.burn = 20;
            h.y = ground + 1.2;
            h.roll = 1.2;
          }
        }
        this._placeHeli(h);
        continue;
      }
      // ----- flying -----
      // Elevation-aware engagement: when the monster is up on a skyscraper, choppers come to his
      // altitude and work the open air in front of the facade he is on (and make swooping passes
      // within swatting range). They steer *around* towers instead of popping over them.
      const elevated = g.state === 'climb' || g.pos.y > 12;
      const c = g.climb;
      h.swoopCd -= dt;
      if (h.swoopCd <= 0 && h.swoop <= 0) { h.swoop = elevated ? 3.2 : 4; h.swoopCd = (elevated ? 6 : 12) + Math.random() * (elevated ? 5 : 8); }
      h.swoop -= dt;
      const radius = h.swoop > 0 ? (elevated ? 13 : 15) : elevated ? Math.min(h.orbitR, 34 + h.band * 14) : h.orbitR;
      h.orbitA += (h.dir * dt * (h.swoop > 0 ? 18 : 12)) / radius;
      let ox = Math.cos(h.orbitA), oz = Math.sin(h.orbitA);
      if (c && g.state === 'climb') {
        // stay on the open side of the wall: reflect orbit points that fall behind it
        const dn = ox * c.nx + oz * c.nz;
        if (dn < 0.25) { ox -= c.nx * (dn - 0.25) * 2; oz -= c.nz * (dn - 0.25) * 2; const l = Math.hypot(ox, oz); ox /= l; oz /= l; }
      }
      let tx = g.pos.x + ox * radius;
      let tz = g.pos.z + oz * radius;
      if (this.retreat) { tx = g.pos.x + ox * 320; tz = g.pos.z + oz * 320; }
      // altitude: the monster's level (each chopper holds its own band), higher over open street
      const chestY = g.pos.y + 10;
      let ty;
      if (elevated) ty = chestY + (h.swoop > 0 ? 1 + h.band * 3 : -4 + h.band * 16);
      else ty = g.pos.y + (h.swoop > 0 ? 17 : 26 + h.band * 10);
      ty = Math.max(ty, 14);
      if (this.retreat) ty = 140;
      else if (this.ceaseFire) ty = g.pos.y + 30;
      let ax = (tx - h.x) * 1.2 - h.vx * 1.4;
      let ay = (ty - h.y) * 1.6 - h.vy * 1.8;
      let az = (tz - h.z) * 1.2 - h.vz * 1.4;
      // building avoidance: push sideways out of any tower volume we are near and below the top of
      for (const bd of ctx.city.buildingsNear(h.x, h.z, 12)) {
        const top = bd.columnTopAt(Math.min(Math.max(h.x, bd.x0 + 0.1), bd.x0 + bd.width - 0.1), Math.min(Math.max(h.z, bd.z0 + 0.1), bd.z0 + bd.depth - 0.1));
        if (h.y > top + 4) continue;
        const cx = Math.min(Math.max(h.x, bd.x0), bd.x0 + bd.width), cz = Math.min(Math.max(h.z, bd.z0), bd.z0 + bd.depth);
        let px = h.x - cx, pz = h.z - cz;
        let dl = Math.hypot(px, pz);
        if (dl < 0.01) { px = h.x - bd.cx; pz = h.z - bd.cz; dl = Math.hypot(px, pz) || 1; }
        const k = Math.max(0, 1 - dl / 12);
        ax += (px / dl) * 60 * k; az += (pz / dl) * 60 * k;
        // kill velocity into the wall
        const vn = (h.vx * px + h.vz * pz) / dl;
        if (vn < 0 && dl < 7) { h.vx -= (px / dl) * vn; h.vz -= (pz / dl) * vn; }
      }
      h.vx += clamp(ax, -26, 26) * dt; h.vy += clamp(ay, -16, 16) * dt; h.vz += clamp(az, -26, 26) * dt;
      h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
      // last resort: never end a frame inside a building
      if (ctx.city.solidAt(h.x, h.y, h.z)) { h.x -= h.vx * dt * 2; h.z -= h.vz * dt * 2; h.vx *= -0.3; h.vz *= -0.3; }
      // face the monster, bank with lateral acceleration
      const faceYaw = Math.atan2(g.pos.x - h.x, g.pos.z - h.z);
      h.yaw = dampAngle(h.yaw, faceYaw, 2.5, dt);
      const fwdx = Math.sin(h.yaw), fwdz = Math.cos(h.yaw);
      const lat = ax * fwdz - az * fwdx;
      const lon = ax * fwdx + az * fwdz;
      h.roll += (clamp(-lat * 0.03, -0.5, 0.5) - h.roll) * Math.min(1, dt * 3);
      h.pitch += (clamp(lon * 0.02, -0.35, 0.35) - h.pitch) * Math.min(1, dt * 3);
      this._placeHeli(h);
      h.light.visible = Math.floor(h.t * 2) % 2 === 0;
      h.strobe.visible = (h.t * 1.3) % 1 < 0.06;
      // weapons
      const d = Math.hypot(g.pos.x - h.x, g.pos.z - h.z);
      if (!g.alive || this.retreat || this.ceaseFire) continue;
      h.fireCd -= dt;
      h.rocketCd -= dt;
      const nose = new THREE.Vector3(h.x + fwdx * 3.5, h.y - 0.7, h.z + fwdz * 3.5);
      if (h.burst > 0) {
        h.burstCd -= dt;
        if (h.burstCd <= 0) {
          h.burst--; h.burstCd = 0.07;
          ctx.fx.muzzle(nose, 1.2);
          this._fire('bullet', nose, 190, 0.07, 0.12);
          if (h.burst % 3 === 0) ctx.events.emit('gunfire', { x: h.x, y: h.y, z: h.z, heli: true });
        }
      } else if (h.fireCd <= 0 && d < 110) {
        h.burst = 10 + Math.floor(Math.random() * 6);
        h.fireCd = 2.5 + Math.random() * 2;
      }
      if (h.rocketCd <= 0 && d < 120) {
        h.rocketCd = 6 + Math.random() * 4;
        for (const side of [-1, 1]) {
          const pod = new THREE.Vector3(h.x + fwdz * side * 2.1, h.y - 0.6, h.z - fwdx * side * 2.1);
          this._fire('rocket', pod, 60, 0.07, 2.5);
        }
        ctx.events.emit('rocket', { x: h.x, y: h.y, z: h.z });
      }
    }
  }

  _placeHeli(h) {
    h.group.position.set(h.x, h.y, h.z);
    h.group.rotation.set(h.pitch, h.yaw, h.roll, 'YXZ');
  }

  _downHeli(h, dir) {
    if (h.state !== 'fly') return;
    h.state = 'falling';
    h.hp = 0;
    h.vx = dir.x * 18 + h.vx * 0.3; h.vy = 6; h.vz = dir.z * 18 + h.vz * 0.3;
    this.kills.helis++;
    this.ctx.stats.helis++;
    const p = new THREE.Vector3(h.x, h.y, h.z);
    this.ctx.fx.explosion(p, 1.0);
    this.ctx.events.emit('explosion', { x: p.x, y: p.y, z: p.z, power: 1 });
    this.ctx.events.emit('kill', { kind: 'heli' });
    h.group.traverse((o) => { if (o.isMesh && o.material === this.mat) { o.material = this.mat.clone(); o.material.color = new THREE.Color(0.3, 0.28, 0.26); } });
  }

  // ---------------- interactions ----------------
  hit(p, radius, dir, power, kind) {
    let n = 0;
    const r2 = radius * radius;
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.state === 'held') continue;
      const dx = s.x - p.x, dy = s.y + 1 - p.y, dz = s.z - p.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      s.state = 'fly'; s.anim = 'fly';
      s.vx = dir.x * 24 * power + dx; s.vy = 12 + Math.random() * 10; s.vz = dir.z * 24 * power + dz;
      s.spin = (Math.random() - 0.5) * 16;
      n++;
    }
    for (const t of this.tanks) {
      if (t.held) continue;
      const dx = t.x - p.x, dy = t.y + 1.5 - p.y, dz = t.z - p.z;
      if (dx * dx + dy * dy + dz * dz > (radius + 2.5) ** 2) continue;
      this._damageTank(t, power * (kind === 'smash' ? 2 : 1.2), dir);
      this.ctx.events.emit('metalHit', { x: t.x, y: t.y, z: t.z });
      n++;
    }
    for (const h of this.helis) {
      if (h.state !== 'fly' || h.held) continue;
      const dx = h.x - p.x, dy = h.y - p.y, dz = h.z - p.z;
      if (dx * dx + dy * dy + dz * dz > (radius + 4.5) ** 2) continue;
      this._downHeli(h, dir);
      this.ctx.events.emit('metalHit', { x: h.x, y: h.y, z: h.z });
      n++;
    }
    return n;
  }

  hitAir(p, radius, dir) {
    for (const h of this.helis) {
      if (h.state !== 'fly' || h.held) continue;
      if (Math.hypot(h.x - p.x, h.y - p.y, h.z - p.z) < radius) { this._downHeli(h, dir); return true; }
    }
    return false;
  }

  shock(p, radius, power) {
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.state === 'held' || s.state === 'fly') continue;
      const dx = s.x - p.x, dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius || Math.abs(s.y - p.y) > 6) continue;
      const k = (1 - d / radius) * power;
      s.state = 'fly'; s.anim = 'fly';
      s.vx = (dx / (d || 1)) * 14 * k; s.vy = 10 + 16 * k; s.vz = (dz / (d || 1)) * 14 * k;
      s.spin = (Math.random() - 0.5) * 14;
    }
    for (const t of this.tanks) {
      if (t.held) continue;
      const dx = t.x - p.x, dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius * 0.75) continue;
      this._damageTank(t, 1.6 * power * (1 - d / radius), _v.set(dx, 0, dz).normalize());
    }
  }

  crush(x, z, radius) {
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.state === 'held') continue;
      if (Math.hypot(s.x - x, s.z - z) < radius && s.y < 10) this._killSoldier(s, true);
    }
    for (const t of this.tanks) if (Math.hypot(t.x - x, t.z - z) < radius * 0.6) this._damageTank(t, 1.2, _v.set(0, 0, 0));
  }

  suppress(p, radius, time) { this.suppressT = time; }

  grabCandidates(p, radius) {
    const out = [];
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.state === 'held') continue;
      if (Math.hypot(s.x - p.x, s.z - p.z) > radius || Math.abs(s.y - p.y) > 8) continue;
      out.push({ kind: 'soldier', edible: true, pos: new THREE.Vector3(s.x, s.y, s.z), take: () => this._takeSoldier(s) });
    }
    for (const t of this.tanks) {
      if (t.held) continue;
      if (Math.hypot(t.x - p.x, t.z - p.z) > radius + 2 || Math.abs(t.y - p.y) > 8) continue;
      out.push({ kind: 'tank', edible: false, pos: new THREE.Vector3(t.x, t.y, t.z), take: () => this._takeTank(t) });
    }
    for (const h of this.helis) {
      if (h.held || h.state === 'falling') continue;
      if (Math.hypot(h.x - p.x, h.z - p.z) > radius + 4 || Math.abs(h.y - (p.y + 10)) > 10) continue;
      out.push({ kind: 'heli', edible: false, pos: new THREE.Vector3(h.x, h.y, h.z), take: () => this._takeHeli(h) });
    }
    return out;
  }

  _takeSoldier(s) {
    s.state = 'held';
    s.hidden = true;
    const mesh = HumanRenderer.makeFigure(s.colors, true);
    return new Held(this.ctx, {
      kind: 'soldier', mesh, edible: true, heal: 9,
      offset: new THREE.Vector3(0, -1.1, 0.6),
      localRot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)),
      half: new THREE.Vector3(0.4, 1, 0.4),
      onConsume: () => { this.soldiers.splice(this.soldiers.indexOf(s), 1); this.kills.soldiers++; this.ctx.stats.soldiers++; this.ctx.stats.eaten++; },
      onRelease: (pos, vel) => {
        this.ctx.root.remove(mesh);
        s.hidden = false; s.x = pos.x; s.y = pos.y; s.z = pos.z;
        s.state = 'fly'; s.anim = 'fly'; s.vx = vel.x; s.vy = vel.y; s.vz = vel.z; s.spin = 10;
      },
    });
  }

  _takeTank(t) {
    if (t.body) { this.ctx.physics.removeBody(t.body); t.body = null; }
    t.held = true;
    this.ctx.root.remove(t.group);
    const mesh = t.group;
    mesh.rotation.set(0, 0, 0);
    mesh.position.set(0, 0, 0);
    const wasAlive = t.hp > 0;
    t.hp = 0;
    if (wasAlive) { this.kills.tanks++; this.ctx.stats.tanks++; }
    const held = new Held(this.ctx, {
      kind: 'tank', mesh, heavy: true,
      offset: new THREE.Vector3(0, -2.6, 1.4),
      localRot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
      half: new THREE.Vector3(2.2, 1.1, 3.7),
      projectile: { explode: true, power: 2.8, centerOffset: -1.1 },
    });
    held.onRelease = (pos, vel) => {
      this.tanks.splice(this.tanks.indexOf(t), 1);
      this.ctx.projectiles.launch(held, pos, vel);
    };
    return held;
  }

  _takeHeli(h) {
    h.held = true;
    if (h.state === 'fly') { this.kills.helis++; this.ctx.stats.helis++; this.ctx.events.emit('kill', { kind: 'heli' }); }
    h.state = 'wreck';
    this.ctx.root.remove(h.group);
    const mesh = h.group;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    const held = new Held(this.ctx, {
      kind: 'heli', mesh, heavy: true,
      offset: new THREE.Vector3(0, -2.0, 1.6),
      localRot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
      half: new THREE.Vector3(1.6, 1.4, 4.5),
      projectile: { explode: true, power: 2.6, centerOffset: 0 },
    });
    held.onRelease = (pos, vel) => {
      this.helis.splice(this.helis.indexOf(h), 1);
      this.ctx.projectiles.launch(held, pos, vel);
    };
    return held;
  }

  get activeCounts() {
    return {
      soldiers: this.soldiers.filter((s) => s.state !== 'dead' && s.state !== 'held').length,
      tanks: this.tanks.filter((t) => t.hp > 0).length,
      helis: this.helis.filter((h) => h.state === 'fly').length,
    };
  }
}
