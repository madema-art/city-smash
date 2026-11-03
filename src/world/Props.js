import * as THREE from 'three';
import { part, merge, box, cyl, sphere } from '../core/geom.js';
import { patchCityLight } from '../render/CityLights.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function buildGeometries() {
  const G = {};
  // Street lamp (~9 m): reads as waist-high to the monster.
  G.lamp = merge([
    part(cyl(0.18, 0.28, 9, 6), 0x3b4046, { y: 4.5 }),
    part(box(0.2, 0.2, 2.6), 0x3b4046, { y: 8.9, z: 1.2 }),
    part(box(0.6, 0.25, 1.0), 0xfff1c8, { y: 8.75, z: 2.4 }),
    part(cyl(0.45, 0.5, 0.6, 6), 0x2c3035, { y: 0.3 }),
  ]);
  G.tree = merge([
    part(cyl(0.3, 0.45, 4, 6), 0x4a3424, { y: 2 }),
    part(new THREE.IcosahedronGeometry(2.6, 0), 0x3f6b32, { y: 5.2 }),
    part(new THREE.IcosahedronGeometry(2.0, 0), 0x4d7d3a, { y: 6.6, x: 0.8, z: -0.4 }),
    part(new THREE.IcosahedronGeometry(1.8, 0), 0x355e2b, { y: 5.6, x: -1.2, z: 0.8 }),
  ]);
  G.signal = merge([
    part(cyl(0.18, 0.22, 7, 6), 0x2f3337, { y: 3.5 }),
    part(box(0.2, 0.2, 5), 0x2f3337, { y: 6.8, z: 2.4 }),
    part(box(0.6, 1.8, 0.6), 0x1d2124, { y: 6.1, z: 4.4 }),
    part(sphere(0.2, 6, 4), 0xff3020, { y: 6.7, z: 4.75 }),
    part(sphere(0.2, 6, 4), 0x30ff60, { y: 5.6, z: 4.75 }),
  ]);
  G.hydrant = merge([
    part(cyl(0.3, 0.35, 1.0, 6), 0xc8241b, { y: 0.5 }),
    part(sphere(0.3, 6, 4), 0xc8241b, { y: 1.0 }),
  ]);
  G.bench = merge([
    part(box(2.4, 0.15, 0.8), 0x7b5236, { y: 0.6 }),
    part(box(2.4, 0.7, 0.12), 0x7b5236, { y: 1.0, z: -0.35 }),
    part(box(0.15, 0.6, 0.7), 0x333333, { y: 0.3, x: -1 }),
    part(box(0.15, 0.6, 0.7), 0x333333, { y: 0.3, x: 1 }),
  ]);
  // Roof props
  G.ac = merge([
    part(box(3.2, 1.8, 2.4), 0x9aa0a6, { y: 0.9 }),
    part(cyl(0.9, 0.9, 0.3, 10), 0x55595e, { y: 1.9, x: 0.6 }),
    part(box(3.3, 0.15, 2.5), 0x7a7f84, { y: 0.07 }),
  ]);
  const legs = [];
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) legs.push(part(box(0.25, 3.5, 0.25), 0x3d3027, { x, z, y: 1.75 }));
  G.watertower = merge([
    ...legs,
    part(cyl(2.1, 2.1, 4.2, 12), 0x7a5a3e, { y: 5.6 }),
    part(new THREE.ConeGeometry(2.4, 1.6, 12), 0x4a3a2c, { y: 8.5 }),
    part(cyl(2.15, 2.15, 0.2, 12), 0x2b2b2b, { y: 4.4 }),
    part(cyl(2.15, 2.15, 0.2, 12), 0x2b2b2b, { y: 6.6 }),
  ]);
  G.antenna = merge([
    part(cyl(0.12, 0.35, 16, 5), 0xb5b9be, { y: 8 }),
    part(box(1.4, 0.12, 0.12), 0xb5b9be, { y: 10 }),
    part(box(1.0, 0.12, 0.12), 0xb5b9be, { y: 13 }),
    part(sphere(0.3, 6, 4), 0xff2a1a, { y: 16.2 }),
  ]);
  G.billboard = merge([
    part(box(0.3, 4, 0.3), 0x333, { x: -3, y: 2 }),
    part(box(0.3, 4, 0.3), 0x333, { x: 3, y: 2 }),
    part(box(9, 4.5, 0.3), 0xf2c14e, { y: 5.6 }),
    part(box(8.4, 1.4, 0.35), 0xd94f30, { y: 5.0 }),
  ]);
  G.helipad = merge([
    part(cyl(5.5, 5.5, 0.25, 20), 0x3a3d40, { y: 0.12 }),
    part(box(0.6, 0.27, 4), 0xf5f5f5, { y: 0.13, x: -1.2 }),
    part(box(0.6, 0.27, 4), 0xf5f5f5, { y: 0.13, x: 1.2 }),
    part(box(2.4, 0.27, 0.6), 0xf5f5f5, { y: 0.13 }),
  ]);
  G.stairhouse = merge([
    part(box(4, 3, 4), 0x8f8a82, { y: 1.5 }),
    part(box(4.3, 0.3, 4.3), 0x6d6964, { y: 3.1 }),
  ]);
  // Street furniture
  G.busstop = merge([
    part(box(4.2, 0.12, 1.7), 0x2e3238, { y: 2.6 }),
    part(box(4.0, 2.4, 0.06), 0x9fc4d8, { y: 1.3, z: -0.75 }),
    part(box(0.12, 2.6, 0.12), 0x2e3238, { x: -2.0, y: 1.3, z: -0.75 }),
    part(box(0.12, 2.6, 0.12), 0x2e3238, { x: 2.0, y: 1.3, z: -0.75 }),
    part(box(0.12, 2.6, 0.12), 0x2e3238, { x: 2.0, y: 1.3, z: 0.75 }),
    part(box(1.3, 2.0, 0.15), 0xffe7a8, { x: 2.1, y: 1.3, z: 0.1, ry: Math.PI / 2 }),
    part(box(2.6, 0.12, 0.45), 0x6b4a2e, { y: 0.55, z: -0.45 }),
  ]);
  G.trashcan = merge([
    part(cyl(0.42, 0.36, 1.05, 8), 0x2f4a3a, { y: 0.53 }),
    part(cyl(0.46, 0.46, 0.1, 8), 0x22362b, { y: 1.08 }),
  ]);
  // Iron fire escape: one storey (platform, rails, diagonal stair), bolted to a brick facade
  const fe = [];
  const IRON = 0x24262a;
  fe.push(part(box(3.6, 0.1, 1.3), IRON, { y: 0.05, z: 0.65 }));
  fe.push(part(box(3.6, 0.06, 0.06), IRON, { y: 1.05, z: 1.28 }));
  fe.push(part(box(3.6, 0.06, 0.06), IRON, { y: 0.55, z: 1.28 }));
  for (const x of [-1.75, -0.6, 0.6, 1.75]) fe.push(part(box(0.05, 1.05, 0.05), IRON, { x, y: 0.55, z: 1.28 }));
  fe.push(part(box(0.06, 1.05, 1.3), IRON, { x: -1.78, y: 0.55, z: 0.65 }));
  fe.push(part(box(0.06, 1.05, 1.3), IRON, { x: 1.78, y: 0.55, z: 0.65 }));
  fe.push(part(box(0.55, 0.06, 4.5), IRON, { x: 0.9, y: 2.05, z: 0.85, rx: -0.95, ry: Math.PI / 2, sx: 1 }));
  fe.push(part(box(0.05, 0.05, 4.5), IRON, { x: 0.9, y: 2.6, z: 1.12, rx: -0.95, ry: Math.PI / 2 }));
  G.fireescape = merge(fe);
  G.balcony = merge([
    part(box(3.0, 0.22, 1.3), 0x8d867c, { y: 0.11, z: 0.65 }),
    part(box(3.0, 0.08, 0.08), 0x2b2c30, { y: 1.05, z: 1.27 }),
    ...[-1.45, -0.5, 0.5, 1.45].map((x) => part(box(0.05, 0.95, 0.05), 0x2b2c30, { x, y: 0.55, z: 1.27 })),
    part(box(0.06, 0.95, 1.3), 0x2b2c30, { x: -1.47, y: 0.55, z: 0.65 }),
    part(box(0.06, 0.95, 1.3), 0x2b2c30, { x: 1.47, y: 0.55, z: 0.65 }),
    part(box(0.5, 0.45, 0.4), 0x3f6b32, { x: -0.9, y: 0.45, z: 0.9 }),
  ]);
  return G;
}

