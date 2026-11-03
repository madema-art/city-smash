import * as THREE from 'three';

// Instanced articulated tiny humans (civilians and soldiers). Each body part is one
// InstancedMesh, so hundreds of animated people cost a handful of draw calls.
const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function partGeo(w, h, d, pivotTop = false) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) g.translate(0, -h / 2, 0);
  return g;
}

export class HumanRenderer {
  constructor(root, capacity, { soldier = false } = {}) {
    this.cap = capacity;
    this.soldier = soldier;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const make = (geo) => {
      const m = new THREE.InstancedMesh(geo, mat, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.setColorAt(0, _c.set(1, 1, 1));
      root.add(m);
      return m;
    };
    this.parts = {
      torso: make(partGeo(0.56, 0.78, 0.34)),
      head: make(new THREE.SphereGeometry(0.19, 8, 6)),
      legL: make(partGeo(0.24, 0.95, 0.28, true)),
      legR: make(partGeo(0.24, 0.95, 0.28, true)),
      armL: make(partGeo(0.17, 0.72, 0.19, true)),
      armR: make(partGeo(0.17, 0.72, 0.19, true)),
    };
    if (soldier) {
      this.parts.helmet = make(new THREE.SphereGeometry(0.24, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2));
      this.parts.gun = make(partGeo(0.1, 0.14, 0.95));
    }
    this.n = 0;
  }

  // h: {x,y,z,yaw,phase,anim,tumble(x,z),scale,colors:{shirt,pants,skin},squash}
  write(list, camPos) {
    let n = 0;
    const P = this.parts;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.hidden) continue;
      const dx = h.x - camPos.x, dz = h.z - camPos.z;
      const far = dx * dx + dz * dz > 200 * 200;
      const sc = h.scale || 1;
      _q.setFromEuler(_e.set(h.tx || 0, h.yaw, h.tz || 0, 'YXZ'));
      _b.compose(_p.set(h.x, h.y, h.z), _q, _s.set(sc, sc * (h.squash || 1), sc));
      const ph = h.phase;
      let legA = 0, armA = 0, armUp = 0, armZ = 0.08;
      switch (h.anim) {
        case 'walk': legA = Math.sin(ph) * 0.5; armA = -legA * 0.8; break;
        case 'run': legA = Math.sin(ph) * 0.95; armA = -legA * 0.9; break;
        case 'panic': legA = Math.sin(ph) * 0.95; armUp = -2.6 + Math.sin(ph * 2.3) * 0.5; armZ = 0.35; break;
        case 'aim': armUp = -1.45; armZ = -0.15; break;
        case 'fly': legA = Math.sin(ph * 3) * 0.8; armUp = -2.2 + Math.sin(ph * 4) * 0.8; armZ = 0.6; break;
        default: break;
      }
      // torso
      _t.makeTranslation(0, 1.34, 0);
      _m.multiplyMatrices(_b, _t);
      P.torso.setMatrixAt(n, _m);
      _t.makeTranslation(0, 1.92, 0);
      _m.multiplyMatrices(_b, _t);
      P.head.setMatrixAt(n, _m);
      if (this.soldier) {
        _t.makeTranslation(0, 1.97, 0);
        _m.multiplyMatrices(_b, _t);
        P.helmet.setMatrixAt(n, _m);
      }
      if (h.bust) { P.legL.setMatrixAt(n, ZERO); P.legR.setMatrixAt(n, ZERO); }
      if (far) {
        P.legL.setMatrixAt(n, ZERO); P.legR.setMatrixAt(n, ZERO);
        P.armL.setMatrixAt(n, ZERO); P.armR.setMatrixAt(n, ZERO);
        if (this.soldier) P.gun.setMatrixAt(n, ZERO);
      } else {
        if (!h.bust) {
          this._limb(P.legL, n, 0.14, 0.95, 0, legA, 0);
          this._limb(P.legR, n, -0.14, 0.95, 0, -legA, 0);
        }
        if (h.anim === 'aim' || h.anim === 'fireaim') {
          this._limb(P.armL, n, 0.36, 1.66, 0.05, -1.5, -0.5);
          this._limb(P.armR, n, -0.36, 1.66, 0.05, -1.45, 0.25);
        } else {
          this._limb(P.armL, n, 0.36, 1.66, 0, armA + armUp, armZ);
          this._limb(P.armR, n, -0.36, 1.66, 0, -armA + armUp, -armZ);
        }
        if (this.soldier) {
          const aim = h.anim === 'aim';
          _t.compose(_p.set(aim ? 0.05 : -0.3, aim ? 1.6 : 1.2, aim ? 0.45 : 0.15), _q.setFromEuler(_e.set(aim ? 0 : 0.6, 0, 0)), _s.set(1, 1, 1));
          _m.multiplyMatrices(_b, _t);
          P.gun.setMatrixAt(n, _m);
        }
      }
      const col = h.colors;
      P.torso.setColorAt(n, col.shirt);
      P.armL.setColorAt(n, col.shirt);
      P.armR.setColorAt(n, col.shirt);
      P.legL.setColorAt(n, col.pants);
      P.legR.setColorAt(n, col.pants);
      P.head.setColorAt(n, col.skin);
      if (this.soldier) {
        P.helmet.setColorAt(n, col.helmet);
        P.gun.setColorAt(n, _c.setRGB(0.08, 0.08, 0.08));
      }
      n++;
      if (n >= this.cap) break;
    }
    for (const k in P) {
      const m = P[k];
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.n = n;
  }

  _limb(mesh, n, x, y, z, rx, rz) {
    _t.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, 0, rz)), _s.set(1, 1, 1));
    _m.multiplyMatrices(_b, _t);
    mesh.setMatrixAt(n, _m);
  }

  // A standalone little person mesh (for holding in the monster's hand).
  static makeFigure(colors, soldier = false) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.34), mat(colors.shirt));
    torso.position.y = 1.34;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), mat(colors.skin));
    head.position.y = 1.92;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.28), mat(colors.pants));
    legs.position.y = 0.48;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.19), mat(colors.shirt));
    armL.position.set(0.5, 1.9, 0); armL.rotation.z = 2.6;
    const armR = armL.clone(); armR.position.x = -0.5; armR.rotation.z = -2.6;
    g.add(torso, head, legs, armL, armR);
    if (soldier) {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(colors.helmet));
      helm.position.y = 1.97;
      g.add(helm);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
}
