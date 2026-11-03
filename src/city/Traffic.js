import * as THREE from 'three';
import { part, merge, box, cyl } from '../core/geom.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_CENTERS, CITY_HALF } from '../world/City.js';
import { Held } from '../core/Held.js';
import { pick } from '../core/util.js';
import { patchCityLight } from '../render/CityLights.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const BODY = 0xffffff, GLASS = 0x1b232b, TIRE = 0x161616, LIGHT = 0xfff2c0, TAIL = 0xb01010, CHROME = 0x9aa0a6;

function wheels(len, w, r = 0.36) {
  const out = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(part(cyl(r, r, 0.26, 10), TIRE, { x: sx * (w / 2 - 0.08), y: r, z: sz * (len / 2 - 0.8), rz: Math.PI / 2 }));
  }
  return out;
}

function carGeometries() {
  const G = {};
  G.sedan = merge([
    part(box(1.9, 0.62, 4.5), BODY, { y: 0.66 }),
    part(box(1.66, 0.55, 2.3), GLASS, { y: 1.22, z: -0.15 }),
    part(box(1.6, 0.08, 2.1), BODY, { y: 1.52, z: -0.15 }),
    part(box(0.4, 0.14, 0.05), LIGHT, { x: 0.65, y: 0.78, z: 2.26 }),
    part(box(0.4, 0.14, 0.05), LIGHT, { x: -0.65, y: 0.78, z: 2.26 }),
    part(box(0.4, 0.12, 0.05), TAIL, { x: 0.65, y: 0.8, z: -2.26 }),
    part(box(0.4, 0.12, 0.05), TAIL, { x: -0.65, y: 0.8, z: -2.26 }),
    part(box(1.92, 0.12, 0.12), CHROME, { y: 0.42, z: 2.25 }),
    ...wheels(4.5, 1.9),
  ]);
  G.van = merge([
    part(box(2.0, 1.75, 5.0), BODY, { y: 1.25 }),
    part(box(1.9, 0.6, 0.06), GLASS, { y: 1.65, z: 2.5 }),
    part(box(2.02, 0.5, 1.4), GLASS, { y: 1.65, z: 1.6 }),
    part(box(0.35, 0.14, 0.05), LIGHT, { x: 0.7, y: 0.8, z: 2.52 }),
    part(box(0.35, 0.14, 0.05), LIGHT, { x: -0.7, y: 0.8, z: 2.52 }),
    ...wheels(5.0, 2.0, 0.4),
  ]);
  G.bus = merge([
    part(box(2.5, 2.6, 11), BODY, { y: 1.75 }),
    part(box(2.52, 0.9, 9.6), GLASS, { y: 2.15, z: -0.3 }),
    part(box(2.3, 1.2, 0.06), GLASS, { y: 2.0, z: 5.51 }),
    part(box(2.52, 0.25, 11.02), 0x333333, { y: 0.55 }),
    ...wheels(11, 2.5, 0.5),
    part(cyl(0.5, 0.5, 0.3, 10), TIRE, { x: 1.18, y: 0.5, z: 0, rz: Math.PI / 2 }),
  ]);
  G.police = merge([
    part(box(1.92, 0.62, 4.6), 0x101215, { y: 0.66 }),
    part(box(1.94, 0.4, 2.0), BODY, { y: 0.72, z: -0.1 }),
    part(box(1.68, 0.55, 2.3), GLASS, { y: 1.22, z: -0.15 }),
    part(box(1.62, 0.08, 2.1), BODY, { y: 1.52, z: -0.15 }),
    part(box(1.3, 0.16, 0.36), 0x222428, { y: 1.62, z: -0.05 }),
    part(box(1.95, 0.14, 0.14), CHROME, { y: 0.45, z: 2.3 }),
    part(box(1.6, 0.35, 0.2), 0x15171a, { y: 0.5, z: 2.38 }),
    ...wheels(4.6, 1.92),
  ]);
  return G;
}

// Emissive light quads (HDR vertex colours so they bloom): headlights front, taillights back.
function lightGeometry(len, w, y, police = false) {
  const parts = [];
  const head = new THREE.Color(5, 4.6, 3.6), tail = new THREE.Color(2.6, 0.12, 0.08);
  const quad = (x, z, c, ry, sw = 0.42) => {
    const g = new THREE.PlaneGeometry(sw, 0.16);
    g.rotateY(ry);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    parts.push(g);
  };
  for (const sx of [-1, 1]) {
    quad(sx * (w / 2 - 0.3), len / 2 + 0.03, head, 0);
    quad(sx * (w / 2 - 0.3), -len / 2 - 0.03, tail, Math.PI);
  }
  return mergeGeometries(parts);
}