// Collider half-extents and visual centre offset for knocked-over props.
const PHYS = {
  lamp: { hx: 0.4, hy: 4.5, hz: 0.6, cy: 4.5, density: 0.5 },
  tree: { hx: 1.6, hy: 3.6, hz: 1.6, cy: 3.6, density: 0.3 },
  signal: { hx: 0.4, hy: 3.6, hz: 0.6, cy: 3.5, density: 0.5 },
  hydrant: { hx: 0.35, hy: 0.6, hz: 0.35, cy: 0.6, density: 1 },
  bench: { hx: 1.2, hy: 0.6, hz: 0.45, cy: 0.6, density: 0.6 },
  ac: { hx: 1.6, hy: 1.0, hz: 1.2, cy: 1.0, density: 0.8 },
  watertower: { hx: 2.1, hy: 4.5, hz: 2.1, cy: 4.5, density: 0.4 },
  antenna: { hx: 0.5, hy: 8, hz: 0.5, cy: 8, density: 0.2 },
  billboard: { hx: 4.5, hy: 3.8, hz: 0.4, cy: 3.8, density: 0.3 },
  helipad: { hx: 5, hy: 0.2, hz: 5, cy: 0.12, density: 0.5 },
  stairhouse: { hx: 2, hy: 1.6, hz: 2, cy: 1.6, density: 1 },
  busstop: { hx: 2.1, hy: 1.35, hz: 0.85, cy: 1.35, density: 0.3 },
  trashcan: { hx: 0.45, hy: 0.55, hz: 0.45, cy: 0.55, density: 0.5 },
  fireescape: { hx: 1.8, hy: 1.2, hz: 0.7, cy: 1.0, density: 0.4 },
  balcony: { hx: 1.5, hy: 0.5, hz: 0.7, cy: 0.4, density: 0.6 },
};

