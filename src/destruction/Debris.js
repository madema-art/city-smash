import * as THREE from 'three';
import { makeRockGeometry } from '../fx/Ballistic.js';
import { DESTRUCTION } from '../config.js';
import { patchCityLight } from '../render/CityLights.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

// Persistent rubble: static instanced chunks plus a coarse height grid so piles build up
// where buildings fell and the monster/debris can stand on them.
export class RubbleField {
  constructor(scene, extent = 300, res = 2) {
    this.cap = DESTRUCTION.maxRubble;
    const geo = makeRockGeometry(0, 7);
    const mat = patchCityLight(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0, flatShading: true }), { key: 'rubble' });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    scene.add(this.mesh);
    this.n = 0;
    this.extent = extent;
    this.res = res;
    this.dim = Math.ceil((extent * 2) / res);
    this.h = new Float32Array(this.dim * this.dim);
    this.dirty = false;
  }

  heightAt(x, z) {
    const i = Math.floor((x + this.extent) / this.res), j = Math.floor((z + this.extent) / this.res);
    if (i < 0 || j < 0 || i >= this.dim || j >= this.dim) return 0;
    return this.h[j * this.dim + i];
  }

  raise(x, z, radius, amount, maxH = 9) {
    const r = Math.ceil(radius / this.res);
    const ci = Math.floor((x + this.extent) / this.res), cj = Math.floor((z + this.extent) / this.res);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.dim || j >= this.dim) continue;
        const dx = (i - ci) * this.res, dz = (j - cj) * this.res;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > radius) continue;
        const k = j * this.dim + i;
        this.h[k] = Math.min(maxH, this.h[k] + amount * (1 - d / radius));
      }
    }
  }

  add(x, z, size, color, { yOffset = 0, sx, sy, sz, settle = true } = {}) {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    const base = this.heightAt(x, z);
    const y = base + size * 0.22 + yOffset;
    _e.set(Math.random() * 0.8 - 0.4, Math.random() * 6.28, Math.random() * 0.8 - 0.4);
    _q.setFromEuler(_e);
    _s.set(sx ?? size * (0.8 + Math.random() * 0.6), sy ?? size * (0.45 + Math.random() * 0.4), sz ?? size * (0.8 + Math.random() * 0.6));
    _m.compose(_p.set(x, y, z), _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, _c.copy(color).multiplyScalar(0.7));
    if (settle) this.raise(x, z, size * 0.9, size * 0.16);
    this.mesh.count = this.n;
    this.dirty = true;
  }

  update() {
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      this.dirty = false;
    }
  }

  clear() {
    this.n = 0; this.mesh.count = 0; this.h.fill(0);
  }
}

// Pooled rigid-body debris. Only a few hundred bodies are ever simulated; when a chunk
// comes to rest (or the pool needs room) it is baked into the static rubble field.
export class DebrisSystem {
  constructor(scene, physics, rubble, events) {
    this.physics = physics;
    this.rubble = rubble;
    this.events = events;
    this.cap = DESTRUCTION.maxPhysicsDebris;
    const geo = makeRockGeometry(0, 3);
    const mat = patchCityLight(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0, flatShading: true }), { key: 'debris' });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    scene.add(this.mesh);
    this.items = []; // {body, size:Vector3, color:Color, age, still}
    this.impactCooldown = 0;
  }

  spawn(pos, vel, size, color, spin = 6) {
    if (this.items.length >= this.cap) this._retire(0);
    const q = _q.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const body = this.physics.dynamicBox(pos, q, size.x * 0.42, size.y * 0.42, size.z * 0.42, {
      density: 2.4,
      linvel: vel,
      angvel: { x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin },
      friction: 0.9,
      restitution: 0.05,
      linearDamping: 0.02,
      angularDamping: 0.6,
    });
    this.items.push({ body, size: size.clone(), color: color.clone(), age: 0, still: 0, hit: false });
  }

  _retire(index) {
    const it = this.items[index];
    const t = it.body.translation();
    if (t.y < 40) {
      // bake into rubble at current position
      const s = (it.size.x + it.size.y + it.size.z) / 3;
      this.rubble.add(t.x, t.z, s, it.color, { sx: it.size.x, sy: it.size.y * 0.7, sz: it.size.z, settle: true });
    }
    this.physics.removeBody(it.body);
    this.items.splice(index, 1);
  }

  update(dt) {
    this.impactCooldown -= dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const lv = it.body.linvel();
      const sp2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
      const t = it.body.translation();
      if (sp2 < 0.6) it.still += dt; else it.still = 0;
      // heavy chunk smashing into the street: let the crowd / traffic react
      if (!it.hit && t.y < 2.5 && sp2 > 200 && this.impactCooldown <= 0) {
        it.hit = true;
        this.impactCooldown = 0.05;
        this.events.emit('debrisImpact', { x: t.x, y: t.y, z: t.z, size: it.size.x });
      }
      if (it.still > 0.8 || it.age > 9 || t.y < -5 || it.body.isSleeping()) this._retire(i);
    }
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      const t = it.body.translation();
      const r = it.body.rotation();
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), it.size);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, it.color);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const it of this.items) this.physics.removeBody(it.body);
    this.items.length = 0;
    this.mesh.count = 0;
  }
}