// Light bar: left half red, right half blue; brightness is driven per instance (flash pattern).
function lightBarGeometry() {
  const parts = [];
  for (const [x, c] of [[-0.33, new THREE.Color(1, 0.05, 0.03)], [0.33, new THREE.Color(0.05, 0.2, 1)]]) {
    const g = new THREE.BoxGeometry(0.6, 0.15, 0.32);
    g.translate(x, 1.71, -0.05);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  return mergeGeometries(parts);
}

const DIMS = { sedan: [0.95, 0.8, 2.25], van: [1.0, 1.15, 2.5], bus: [1.25, 1.55, 5.5], police: [0.96, 0.85, 2.3] };
const LIGHT_Y = { sedan: 0.78, van: 0.82, bus: 0.95, police: 0.78 };
const COLORS = [0xc0392b, 0x2471a3, 0xe8e8e8, 0x1c1c1c, 0x7f8c8d, 0xf4d03f, 0x1e8449, 0xa04000, 0x5b2c6f, 0xd5d8dc, 0x922b21];

export class Traffic {
  constructor(ctx) {
    this.ctx = ctx;
    const geos = carGeometries();
    const mat = patchCityLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 }));
    this.mat = mat;
    this.geos = geos;
    this.meshes = {};
    this.dyn = {};
    for (const k of Object.keys(geos)) {
      const cap = k === 'bus' ? 30 : k === 'police' ? 40 : 260;
      const m = new THREE.InstancedMesh(geos[k], mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      m.setColorAt(0, _c.set(1, 1, 1));
      m.count = 0;
      ctx.root.add(m);
      // head/tail lights share the body's instance matrices
      const [, , hz] = DIMS[k];
      const lm = new THREE.InstancedMesh(lightGeometry(hz * 2, (DIMS[k][0] * 2), LIGHT_Y[k]), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), cap);
      lm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      lm.frustumCulled = false;
      lm.count = 0;
      lm.userData.noAO = true;
      ctx.root.add(lm);
      this.meshes[k] = { mesh: m, lights: lm, slots: [], cap };
    }
    // police light bars (flash colours set per instance each frame)
    this.bar = new THREE.InstancedMesh(lightBarGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), 40);
    this.bar.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bar.frustumCulled = false;
    this.bar.count = 0;
    this.bar.setColorAt(0, _c.set(1, 1, 1));
    this.bar.userData.noAO = true;
    ctx.root.add(this.bar);
    this.cars = [];
    this.bodies = []; // dynamic cars {car, body}
    this.time = 0;
    this._populate();
  }

  _newCar(type, color) {
    const M = this.meshes[type];
    let slot = M.slots.findIndex((s) => s === null);
    if (slot < 0) { if (M.slots.length >= M.cap) return null; slot = M.slots.length; M.slots.push(null); }
    const car = { type, slot, x: 0, y: 0, z: 0, yaw: 0, tilt: 0, roll: 0, color: new THREE.Color(color), speed: 0, state: 'drive', squash: 1, burn: 0 };
    M.slots[slot] = car;
    M.mesh.count = Math.max(M.mesh.count, slot + 1);
    M.lights.count = M.mesh.count;
    this.cars.push(car);
    return car;
  }

  _freeCar(car) {
    const M = this.meshes[car.type];
    M.slots[car.slot] = null;
    M.mesh.setMatrixAt(car.slot, ZERO);
    M.lights.setMatrixAt(car.slot, ZERO);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  _populate() {
    for (const c of ROAD_CENTERS) {
      for (const vertical of [true, false]) {
        for (const dir of [1, -1]) {
          const off = dir > 0 ? -1.9 : 1.9; // drive on the right
          let t = -CITY_HALF - 60 + Math.random() * 30;
          while (t < CITY_HALF + 60) {
            t += 22 + Math.random() * 40;
            const type = Math.random() < 0.06 ? 'bus' : Math.random() < 0.2 ? 'van' : 'sedan';
            const color = type === 'bus' ? 0xe0a419 : Math.random() < 0.12 ? 0xf1c40f : pick(COLORS);
            const car = this._newCar(type, color);
            if (!car) break;
            car.vertical = vertical; car.c = c; car.off = off; car.dir = dir; car.t = t * dir;
            car.max = type === 'bus' ? 9 : 11 + Math.random() * 4;
            car.speed = car.max;
          }
          // parked cars along the curb
          for (let p = -CITY_HALF + 20; p < CITY_HALF - 20; p += 9) {
            if (Math.random() > 0.22) continue;
            if (ROAD_CENTERS.some((rc) => Math.abs(rc - p) < 16)) continue;
            const car = this._newCar(Math.random() < 0.2 ? 'van' : 'sedan', pick(COLORS));
            if (!car) break;
            car.state = 'parked';
            const po = dir > 0 ? -5.3 : 5.3;
            if (vertical) { car.x = c + po; car.z = p; car.yaw = dir > 0 ? 0 : Math.PI; }
            else { car.z = c + po; car.x = p; car.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
          }
        }
      }
    }
  }

  _lightGreen(vertical) {
    const ph = Math.floor(this.time / 9) % 2;
    return vertical ? ph === 0 : ph === 1;
  }

  update(dt) {
    this.time += dt;
    const g = this.ctx.gorilla;
    // group moving cars by lane for spacing
    const lanes = new Map();
    for (const car of this.cars) {
      if (car.state !== 'drive' && car.state !== 'flee') continue;
      const key = `${car.vertical}|${car.c}|${car.dir}`;
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push(car);
    }
    for (const list of lanes.values()) {
      list.sort((a, b) => b.t - a.t); // t increases along travel direction
      for (let i = 0; i < list.length; i++) {
        const car = list[i];
        const ahead = i > 0 ? list[i - 1] : null;
        let target = car.state === 'flee' ? 19 : car.max;
        const halfLen = DIMS[car.type][2];
        if (ahead) {
          const gap = ahead.t - car.t - halfLen - DIMS[ahead.type][2];
          if (gap < 4) target = 0;
          else if (gap < 14) target = Math.min(target, (gap - 4) * 1.2);
        }
        // signals (fleeing drivers run the reds)
        if (car.state === 'drive' && !this._lightGreen(car.vertical)) {
          const pos = car.t * car.dir; // world coordinate along road
          for (const rc of ROAD_CENTERS) {
            const dist = (rc - pos) * car.dir - 13 - halfLen;
            if (dist > 0 && dist < 22) { target = Math.min(target, dist * 0.8); break; }
          }
        }
        // the monster on the road ahead
        if (g) {
          const ax = car.vertical ? car.c + car.off : car.t * car.dir;
          const az = car.vertical ? car.t * car.dir : car.c + car.off;
          const dx = g.pos.x - ax, dz = g.pos.z - az;
          const d = Math.hypot(dx, dz);
          if (d < 70 && car.state === 'drive') {
            car.state = Math.random() < 0.5 ? 'flee' : 'abandoned';
            if (car.state === 'abandoned') { car.speed = 0; this._placeLane(car); continue; }
          }
          const fwdx = car.vertical ? 0 : car.dir, fwdz = car.vertical ? car.dir : 0;
          if (d < 30 && dx * fwdx + dz * fwdz > 0) target = 0;
        }
        const a = target > car.speed ? 6 : 14;
        car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), a * dt);
        car.t += car.speed * dt;
        if (car.t > CITY_HALF + 90) {
          // wrap around to the far end if the monster isn't looking there
          car.t = -CITY_HALF - 90;
          if (car.state === 'flee') car.state = 'drive';
        }
        this._placeLane(car);
      }
    }
    // dynamic (knocked) cars follow their rigid bodies
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const d = this.bodies[i];
      const t = d.body.translation(), r = d.body.rotation();
      d.car.x = t.x; d.car.y = t.y; d.car.z = t.z;
      d.q = d.q || new THREE.Quaternion();
      d.q.set(r.x, r.y, r.z, r.w);
      d.age += dt;
      if (d.car.burn > 0) {
        d.car.burn -= dt;
        if (Math.random() < 0.35) this.ctx.fx.smoke(t.x, t.y + 1.5, t.z, 2.5, 0.12, 4, 3);
        if (Math.random() < 0.5) this.ctx.fx.fire(t.x, t.y + 1, t.z, 1.6);
        this.ctx.lights.pulse(t.x, t.z, 0.8, 0.34, 0.08, 10);
      }
      if ((d.age > 6 && d.body.isSleeping()) || d.age > 20) {
        // freeze as a static wreck
        d.car.state = 'wreck';
        d.car.q = d.q.clone();
        this.ctx.physics.removeBody(d.body);
        this.bodies.splice(i, 1);
      }
    }
    // write instances
    const cam = this.ctx.camPos || { x: 0, z: 0 };
    let bars = 0;
    this.flash = (this.flash || 0) + dt;
    for (const car of this.cars) {
      const M = this.meshes[car.type].mesh;
      const LM = this.meshes[car.type].lights;
      if (car.state === 'held') { M.setMatrixAt(car.slot, ZERO); LM.setMatrixAt(car.slot, ZERO); continue; }
      if (car.state === 'dynamic' || car.state === 'wreck') {
        const q = car.state === 'dynamic' ? this.bodies.find((b) => b.car === car)?.q : car.q;
        const h = DIMS[car.type][1];
        _p.set(0, -h, 0).applyQuaternion(q || _q.identity());
        _p.add(new THREE.Vector3(car.x, car.y, car.z));
        _m.compose(_p, q || _q.identity(), _s.set(1, car.squash, 1));
      } else {
        _q.setFromEuler(_e.set(car.tilt || 0, car.yaw, car.roll || 0));
        _m.compose(_p.set(car.x, car.y, car.z), _q, _s.set(1, car.squash, 1));
      }
      M.setMatrixAt(car.slot, _m);
      const k = car.burn > 0 || car.burnt ? 0.18 : 1;
      M.setColorAt(car.slot, _c.copy(car.color).multiplyScalar(k));
      // lights: running cars and police; wrecks and parked cars are dark
      const lit = (car.state === 'drive' || car.state === 'flee' || car.state === 'police' || car.state === 'abandoned') && !car.burnt;
      LM.setMatrixAt(car.slot, lit ? _m : ZERO);
      const near = (car.x - cam.x) ** 2 + (car.z - cam.z) ** 2 < 230 * 230;
      if (lit && near && car.state !== 'abandoned') {
        const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
        this.ctx.lights.pulse(car.x + fx * 9, car.z + fz * 9, 0.42, 0.4, 0.34, 9);
      }
      if (car.type === 'police' && car.state !== 'held') {
        const live = car.state === 'police' || car.state === 'abandoned';
        if (live) {
          // alternating red / blue strobes; each car has its own phase
          const ph = (this.flash * 2.6 + car.slot * 0.37) % 1;
          const red = ph < 0.5 ? (Math.sin(ph * Math.PI * 8) > 0 ? 5 : 0.4) : 0.3;
          const blue = ph >= 0.5 ? (Math.sin(ph * Math.PI * 8) > 0 ? 5 : 0.4) : 0.3;
          this.bar.setMatrixAt(bars, _m);
          this.bar.setColorAt(bars, _c.setRGB(red, 1, blue));
          bars++;
          if (near) this.ctx.lights.pulse(car.x, car.z, red > 1 ? 0.9 : 0.05, 0.03, blue > 1 ? 1.0 : 0.05, 16);
        }
      }
    }
    this.bar.count = bars;
    this.bar.instanceMatrix.needsUpdate = true;
    if (this.bar.instanceColor) this.bar.instanceColor.needsUpdate = true;
    for (const k in this.meshes) {
      this.meshes[k].mesh.instanceMatrix.needsUpdate = true;
      this.meshes[k].lights.instanceMatrix.needsUpdate = true;
      if (this.meshes[k].mesh.instanceColor) this.meshes[k].mesh.instanceColor.needsUpdate = true;
    }
  }

  _placeLane(car) {
    const along = car.t * car.dir;
    if (car.vertical) { car.x = car.c + car.off; car.z = along; car.yaw = car.dir > 0 ? 0 : Math.PI; }
    else { car.z = car.c + car.off; car.x = along; car.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  }

  _makeDynamic(car, vel, spin = 4) {
    if (car.state === 'dynamic') {
      const d = this.bodies.find((b) => b.car === car);
      if (d) { d.body.setLinvel(vel, true); d.age = 0; }
      return;
    }
    if (this.bodies.length >= 50) {
      const old = this.bodies.shift();
      old.car.state = 'wreck';
      old.car.q = old.q ? old.q.clone() : new THREE.Quaternion();
      this.ctx.physics.removeBody(old.body);
    }
    const [hx, hy, hz] = DIMS[car.type];
    let q;
    if (car.state === 'wreck' && car.q) q = car.q.clone();
    else q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, car.yaw, 0));
    const wasWreck = car.state === 'wreck';
    const cy = wasWreck ? car.y + 0.05 : car.y + hy + 0.05;
    const body = this.ctx.physics.dynamicBox({ x: car.x, y: cy, z: car.z }, q, hx, hy, hz, {
      density: car.type === 'bus' ? 0.5 : 0.35, linvel: vel,
      angvel: { x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin },
      friction: 0.6, restitution: 0.15, linearDamping: 0.05, angularDamping: 0.2,
    });
    car.state = 'dynamic';
    car.y = cy;
    this.bodies.push({ car, body, age: 0, q });
  }

  hit(p, radius, dir, power) {
    let n = 0;
    for (const car of this.cars) {
      if (car.state === 'held') continue;
      const dx = car.x - p.x, dy = car.y + 1 - p.y, dz = car.z - p.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      const v = { x: dir.x * 26 * power + dx * 0.5, y: 9 + 8 * power, z: dir.z * 26 * power + dz * 0.5 };
      this._makeDynamic(car, v, 7);
      if (power > 1.3 && Math.random() < 0.6) this._explode(car);
      this.ctx.events.emit('carHit', { x: car.x, y: car.y, z: car.z });
      n++;
    }
    return n;
  }

  shock(p, radius, power) {
    for (const car of this.cars) {
      if (car.state === 'held') continue;
      const dx = car.x - p.x, dz = car.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const k = (1 - d / radius) * power;
      this._makeDynamic(car, { x: (dx / (d || 1)) * 10 * k, y: 6 + 14 * k, z: (dz / (d || 1)) * 10 * k }, 6 * k);
    }
  }

  crush(x, z, radius) {
    for (const car of this.cars) {
      if (car.state === 'held' || car.squash < 1) continue;
      if (Math.abs(car.x - x) > radius || Math.abs(car.z - z) > radius) continue;
      if (Math.hypot(car.x - x, car.z - z) > radius) continue;
      if (car.state === 'dynamic') continue;
      car.squash = 0.45;
      car.state = car.state === 'wreck' ? 'wreck' : 'crushed';
      car.burnt = Math.random() < 0.3;
      if (Math.random() < 0.25) this._explode(car);
      this.ctx.stats.vehicles++;
    }
  }

  _explode(car) {
    car.burn = 8 + Math.random() * 6;
    car.burnt = true;
    this.ctx.fx.explosion(new THREE.Vector3(car.x, car.y + 1, car.z), 0.8);
    this.ctx.events.emit('explosion', { x: car.x, y: car.y, z: car.z, power: 0.8 });
    this.ctx.city.scar(car.x, car.z, 5, 0.8, 0, 0);
    this.ctx.stats.vehicles++;
  }

  grabCandidates(p, radius) {
    const out = [];
    for (const car of this.cars) {
      if (car.state === 'held') continue;
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d > radius || Math.abs(car.y - p.y) > 8) continue;
      out.push({ kind: 'car', edible: false, pos: new THREE.Vector3(car.x, car.y, car.z), take: () => this._take(car) });
    }
    return out;
  }

  _take(car) {
    if (car.state === 'dynamic') {
      const i = this.bodies.findIndex((b) => b.car === car);
      if (i >= 0) { this.ctx.physics.removeBody(this.bodies[i].body); this.bodies.splice(i, 1); }
    }
    car.state = 'held';
    const mat = this.mat.clone();
    mat.vertexColors = true;
    const mesh = new THREE.Mesh(this.geos[car.type], mat);
    mesh.castShadow = true;
    const tint = new THREE.Color().copy(car.color).multiplyScalar(car.burnt ? 0.2 : 1);
    mat.color = tint;
    const [hx, hy, hz] = DIMS[car.type];
    const self = this;
    const held = new Held(this.ctx, {
      kind: 'car', mesh, heavy: car.type === 'bus',
      offset: new THREE.Vector3(0, -1.0 - hy, 0.6),
      localRot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
      half: new THREE.Vector3(hx, hy, hz),
      projectile: { explode: true, power: car.type === 'bus' ? 2.6 : 2.0, centerOffset: -hy },
      onConsume: () => self._freeCar(car),
    });
    held.onRelease = (pos, vel) => {
      self._freeCar(car);
      self.ctx.projectiles.launch(held, pos, vel);
    };
    return held;
  }
}