class PropType {
  constructor(root, name, geo, mat, cap, dynCap) {
    this.name = name;
    this.phys = PHYS[name];
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    root.add(this.mesh);
    this.dyn = new THREE.InstancedMesh(geo, mat, dynCap);
    this.dyn.castShadow = true;
    this.dyn.count = 0;
    this.dyn.frustumCulled = false;
    this.dyn.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(this.dyn);
    this.items = [];
    this.bodies = [];
    this.dynCap = dynCap;
    this.dirty = false;
  }
}

export class Props {
  constructor(ctx) {
    this.ctx = ctx;
    const G = buildGeometries();
    const mat = patchCityLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 }));
    this.types = {};
    const caps = { lamp: 400, tree: 400, signal: 120, hydrant: 200, bench: 200, ac: 300, watertower: 80, antenna: 60, billboard: 60, helipad: 30, stairhouse: 120, busstop: 80, trashcan: 260, fireescape: 900, balcony: 900 };
    for (const k of Object.keys(G)) this.types[k] = new PropType(ctx.root, k, G[k], mat, caps[k], 30);
    this.grid = new Map(); // coarse spatial hash for street props
    // glowing lamp heads (bloom) for street lamps; hidden when the lamp is destroyed
    this.glow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.22, 1.15), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 2.4, 1.3) }), caps.lamp);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    ctx.root.add(this.glow);
    // aviation warning beacons on tall roofs
    this.beacons = [];
    this.dying = []; // lamps flickering out {x, z, t}
  }

  _key(x, z) { return `${Math.floor(x / 16)},${Math.floor(z / 16)}`; }

  addStreet(type, x, z, rotY = 0, scale = 1) {
    const T = this.types[type];
    if (T.mesh.count >= T.mesh.instanceMatrix.count) return null;
    const id = T.mesh.count++;
    const item = { type, id, x, z, rotY, scale, alive: true, street: true };
    T.items.push(item);
    _q.setFromEuler(_e.set(0, rotY, 0));
    _m.compose(_p.set(x, 0, z), _q, _s.set(scale, scale, scale));
    T.mesh.setMatrixAt(id, _m);
    T.dirty = true;
    const k = this._key(x, z);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(item);
    if (type === 'lamp' && this.ctx.lights) {
      // lamp head sits at the end of the arm
      const hx = x + Math.sin(rotY) * 2.4 * scale, hz = z + Math.cos(rotY) * 2.4 * scale;
      item.light = this.ctx.lights.addStatic(hx, hz, 0xffa95c, 0.55, 15);
      item.glow = this.glow.count++;
      _m.compose(_p.set(hx, 8.75 * scale, hz), _q.setFromEuler(_e.set(0, rotY, 0)), _s.set(1, 1, 1));
      this.glow.setMatrixAt(item.glow, _m);
      this.glow.instanceMatrix.needsUpdate = true;
      item.hx = hx; item.hz = hz;
    }
    return item;
  }

  // Roof prop attached to a building cell (building-local position).
  addRoof(type, building, cell, lx, ly, lz, rotY = 0, scale = 1) {
    const T = this.types[type];
    if (T.mesh.count >= T.mesh.instanceMatrix.count) return null;
    const id = T.mesh.count++;
    const local = new THREE.Matrix4().compose(_p.set(lx, ly, lz), _q.setFromEuler(_e.set(0, rotY, 0)), _s.set(scale, scale, scale));
    const item = { type, id, cell, local, building, section: null, gone: false, scale };
    T.items.push(item);
    building.props.push(item);
    _m.multiplyMatrices(building.mesh.matrix, local);
    T.mesh.setMatrixAt(id, _m);
    T.dirty = true;
    return item;
  }

  // Knock a static prop loose into a physics body.
  _spawnDynamic(T, worldMatrix, vel, scale = 1) {
    if (T.bodies.length >= T.dynCap) {
      const old = T.bodies.shift();
      this.ctx.physics.removeBody(old.body);
    }
    const ph = T.phys;
    worldMatrix.decompose(_p, _q, _s);
    const c = new THREE.Vector3(0, ph.cy * scale, 0).applyQuaternion(_q).add(_p);
    const body = this.ctx.physics.dynamicBox(c, _q, ph.hx * scale, ph.hy * scale, ph.hz * scale, {
      density: ph.density, linvel: vel,
      angvel: { x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 3 },
      friction: 0.8, restitution: 0.1, linearDamping: 0.1, angularDamping: 0.4,
    });
    T.bodies.push({ body, cy: ph.cy * scale, scale, age: 0 });
  }

  detachRoofProp(item, building) {
    if (item.gone) return;
    item.gone = true;
    const T = this.types[item.type];
    const wm = new THREE.Matrix4().multiplyMatrices(item.section ? item.section.worldMatrix : building.mesh.matrix, item.local);
    T.mesh.setMatrixAt(item.id, ZERO);
    T.dirty = true;
    const out = new THREE.Vector3().setFromMatrixPosition(wm).sub(new THREE.Vector3(building.cx, 0, building.cz)).setY(0).normalize();
    this._spawnDynamic(T, wm, { x: out.x * 6, y: 3, z: out.z * 6 }, item.scale);
  }

  // Shockwave / impact: knock street props over.
  impulse(x, z, radius, strength = 10) {
    const r = Math.ceil(radius / 16);
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      const list = this.grid.get(`${i},${j}`);
      if (!list) continue;
      for (const it of list) {
        if (!it.alive) continue;
        const dx = it.x - x, dz = it.z - z;
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        it.alive = false;
        if (it.light) this._lampOut(it);
        const T = this.types[it.type];
        const wm = new THREE.Matrix4().compose(_p.set(it.x, 0, it.z), _q.setFromEuler(_e.set(0, it.rotY, 0)), _s.set(it.scale, it.scale, it.scale));
        T.mesh.setMatrixAt(it.id, ZERO);
        T.dirty = true;
        const k = strength * (1 - d / radius) + 2;
        const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
        this._spawnDynamic(T, wm, { x: nx * k, y: k * 0.4, z: nz * k }, it.scale);
      }
    }
  }

  // A street lamp is destroyed: its pool of light goes, with sparks and a dying flicker.
  _lampOut(it) {
    this.ctx.lights.setOn(it.light, 0);
    this.glow.setMatrixAt(it.glow, ZERO);
    this.glow.instanceMatrix.needsUpdate = true;
    const p = new THREE.Vector3(it.hx, 8.7, it.hz);
    this.ctx.fx.sparks(p, new THREE.Vector3(0, -1, 0), 14, [1, 0.85, 0.55]);
    this.ctx.fx.glassBurst(p, new THREE.Vector3(0, -0.5, 0), 5, 0.8);
    this.dying.push({ x: it.hx, z: it.hz, t: 0.7 });
    this.ctx.events.emit('lampBreak', { x: it.hx, y: 8.7, z: it.hz });
    this.ctx.stats.lights = (this.ctx.stats.lights || 0) + 1;
  }

  // Power cut (not physical damage): the lamp just flickers out where it stands.
  lampOutQuiet(it) {
    if (!it.light || it.light.on <= 0) return;
    this.ctx.lights.setOn(it.light, 0);
    this.glow.setMatrixAt(it.glow, ZERO);
    this.glow.instanceMatrix.needsUpdate = true;
    this.dying.push({ x: it.hx, z: it.hz, t: 0.4 + Math.random() * 0.5 });
    if (Math.random() < 0.15) this.ctx.fx.sparks(new THREE.Vector3(it.hx, 8.7, it.hz), new THREE.Vector3(0, -1, 0), 5, [1, 0.85, 0.55]);
  }

  // Number of street lamps still burning (tests / diagnostics).
  get litLamps() {
    let n = 0;
    for (const it of this.types.lamp.items) if (it.alive) n++;
    return n;
  }

  update(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t -= dt;
      if (Math.random() < 0.45) this.ctx.lights.pulse(d.x, d.z, 0.9, 0.6, 0.35, 15);
      if (d.t <= 0) this.dying.splice(i, 1);
    }
    for (const k in this.types) {
      const T = this.types[k];
      // roof props riding on collapsing sections
      for (const it of T.items) {
        if (it.section && !it.gone) {
          _m.multiplyMatrices(it.section.worldMatrix, it.local);
          T.mesh.setMatrixAt(it.id, _m);
          T.dirty = true;
          if (it.section.done) this.detachRoofProp(it, it.building);
        }
      }
      if (T.dirty) { T.mesh.instanceMatrix.needsUpdate = true; T.dirty = false; }
      const n = T.bodies.length;
      for (let i = 0; i < n; i++) {
        const b = T.bodies[i];
        const t = b.body.translation();
        const r = b.body.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        // position of the prop origin = body centre - R*(0,cy,0)
        const off = new THREE.Vector3(0, -b.cy, 0).applyQuaternion(_q);
        _p.set(t.x + off.x, t.y + off.y, t.z + off.z);
        _m.compose(_p, _q, _s.set(b.scale, b.scale, b.scale));
        T.dyn.setMatrixAt(i, _m);
      }
      T.dyn.count = n;
      if (n) T.dyn.instanceMatrix.needsUpdate = true;
    }
  }
}
