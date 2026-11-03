import * as THREE from 'three';

// Instanced, CPU-integrated tumbling pieces without rigid-body cost.
// Glass shards and small concrete chips use this: thousands of them are cheap.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export class BallisticPieces {
  constructor(scene, geometry, material, capacity, { castShadow = false, groundLinger = 3, bounce = 0.25 } = {}) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = false;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    scene.add(this.mesh);
    this.n = 0;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.r = new Float32Array(capacity * 3);
    this.rv = new Float32Array(capacity * 3);
    this.s = new Float32Array(capacity * 3);
    this.t = new Float32Array(capacity);
    this.rest = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 3);
    this.groundLinger = groundLinger;
    this.bounce = bounce;
    this.floorFn = null; // optional (x,z)=>height
  }

  spawn(x, y, z, vx, vy, vz, sx, sy, sz, color) {
    let i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.r[i3] = Math.random() * 6; this.r[i3 + 1] = Math.random() * 6; this.r[i3 + 2] = Math.random() * 6;
    this.rv[i3] = (Math.random() - 0.5) * 14; this.rv[i3 + 1] = (Math.random() - 0.5) * 14; this.rv[i3 + 2] = (Math.random() - 0.5) * 14;
    this.s[i3] = sx; this.s[i3 + 1] = sy; this.s[i3 + 2] = sz;
    this.t[i] = 0;
    this.rest[i] = 0;
    this.colors[i3] = color.r; this.colors[i3 + 1] = color.g; this.colors[i3 + 2] = color.b;
  }

  update(dt, gravity) {
    let w = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      this.t[i] += dt;
      if (this.rest[i] > this.groundLinger) continue; // dead
      if (w !== i) {
        const w3 = w * 3;
        for (let k = 0; k < 3; k++) {
          this.p[w3 + k] = this.p[i3 + k]; this.v[w3 + k] = this.v[i3 + k];
          this.r[w3 + k] = this.r[i3 + k]; this.rv[w3 + k] = this.rv[i3 + k];
          this.s[w3 + k] = this.s[i3 + k]; this.colors[w3 + k] = this.colors[i3 + k];
        }
        this.t[w] = this.t[i]; this.rest[w] = this.rest[i];
      }
      w++;
    }
    this.n = w;
    for (let i = 0; i < w; i++) {
      const i3 = i * 3;
      const floor = this.floorFn ? this.floorFn(this.p[i3], this.p[i3 + 2]) : 0;
      if (this.rest[i] > 0) {
        this.rest[i] += dt;
      } else {
        this.v[i3 + 1] += gravity * dt;
        this.v[i3] *= 1 - 0.3 * dt; this.v[i3 + 2] *= 1 - 0.3 * dt;
        this.p[i3] += this.v[i3] * dt;
        this.p[i3 + 1] += this.v[i3 + 1] * dt;
        this.p[i3 + 2] += this.v[i3 + 2] * dt;
        this.r[i3] += this.rv[i3] * dt; this.r[i3 + 1] += this.rv[i3 + 1] * dt; this.r[i3 + 2] += this.rv[i3 + 2] * dt;
        if (this.p[i3 + 1] < floor + 0.1) {
          this.p[i3 + 1] = floor + 0.1;
          if (Math.abs(this.v[i3 + 1]) < 3) {
            this.rest[i] = 0.0001;
            this.r[i3] = Math.round(this.r[i3] / Math.PI) * Math.PI; // lie flat-ish
          } else {
            this.v[i3 + 1] *= -this.bounce;
            this.v[i3] *= 0.5; this.v[i3 + 2] *= 0.5;
            this.rv[i3] *= 0.5; this.rv[i3 + 1] *= 0.5; this.rv[i3 + 2] *= 0.5;
          }
        }
      }
      const fade = this.rest[i] > 0 ? Math.max(0, 1 - this.rest[i] / this.groundLinger) : 1;
      _p.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
      _q.setFromEuler(_e.set(this.r[i3], this.r[i3 + 1], this.r[i3 + 2]));
      _s.set(this.s[i3] * fade, this.s[i3 + 1] * fade, this.s[i3 + 2] * fade);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(this.colors[i3], this.colors[i3 + 1], this.colors[i3 + 2]));
    }
    this.mesh.count = w;
    if (w > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, w * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, w * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

export function makeShardGeometry() {
  // A thin irregular quad-ish triangle fan: reads as a pane fragment.
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    -0.5, -0.5, 0, 0.55, -0.35, 0, 0.1, 0.6, 0,
    0.55, -0.35, 0, 0.45, 0.25, 0, 0.1, 0.6, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function makeRockGeometry(detail = 0, seed = 1) {
  const g = new THREE.IcosahedronGeometry(0.5, detail);
  const pos = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // jitter vertices and flatten a bit so chunks look like broken slabs
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 0.75 + rnd() * 0.45);
    const k = map.get(key);
    pos.setXYZ(i, pos.getX(i) * k * 1.15, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g.toNonIndexed ? g : g;
}
