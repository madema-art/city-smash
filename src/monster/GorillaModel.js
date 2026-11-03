import * as THREE from 'three';
import { buildField, surfaceNets, primDist, primBounds, smin, smax } from './sdf.js';

// Procedurally sculpted silverback gorilla.
// Authored in "real gorilla" metres (≈1.8 tall upright, Y up, facing +Z) and scaled up at runtime.
// Anatomy is a set of smoothly blended muscle/bone primitives; each primitive belongs to a bone,
// so skin weights fall out of the same distance field that shapes the body.

// Head is authored at natural size then scaled/lowered: silverbacks carry a big head sunk into the shoulders.
const HS = 1.12;
export const HX = (v) => [v[0] * HS, (v[1] - 1.53) * HS + 1.53 - 0.04, (v[2] - 0.15) * HS + 0.15 + 0.025];
const HR = (r) => r.map((x) => x * HS);

const JOINTS = {
  root: [null, [0, 0, 0]],
  hips: ['root', [0, 0.8, -0.04]],
  spine: ['hips', [0, 0.98, -0.02]],
  chest: ['spine', [0, 1.16, 0.0]],
  neck: ['chest', [0, 1.4, 0.07]],
  head: ['neck', HX([0, 1.5, 0.12])],
  jaw: ['head', HX([0, 1.5, 0.17])],
  clavL: ['chest', [0.1, 1.4, 0.02]],
  upperArmL: ['clavL', [0.36, 1.37, 0.02]],
  forearmL: ['upperArmL', [0.5, 0.96, 0.07]],
  handL: ['forearmL', [0.57, 0.56, 0.13]],
  thighL: ['hips', [0.14, 0.78, -0.04]],
  shinL: ['thighL', [0.18, 0.43, 0.04]],
  footL: ['shinL', [0.19, 0.09, -0.01]],
};
// mirror right side
for (const k of Object.keys(JOINTS)) {
  if (k.endsWith('L')) {
    const [parent, p] = JOINTS[k];
    JOINTS[k.slice(0, -1) + 'R'] = [parent && parent.endsWith('L') ? parent.slice(0, -1) + 'R' : parent, [-p[0], p[1], p[2]]];
  }
}
export const BONE_NAMES = Object.keys(JOINTS);

const COLORS = {
  fur: new THREE.Color(0x141110),
  furBrown: new THREE.Color(0x2c1d14),
  skin: new THREE.Color(0x26232a),
  crest: new THREE.Color(0x3b291f),
  silver: new THREE.Color(0x5c5c60),
  lip: new THREE.Color(0x1e1a1c),
  sole: new THREE.Color(0x3a3537),
};

function E(c, r, bone, region = 'fur', k = 0.04, extra = {}) { return { type: 'ell', c, r, bone, region, k, ...extra }; }
function C(a, b, r1, r2, bone, region = 'fur', k = 0.04, extra = {}) { return { type: 'cone', a, b, r1, r2, bone, region, k, ...extra }; }

function mirrorPrim(p) {
  const m = { ...p };
  const fx = (v) => [-v[0], v[1], v[2]];
  if (p.c) m.c = fx(p.c);
  if (p.a) { m.a = fx(p.a); m.b = fx(p.b); }
  const mb = (b) => (b.endsWith('L') ? b.slice(0, -1) + 'R' : b);
  if (typeof p.bone === 'string') m.bone = mb(p.bone);
  else m.bone = Object.fromEntries(Object.entries(p.bone).map(([k, v]) => [mb(k), v]));
  if (p.q) m.q = [p.q[0], -p.q[1], -p.q[2], p.q[3]];
  return m;
}

function quatFromEuler(x, y, z) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

function definePrims() {
  const torso = [
    E([0, 0.83, -0.05], [0.22, 0.16, 0.17], 'hips', 'fur', 0.07),
    E([0, 0.99, 0.05], [0.25, 0.22, 0.22], 'spine', 'fur', 0.09),
    E([0, 1.17, 0.02], [0.31, 0.27, 0.25], 'chest', 'fur', 0.09),
    E([0.12, 1.24, 0.15], [0.14, 0.11, 0.085], 'chest', 'skin', 0.05),
    E([-0.12, 1.24, 0.15], [0.14, 0.11, 0.085], 'chest', 'skin', 0.05),
    E([0, 1.2, -0.1], [0.33, 0.24, 0.18], 'chest', 'fur', 0.09),
    E([0, 0.97, -0.1], [0.24, 0.18, 0.14], 'spine', 'fur', 0.08),
    E([0, 1.4, -0.03], [0.33, 0.13, 0.18], { chest: 0.75, neck: 0.25 }, 'fur', 0.09),
    E([0, 1.45, 0.0], [0.17, 0.1, 0.14], { neck: 0.7, chest: 0.3 }, 'fur', 0.07),
    E([0.1, 0.8, -0.14], [0.11, 0.11, 0.09], 'hips', 'fur', 0.05),
    E([-0.1, 0.8, -0.14], [0.11, 0.11, 0.09], 'hips', 'fur', 0.05),
    // deltoids belong to torso group so the shoulder reads as one mass
    E([0.33, 1.36, 0.02], [0.14, 0.14, 0.15], { upperArmL: 0.75, chest: 0.25 }, 'fur', 0.06),
    E([-0.33, 1.36, 0.02], [0.14, 0.14, 0.15], { upperArmR: 0.75, chest: 0.25 }, 'fur', 0.06),
  ];
  const head = [
    E([0, 1.555, 0.13], [0.12, 0.12, 0.13], 'head', 'fur', 0.04),
    E([0, 1.655, 0.07], [0.055, 0.1, 0.115], 'head', 'crest', 0.06),
    E([0, 1.585, 0.235], [0.122, 0.036, 0.055], 'head', 'skin', 0.035),
    E([0, 1.53, 0.215], [0.095, 0.075, 0.075], 'head', 'skin', 0.03),
    E([0, 1.49, 0.265], [0.1, 0.06, 0.07], 'head', 'skin', 0.03),
    E([0, 1.548, 0.292], [0.058, 0.036, 0.032], 'head', 'skin', 0.02),
    E([0, 1.445, 0.238], [0.092, 0.045, 0.075], 'jaw', 'lip', 0.03),
    E([0, 1.43, 0.2], [0.1, 0.05, 0.07], 'jaw', 'fur', 0.04),
    E([0.09, 1.5, 0.18], [0.065, 0.08, 0.07], 'head', 'fur', 0.03),
    E([-0.09, 1.5, 0.18], [0.065, 0.08, 0.07], 'head', 'fur', 0.03),
    E([0.125, 1.55, 0.1], [0.02, 0.034, 0.03], 'head', 'skin', 0.012),
    E([-0.125, 1.55, 0.1], [0.02, 0.034, 0.03], 'head', 'skin', 0.012),
    // eye sockets, nostrils, mouth slit (subtractive)
    E([0.048, 1.556, 0.27], [0.03, 0.02, 0.024], 'head', 'skin', 0.014, { sub: true }),
    E([-0.048, 1.556, 0.27], [0.03, 0.02, 0.024], 'head', 'skin', 0.014, { sub: true }),
    E([0.021, 1.533, 0.322], [0.013, 0.01, 0.014], 'head', 'skin', 0.006, { sub: true }),
    E([-0.021, 1.533, 0.322], [0.013, 0.01, 0.014], 'head', 'skin', 0.006, { sub: true }),
    E([0, 1.466, 0.31], [0.075, 0.006, 0.035], 'head', 'lip', 0.008, { sub: true }),
  ];
  for (const p of head) { p.c = HX(p.c); p.r = HR(p.r); p.k *= HS; }
  const armL = [
    C([0.36, 1.37, 0.02], [0.5, 0.96, 0.07], 0.105, 0.085, 'upperArmL', 'fur', 0.05),
    E([0.44, 1.18, 0.08], [0.08, 0.14, 0.08], 'upperArmL', 'fur', 0.045, { q: quatFromEuler(0, 0, 0.3) }),
    E([0.44, 1.18, -0.02], [0.08, 0.15, 0.08], 'upperArmL', 'fur', 0.045, { q: quatFromEuler(0, 0, 0.3) }),
    C([0.5, 0.96, 0.07], [0.57, 0.56, 0.13], 0.09, 0.07, 'forearmL', 'fur', 0.05),
    E([0.52, 0.84, 0.08], [0.118, 0.165, 0.115], 'forearmL', 'fur', 0.045, { q: quatFromEuler(0, 0, 0.17) }),
    E([0.58, 0.47, 0.15], [0.088, 0.1, 0.075], 'handL', 'fur', 0.03),
    C([0.54, 0.42, 0.185], [0.536, 0.34, 0.205], 0.031, 0.028, 'handL', 'skin', 0.016),
    C([0.568, 0.42, 0.19], [0.567, 0.335, 0.212], 0.032, 0.029, 'handL', 'skin', 0.016),
    C([0.596, 0.42, 0.188], [0.597, 0.337, 0.21], 0.031, 0.028, 'handL', 'skin', 0.016),
    C([0.622, 0.42, 0.18], [0.626, 0.345, 0.198], 0.027, 0.025, 'handL', 'skin', 0.016),
    C([0.527, 0.47, 0.195], [0.51, 0.405, 0.225], 0.026, 0.022, 'handL', 'skin', 0.014),
  ];
  const legL = [
    C([0.14, 0.78, -0.04], [0.18, 0.43, 0.04], 0.12, 0.09, 'thighL', 'fur', 0.06),
    E([0.16, 0.62, 0.0], [0.12, 0.17, 0.13], 'thighL', 'fur', 0.05),
    C([0.18, 0.43, 0.04], [0.19, 0.1, -0.01], 0.085, 0.06, 'shinL', 'fur', 0.05),
    E([0.185, 0.3, -0.02], [0.08, 0.12, 0.08], 'shinL', 'fur', 0.04),
    E([0.19, 0.05, 0.06], [0.075, 0.045, 0.14], 'footL', 'fur', 0.03),
    C([0.14, 0.04, 0.11], [0.12, 0.035, 0.17], 0.026, 0.022, 'footL', 'skin', 0.015),
    E([0.205, 0.035, 0.18], [0.06, 0.03, 0.045], 'footL', 'skin', 0.02),
  ];
  const groups = [
    { name: 'torso', prims: torso },
    { name: 'head', prims: head },
    { name: 'armL', prims: armL },
    { name: 'armR', prims: armL.map(mirrorPrim) },
    { name: 'legL', prims: legL },
    { name: 'legR', prims: legL.map(mirrorPrim) },
  ];
  const groupK = { torso: 0.06, head: 0.06, armL: 0.035, armR: 0.035, legL: 0.05, legR: 0.05 };
  return { groups, groupK };
}

// 3D value noise for fur clumping.
function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    s += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let cached = null;

export function buildGorillaGeometry(resolution = 0.0135) {
  if (cached) return cached;
  const t0 = performance.now();
  const { groups, groupK } = definePrims();
  const F = buildField(groups, groupK, [-0.78, -0.03, -0.36, 0.78, 1.84, 0.42], resolution);
  const { positions, indices } = surfaceNets(F);
  const nV = positions.length / 3;
  const all = groups.flatMap((g) => g.prims.map((p) => ({ ...p, group: g.name })));
  const adds = all.filter((p) => !p.sub);
  const bounds = all.map(primBounds);

  const evalSDF = (x, y, z) => {
    let total = 1;
    for (const g of groups) {
      let d = 1;
      for (const p of g.prims) {
        if (p.sub) continue;
        d = smin(d, primDist(p, x, y, z), p.k);
      }
      for (const p of g.prims) if (p.sub) d = smax(d, -primDist(p, x, y, z), p.k);
      total = smin(total, d, groupK[g.name]);
    }
    return total;
  };

  const normals = new Float32Array(nV * 3);
  const colors = new Float32Array(nV * 3);
  const skinIdx = new Uint16Array(nV * 4);
  const skinW = new Float32Array(nV * 4);
  const furA = new Float32Array(nV);
  const boneIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const e = resolution * 0.5;
  const tmpC = new THREE.Color();
  const acc = new THREE.Color();

  for (let v = 0; v < nV; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let nx = evalSDF(x + e, y, z) - evalSDF(x - e, y, z);
    let ny = evalSDF(x, y + e, z) - evalSDF(x, y - e, z);
    let nz = evalSDF(x, y, z + e) - evalSDF(x, y, z - e);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;

    // primitive influences
    const ds = [];
    let dmin = 1e9;
    for (let p = 0; p < adds.length; p++) {
      const P = adds[p];
      const b = bounds[all.indexOf(P)];
      if (x < b[0] - 0.05 || x > b[3] + 0.05 || y < b[1] - 0.05 || y > b[4] + 0.05 || z < b[2] - 0.05 || z > b[5] + 0.05) continue;
      const d = Math.max(0, primDist(P, x, y, z));
      ds.push([P, d]);
      if (d < dmin) dmin = d;
    }
    const bw = new Map();
    let cw = 0;
    acc.setRGB(0, 0, 0);
    let furSum = 0;
    for (const [P, d] of ds) {
      const w = Math.exp(-(d - dmin) / 0.02);
      if (typeof P.bone === 'string') bw.set(P.bone, (bw.get(P.bone) || 0) + w);
      else for (const [bn, f] of Object.entries(P.bone)) bw.set(bn, (bw.get(bn) || 0) + w * f);
      const wc = Math.exp(-(d - dmin) / 0.006);
      tmpC.copy(COLORS[P.region]);
      acc.r += tmpC.r * wc; acc.g += tmpC.g * wc; acc.b += tmpC.b * wc;
      furSum += (P.region === 'skin' || P.region === 'lip' ? 0 : 1) * wc;
      cw += wc;
    }
    if (cw > 0) { acc.r /= cw; acc.g /= cw; acc.b /= cw; furSum /= cw; }
    let fur = furSum;
    // silver saddle across the back and down the thighs
    const back = smooth(0.06, -0.1, z) * smooth(0.76, 0.9, y) * (1 - smooth(1.18, 1.36, y)) * (1 - smooth(0.2, 0.34, Math.abs(x)));
    const backFacing = smooth(0.2, -0.5, nz);
    let silver = back * backFacing * (0.55 + 0.45 * vnoise3(x * 14, y * 30, z * 14));
    silver += 0.18 * smooth(0.8, 0.6, y) * smooth(0.45, 0.68, y) * smooth(0.1, -0.2, nz) * (1 - smooth(0.25, 0.32, Math.abs(x)));
    silver = Math.min(1, silver) * fur;
    const nn = vnoise3(x * 40, y * 40, z * 40);
    const n2 = vnoise3(x * 9 + 3, y * 9, z * 9);
    acc.lerp(COLORS.silver, Math.min(1, silver * (0.6 + 0.4 * nn)));
    if (fur > 0.5) acc.lerp(COLORS.furBrown, 0.45 * n2 * (1 - silver));
    if (y < 0.02 && fur > 0) acc.lerp(COLORS.sole, 0.8);
    // greying on the muzzle edges / chin
    colors[v * 3] = acc.r; colors[v * 3 + 1] = acc.g; colors[v * 3 + 2] = acc.b;
    furA[v] = fur;

    // fur clumping displacement
    if (fur > 0.3) {
      const disp = (nn - 0.5) * 0.007 * fur + n2 * 0.003 * fur;
      positions[v * 3] += nx * disp; positions[v * 3 + 1] += ny * disp; positions[v * 3 + 2] += nz * disp;
    }

    const sorted = [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = sorted.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      if (k < sorted.length) {
        skinIdx[v * 4 + k] = boneIndex[sorted[k][0]];
        skinW[v * 4 + k] = sorted[k][1] / sum;
      }
    }
  }

  // ensure winding agrees with the field gradient
  let agree = 0;
  for (let t = 0; t < Math.min(indices.length, 30000); t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const wx = positions[c * 3] - positions[a * 3], wy = positions[c * 3 + 1] - positions[a * 3 + 1], wz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    agree += Math.sign(fx * normals[a * 3] + fy * normals[a * 3 + 1] + fz * normals[a * 3 + 2]);
  }
  if (agree < 0) {
    for (let t = 0; t < indices.length; t += 3) { const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp; }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aFur', new THREE.BufferAttribute(furA, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  cached = { geo, ms: performance.now() - t0, verts: nV, tris: indices.length / 3 };
  return cached;
}

export function gorillaMaterial({ shell = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uShell = { value: 0 };
    mat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFur; varying float vFur; varying vec3 vRest; varying vec3 vVN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFur = aFur; vRest = position;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vVN = normalize(transformedNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFur; varying vec3 vRest; varying vec3 vVN;
        float fh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float fn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(fh(i), fh(i+vec3(1,0,0)), f.x), mix(fh(i+vec3(0,1,0)), fh(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(fh(i+vec3(0,0,1)), fh(i+vec3(1,0,1)), f.x), mix(fh(i+vec3(0,1,1)), fh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // hair strands: stretched noise along Y in rest space
        float strands = fn(vec3(vRest.x * 260.0, vRest.y * 60.0, vRest.z * 260.0));
        float clump = fn(vRest * 45.0);
        diffuseColor.rgb *= mix(1.0, 0.55 + 0.9 * strands * (0.55 + 0.45 * clump), vFur);
        // wrinkled leathery skin
        float wr = fn(vRest * vec3(120.0, 380.0, 120.0));
        diffuseColor.rgb *= mix(0.85 + 0.25 * wr, 1.0, vFur);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.42 + 0.2 * wr, 0.8 + 0.15 * strands, vFur);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // perturb normal with strand noise for a furry, non-plastic response
          vec3 g = vec3(fn(vRest * 220.0 + 1.3), fn(vRest * 220.0 + 5.1), fn(vRest * 220.0 + 9.7)) - 0.5;
          normal = normalize(normal + g * (0.55 * vFur + 0.18 * (1.0 - vFur)));
        }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        // fur scatters the sky softly instead of mirroring it; skin keeps a leathery sheen
        radiance *= mix(0.7, 0.18, vFur);
        iblIrradiance *= 0.85;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // soft rim sheen: fur catches light at grazing angles
          float rim = pow(1.0 - clamp(abs(dot(normalize(vVN), vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 3.5);
          totalEmissiveRadiance += (diffuseColor.rgb * 0.35 + vec3(0.016, 0.013, 0.01)) * rim * vFur;
        }`);
  };
  mat.customProgramCacheKey = () => 'gorilla-skin-v2' + (shell ? '-shell' : '');
  return mat;
}

export function createSkeleton() {
  const bones = {};
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    const [parent, p] = JOINTS[name];
    if (parent) {
      const pp = JOINTS[parent][1];
      bones[name].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      bones[parent].add(bones[name]);
    } else bones[name].position.set(p[0], p[1], p[2]);
  }
  const list = BONE_NAMES.map((n) => bones[n]);
  return { bones, skeleton: new THREE.Skeleton(list), rest: Object.fromEntries(BONE_NAMES.map((n) => [n, JOINTS[n][1]])) };
}

// Eyes, teeth and mouth cavity: separate small meshes riding on head/jaw bones.
export function attachFaceDetails(bones) {
  const rest = (n) => new THREE.Vector3(...JOINTS[n][1]);
  const headRest = rest('head'), jawRest = rest('jaw');
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a1406, roughness: 0.08, metalness: 0.1, emissive: 0x120700, emissiveIntensity: 0.6 });
  const eyeGeo = new THREE.SphereGeometry(0.021, 14, 10);
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(...HX([0.048 * s, 1.556, 0.266])).sub(headRest);
    eye.scale.setScalar(HS);
    bones.head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(...HX([0.048 * s + 0.006, 1.563, 0.285])).sub(headRest);
    bones.head.add(glint);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3a0d10, roughness: 0.5 }));
  mouth.scale.set(0.068 * HS, 0.03 * HS, 0.05 * HS);
  mouth.position.set(...HX([0, 1.47, 0.25])).sub(headRest);
  bones.head.add(mouth);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xe9e2c8, roughness: 0.35 });
  const fang = new THREE.ConeGeometry(0.009, 0.04, 6).rotateX(Math.PI);
  for (const s of [1, -1]) {
    const f = new THREE.Mesh(fang, toothMat);
    f.position.set(...HX([0.036 * s, 1.466, 0.278])).sub(headRest);
    f.scale.setScalar(HS);
    bones.head.add(f);
    const lf = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 6), toothMat);
    lf.position.set(...HX([0.03 * s, 1.455, 0.272])).sub(jawRest);
    lf.scale.setScalar(HS);
    bones.jaw.add(lf);
  }
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), toothMat);
  upper.position.set(...HX([0, 1.47, 0.284])).sub(headRest);
  bones.head.add(upper);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.012), toothMat);
  lower.position.set(...HX([0, 1.457, 0.275])).sub(jawRest);
  bones.jaw.add(lower);
}

// Create a skinned, posable gorilla (shares the sculpted geometry between instances).
export function instantiateGorilla({ scale = 1 } = {}) {
  const { geo } = buildGorillaGeometry();
  const { bones, skeleton, rest } = createSkeleton();
  const mat = gorillaMaterial();
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones.root);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  attachFaceDetails(bones);
  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(scale);
  return { group, mesh, bones, skeleton, rest, material: mat };
}
