import * as THREE from 'three';
import { BONE_NAMES } from './GorillaModel.js';

// Procedural, layered animation for the gorilla rig.
// Poses are Euler triples per bone (rest pose = identity, so axes are world-aligned:
// +X pitch leans spine forward / swings a hanging limb backward, +Z abducts the LEFT arm).
// Right-side values are mirrored automatically from the left-side description.

const NB = BONE_NAMES.length;
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export class Pose {
  constructor() {
    this.r = new Float32Array(NB * 3);
    this.hips = new Float32Array(3); // hips translation offset (gu)
  }
  clear() { this.r.fill(0); this.hips.fill(0); return this; }
  set(bone, x = 0, y = 0, z = 0) {
    const i = BI[bone] * 3;
    this.r[i] = x; this.r[i + 1] = y; this.r[i + 2] = z;
    return this;
  }
  add(bone, x = 0, y = 0, z = 0) {
    const i = BI[bone] * 3;
    this.r[i] += x; this.r[i + 1] += y; this.r[i + 2] += z;
    return this;
  }
  // set left + mirrored right
  sym(bone, x, y, z) { this.set(bone + 'L', x, y, z); this.set(bone + 'R', x, -y, -z); return this; }
  side(bone, s, x, y, z) {
    // s: 'L' or 'R'; values given in left-hand convention
    if (s === 'L') this.set(bone + 'L', x, y, z); else this.set(bone + 'R', x, -y, -z);
    return this;
  }
  addSide(bone, s, x, y, z) {
    if (s === 'L') this.add(bone + 'L', x, y, z); else this.add(bone + 'R', x, -y, -z);
    return this;
  }
  copy(o) { this.r.set(o.r); this.hips.set(o.hips); return this; }
  lerp(o, w) {
    for (let i = 0; i < this.r.length; i++) this.r[i] += (o.r[i] - this.r[i]) * w;
    for (let i = 0; i < 3; i++) this.hips[i] += (o.hips[i] - this.hips[i]) * w;
    return this;
  }
  // blend only some bones (mask: Set of bone names)
  lerpMasked(o, w, mask) {
    for (const name of mask) {
      const i = BI[name] * 3;
      for (let k = 0; k < 3; k++) this.r[i + k] += (o.r[i + k] - this.r[i + k]) * w;
    }
    return this;
  }
}

export const UPPER = new Set(['spine', 'chest', 'neck', 'head', 'jaw', 'clavL', 'clavR', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR']);

const sin = Math.sin, cos = Math.cos, PI = Math.PI;
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// ----- pose library -----
// Common hunched stance: trunk pitched forward from the hips, legs compensated, head up.
function stance(p, lean, crouch = 0) {
  p.set('hips', lean, 0, 0);
  p.set('spine', 0.12, 0, 0);
  p.set('chest', 0.08, 0, 0);
  const trunk = lean + 0.2;
  p.set('neck', -trunk * 0.55, 0, 0);
  p.set('head', -trunk * 0.35, 0, 0);
  p.sym('clav', 0, 0, -0.05);
  p.sym('upperArm', -trunk - 0.15, 0, 0.12);
  p.sym('forearm', -0.18, 0, -0.04);
  p.sym('hand', 0.35, 0, 0);
  p.sym('thigh', -lean - 0.35 - crouch * 0.4, 0, 0.06);
  p.sym('shin', 0.55 + crouch * 0.7, 0, -0.03);
  p.sym('foot', -0.2 - crouch * 0.3, 0, 0);
  p.hips[1] = -0.04 - crouch * 0.09;
  p.hips[2] = -0.02;
  return p;
}


// Climbing body: torso leaned into the wall, head tilted back to look up/out.
function climbTorso(p) {
  p.clear();
  p.set('hips', 0.32, 0, 0);
  p.set('spine', 0.12, 0, 0);
  p.set('chest', 0.05, 0, 0);
  p.set('neck', -0.55, 0, 0);
  p.set('head', -0.25, 0, 0);
  p.hips[1] = -0.02;
  p.hips[2] = 0.05;
  return p;
}
// Solved limb configurations (left side; right mirrored by Pose.side).
const ARM_PULL = [-1.221, 0.348, 1.696, -1.906];
const ARM_REACH = [-2.699, -0.144, -0.112, -1.46];
const LEG_LOW = [-0.713, 0.186, -0.046, -0.3];
const LEG_HIGH = [-2.047, 0.501, 1.452, -0.4];
function armOnWall(p, s, k) {
  const a = ARM_PULL, b = ARM_REACH;
  const L = (i) => a[i] + (b[i] - a[i]) * k;
  p.side('upperArm', s, L(0), L(1), L(2));
  p.side('forearm', s, L(3), 0, 0);
  p.side('hand', s, -0.5 * k, 0, 0);
  p.side('clav', s, 0, 0, 0.15 * k);
}
function legOnWall(p, s, k) {
  const a = LEG_LOW, b = LEG_HIGH;
  const L = (i) => a[i] + (b[i] - a[i]) * k;
  p.side('thigh', s, L(0), 0, L(1));
  p.side('shin', s, L(2), 0, 0);
  p.side('foot', s, L(3), 0, 0);
}

export const Poses = {
  idle(p, t) {
    stance(p.clear(), 0.62, 0.15);
    const br = sin(t * 1.6);
    p.add('chest', br * 0.025, 0, 0);
    p.add('spine', br * 0.015, 0, 0);
    p.add('head', sin(t * 0.37) * 0.05, sin(t * 0.23) * 0.25, 0);
    p.hips[1] += br * 0.004;
    p.sym('upperArm', -0.97 - br * 0.02, 0, 0.14);
    return p;
  },

  // Quadrupedal knuckle-walk. phase 0..1 per stride; diagonal pairs move together.
  walk(p, phase, speedK = 1) {
    stance(p.clear(), 0.82, 0.1);
    const a = phase * PI * 2;
    const L = sin(a), R = sin(a + PI);
    const amp = 0.42 * speedK;
    // legs
    p.addSide('thigh', 'L', -L * amp, 0, 0);
    p.addSide('thigh', 'R', -R * amp, 0, 0);
    p.addSide('shin', 'L', Math.max(0, cos(a)) * 0.6 * speedK, 0, 0);
    p.addSide('shin', 'R', Math.max(0, cos(a + PI)) * 0.6 * speedK, 0, 0);
    // arms opposite to their same-side leg
    p.addSide('upperArm', 'L', R * amp * 0.9, 0, 0);
    p.addSide('upperArm', 'R', L * amp * 0.9, 0, 0);
    p.addSide('forearm', 'L', -Math.max(0, -cos(a)) * 0.5 * speedK, 0, 0);
    p.addSide('forearm', 'R', -Math.max(0, -cos(a + PI)) * 0.5 * speedK, 0, 0);
    // weight shift + swagger
    p.add('hips', 0, L * 0.07 * speedK, L * 0.05 * speedK);
    p.add('chest', 0, -L * 0.12 * speedK, -L * 0.06 * speedK);
    p.add('head', 0, L * 0.06, 0);
    p.hips[1] += Math.abs(cos(a)) * 0.025 * speedK;
    p.hips[0] += L * 0.012 * speedK;
    return p;
  },

  // Bounding gallop: arms reach together, then legs.
  run(p, phase) {
    stance(p.clear(), 0.98, 0.15);
    const a = phase * PI * 2;
    const s = sin(a), c = cos(a);
    const off = 0.18; // slight offset between left and right for a rolling gait
    p.addSide('upperArm', 'L', -s * 0.75 - 0.15, 0, 0);
    p.addSide('upperArm', 'R', -sin(a + off) * 0.75 - 0.15, 0, 0);
    p.addSide('forearm', 'L', -Math.max(0, c) * 0.7, 0, 0);
    p.addSide('forearm', 'R', -Math.max(0, cos(a + off)) * 0.7, 0, 0);
    p.addSide('thigh', 'L', s * 0.75, 0, 0);
    p.addSide('thigh', 'R', sin(a + off) * 0.75, 0, 0);
    p.addSide('shin', 'L', Math.max(0, -c) * 0.9, 0, 0);
    p.addSide('shin', 'R', Math.max(0, -cos(a + off)) * 0.9, 0, 0);
    p.add('hips', -c * 0.12, 0, 0);
    p.add('spine', c * 0.12, 0, 0);
    p.add('chest', c * 0.08, 0, 0);
    p.add('neck', -c * 0.1, 0, 0);
    p.hips[1] += Math.max(0, s) * 0.08;
    return p;
  },

  air(p, vy) {
    // vy>0 rising (tucked, arms up), vy<0 falling (arms out, legs reaching)
    stance(p.clear(), 0.5, 0);
    const rise = clamp01(vy / 15), fall = clamp01(-vy / 20);
    p.sym('upperArm', -1.2 - rise * 0.9 + fall * 0.6, 0, 0.45 + fall * 0.5);
    p.sym('forearm', -0.6 * rise - 0.2, 0, 0);
    p.sym('thigh', -0.9 - rise * 0.5 + fall * 0.4, 0, 0.12);
    p.sym('shin', 0.9 + rise * 0.6 - fall * 0.5, 0, 0);
    p.add('neck', -0.2, 0, 0);
    p.add('jaw', 0.25 * fall, 0, 0);
    return p;
  },

  land(p, k) {
    // k: 0..1 impact squash
    stance(p.clear(), 0.9, 0.6 * k);
    p.sym('upperArm', -1.6, 0, 0.5);
    p.sym('forearm', -0.3, 0, 0);
    p.hips[1] -= 0.08 * k;
    return p;
  },

  // Punch: t 0..1 over the action; side 'L'/'R'
  punch(p, t, s, base) {
    p.copy(base);
    const o = s === 'L' ? 'R' : 'L';
    const wind = ease(seg(t, 0, 0.32));
    const strike = ease(seg(t, 0.32, 0.46));
    const rec = ease(seg(t, 0.6, 1));
    const k = (1 - rec);
    const sgn = s === 'L' ? 1 : -1;
    // rear up for the swing
    p.add('hips', -0.25 * k, 0, 0);
    p.add('spine', -0.2 * k, sgn * (0.35 * wind - 0.8 * strike) * k, 0);
    p.add('chest', -0.12 * k, sgn * (0.25 * wind - 0.55 * strike) * k, 0);
    p.add('neck', 0.25 * k, -sgn * (0.2 * wind - 0.4 * strike) * k, 0);
    // striking arm: cocked back then fully extended forward
    const ax = -0.4 + wind * 0.9 - strike * 2.45;
    p.side('upperArm', s, ax * k + base.r[0] * 0, (0.3 * wind - 0.3 * strike) * k, 0.55 * wind * k + 0.1);
    p.side('forearm', s, (-1.6 * wind + 1.5 * strike) * k - 0.1, 0, 0);
    p.side('hand', s, 0.1, 0, 0);
    // other arm braces
    p.side('upperArm', o, -1.2 * k, 0, 0.35 * k);
    p.side('forearm', o, -0.9 * k, 0, 0);
    return p;
  },

  // Two-handed overhead hammer blow.
  smash(p, t, base) {
    p.copy(base);
    const up = ease(seg(t, 0, 0.38));
    const down = ease(seg(t, 0.38, 0.5));
    const rec = ease(seg(t, 0.66, 1));
    const k = 1 - rec;
    p.add('hips', (-0.6 * up + 0.85 * down) * k, 0, 0);
    p.add('spine', (-0.3 * up + 0.45 * down) * k, 0, 0);
    p.add('chest', (-0.2 * up + 0.3 * down) * k, 0, 0);
    p.add('neck', (0.4 * up - 0.5 * down) * k, 0, 0);
    p.add('jaw', 0.3 * up * k, 0, 0);
    const ua = (-2.9 * up + 2.1 * down);
    p.sym('upperArm', base.r[BI.upperArmL * 3] * (1 - k) + ua * k - 0.2 * k, 0, 0.12 + 0.3 * up * (1 - down) * k);
    p.sym('forearm', (-0.9 * up + 0.9 * down) * k - 0.2, 0, 0);
    p.sym('thigh', -0.9 - 0.35 * down * k, 0, 0.1);
    p.sym('shin', 0.75 + 0.35 * down * k, 0, 0);
    p.hips[1] += (0.05 * up - 0.12 * down) * k;
    return p;
  },

  // Ground stomp with the right foot.
  stomp(p, t, base) {
    p.copy(base);
    const lift = ease(seg(t, 0, 0.42));
    const down = ease(seg(t, 0.42, 0.52));
    const rec = ease(seg(t, 0.62, 1));
    const k = 1 - rec;
    const h = lift * (1 - down);
    p.add('hips', -0.55 * h * k, 0, -0.08 * h * k);
    p.add('spine', -0.15 * h * k, 0, 0);
    p.add('neck', 0.3 * h * k, 0, 0);
    p.side('thigh', 'R', (-0.9 - 1.0 * h) * k + base.r[BI.thighR * 3] * (1 - k), 0, 0.1);
    p.side('shin', 'R', (0.6 + 1.2 * h) * k, 0, 0);
    p.side('thigh', 'L', -0.4 * k - 0.6 * h * k + base.r[BI.thighL * 3] * (1 - k), 0, 0.08);
    p.sym('upperArm', -0.7 * k - 0.6 * (1 - k), 0, 0.8 * h * k + 0.15);
    p.sym('forearm', -0.6 * h * k, 0, 0);
    p.add('jaw', 0.35 * down * k, 0, 0);
    p.hips[1] += 0.06 * h * k;
    return p;
  },

  // Chest-beat roar.
  roar(p, t, base) {
    p.copy(base);
    const rise = ease(seg(t, 0, 0.18));
    const rec = ease(seg(t, 0.82, 1));
    const k = rise * (1 - rec);
    p.lerp(new Pose().clear(), 0); // keep
    p.set('hips', 0.6 * (1 - k) - 0.05 * k, 0, 0);
    p.set('spine', -0.05 * k, 0, 0);
    p.set('chest', -0.1 * k, 0, 0);
    p.set('neck', -0.25 * k, 0, 0);
    p.set('head', -0.3 * k, 0, 0);
    const beat = seg(t, 0.2, 0.8);
    const b = sin(beat * PI * 10);
    const jaw = 0.55 * ease(seg(t, 0.12, 0.25)) * (1 - ease(seg(t, 0.75, 0.9)));
    p.set('jaw', jaw, 0, 0);
    // arms alternate pounding the chest: elbows out, fists folded in against the pecs
    const bl = Math.max(0, b) * k, br = Math.max(0, -b) * k;
    // (solved numerically so the fists land on the pecs)
    p.side('upperArm', 'L', 0.3 * k + base.r[BI.upperArmL * 3] * (1 - k) - 0.25 * bl, -1.3 * k + 0.35 * bl, 0.6 * k + 0.12 * (1 - k) + 0.25 * bl);
    p.side('upperArm', 'R', 0.3 * k + base.r[BI.upperArmR * 3] * (1 - k) - 0.25 * br, -1.3 * k + 0.35 * br, 0.6 * k + 0.12 * (1 - k) + 0.25 * br);
    p.side('forearm', 'L', -2.2 * k + 0.35 * bl, 0, 0);
    p.side('forearm', 'R', -2.2 * k + 0.35 * br, 0, 0);
    p.sym('hand', 0.3 * k, 0, 0);
    p.sym('thigh', -0.25 * k + base.r[BI.thighL * 3] * (1 - k), 0, 0.12);
    p.sym('shin', 0.3 * k + base.r[BI.shinL * 3] * (1 - k), 0, 0);
    p.sym('foot', -0.05, 0, 0);
    p.hips[1] = base.hips[1] * (1 - k) + 0.02 * k;
    return p;
  },

  // Reach out and grab with the right hand (t 0..1), ends holding at chest.
  grab(p, t, base, low = 1) {
    p.copy(base);
    const reach = ease(seg(t, 0, 0.45));
    const lift = ease(seg(t, 0.45, 1));
    p.add('hips', (0.25 * reach * low - 0.4 * lift), 0, 0);
    p.add('spine', 0, -0.2 * reach * (1 - lift), 0);
    p.side('upperArm', 'R', (-1.3 - 0.4 * reach) * (1 - lift) + lift * -1.1, 0, 0.15 + 0.2 * lift);
    p.side('forearm', 'R', -0.1 * (1 - lift) - 1.4 * lift, -0.4 * lift, 0);
    p.side('hand', 'R', 0.6 * reach * (1 - lift), 0, 0);
    return p;
  },

  // Holding something in the right hand at chest height while moving.
  hold(p, base) {
    p.copy(base);
    p.side('upperArm', 'R', -1.15, 0, 0.35);
    p.side('forearm', 'R', -1.35, -0.4, 0);
    p.side('hand', 'R', 0.2, 0, 0);
    return p;
  },

  // Bring hand to mouth, chomp.
  eat(p, t, base) {
    p.copy(base);
    const up = ease(seg(t, 0, 0.3));
    const rec = ease(seg(t, 0.85, 1));
    const k = up * (1 - rec);
    p.add('hips', -0.25 * k, 0, 0);
    p.add('neck', -0.15 * k, 0, 0);
    p.add('head', 0.2 * k, -0.15 * k, 0);
    p.side('upperArm', 'R', -1.15 * (1 - k) - 1.55 * k, 0, 0.35 * (1 - k) + 0.75 * k);
    p.side('forearm', 'R', -1.35 * (1 - k) - 2.2 * k, -0.4 * (1 - k) - 0.9 * k, 0);
    const chew = seg(t, 0.3, 0.85);
    p.set('jaw', (0.5 * up * (1 - seg(t, 0.28, 0.36))) + Math.max(0, sin(chew * PI * 6)) * 0.22 * (1 - rec), 0, 0);
    return p;
  },

  throw(p, t, base) {
    p.copy(base);
    const wind = ease(seg(t, 0, 0.4));
    const fling = ease(seg(t, 0.4, 0.55));
    const rec = ease(seg(t, 0.65, 1));
    const k = 1 - rec;
    p.add('hips', (-0.35 * wind + 0.5 * fling) * k, 0, 0);
    p.add('spine', 0, (0.5 * wind - 0.9 * fling) * k, 0);
    p.add('chest', 0, (0.3 * wind - 0.5 * fling) * k, 0);
    p.side('upperArm', 'R', ((-1.15) * (1 - wind) - 2.8 * wind + 1.9 * fling) * k, 0, (0.35 + 0.4 * wind - 0.3 * fling) * k);
    p.side('forearm', 'R', (-1.35 * (1 - wind) - 1.2 * wind + 1.3 * fling) * k, 0, 0);
    p.side('upperArm', 'L', -1.0 * k, 0, 0.6 * k);
    return p;
  },

  // ---------------- climbing ----------------
  // Hand/foot targets on a wall plane 3.2 m in front of the root were solved numerically
  // (tools/_solve.mjs): REACH = hand high on the wall, PULL = hand at shoulder height, elbow out.
  // The cycle alternates diagonal pairs, like a real climbing ape.
  climb(p, phase, moving, vdir = 1) {
    climbTorso(p);
    const a = phase * PI * 2;
    // idle grip: one hand high, one at shoulder height (asymmetric reads as "holding on")
    const s = moving > 0.01 ? Math.sin(a) : 0.35;
    const kL = clamp01(0.5 + 0.5 * s * Math.max(moving, 0.6) * vdir);
    const kR = clamp01(0.5 - 0.5 * s * Math.max(moving, 0.6) * vdir);
    armOnWall(p, 'L', kL);
    armOnWall(p, 'R', kR);
    legOnWall(p, 'L', 1 - kR); // diagonal: left foot moves with right hand
    legOnWall(p, 'R', 1 - kL);
    // body heave as limbs pull
    p.add('chest', 0, Math.sin(a) * 0.08 * moving, 0);
    p.add('hips', 0, -Math.sin(a) * 0.06 * moving, Math.sin(a) * 0.04 * moving);
    p.hips[1] += Math.abs(Math.cos(a)) * 0.015 * moving;
    p.add('head', 0, Math.sin(a * 0.5) * 0.1, 0);
    return p;
  },

  // Free arm drives into the facade. aim -1 (low) .. +1 (high) shifts the blow up/down the wall.
  climbPunch(p, t, s, base, aim = 0) {
    p.copy(base);
    const wind = ease(seg(t, 0, 0.32)), strike = ease(seg(t, 0.32, 0.44)), rec = ease(seg(t, 0.62, 1));
    const k = 1 - rec;
    const sg = s === 'L' ? 1 : -1;
    const o = s === 'L' ? 'R' : 'L';
    // cocked: elbow back and up, fist by the ear
    const cx = -2.2, cz = 1.1, cf = -2.0;
    // impact: arm driven forward at the chosen height, fist through the wall surface
    const ix = -1.55 - aim * 0.7, iz = 0.25, iF = -0.35;
    const cur = BI['upperArm' + s] * 3, curF = BI['forearm' + s] * 3;
    const bx = base.r[cur], bz = Math.abs(base.r[cur + 2]), bF = base.r[curF];
    const ux = bx + (cx - bx) * wind + (ix - cx) * strike;
    const uz = bz + (cz - bz) * wind + (iz - cz) * strike;
    const uf = bF + (cf - bF) * wind + (iF - cf) * strike;
    p.side('upperArm', s, bx + (ux - bx) * k, 0, bz + (uz - bz) * k);
    p.side('forearm', s, bF + (uf - bF) * k, 0, 0);
    // shoulders swing into it, the gripping arm braces high
    p.add('chest', 0, sg * (0.35 * wind - 0.6 * strike) * k, 0);
    p.add('spine', -0.12 * wind * k + 0.1 * strike * k, sg * (0.15 * wind - 0.25 * strike) * k, 0);
    armOnWall(p, o, 1);
    p.add('jaw', 0.3 * strike * k, 0, 0);
    return p;
  },

  // Heavy structural smash: one hand grips, the other hammers down through a floor.
  climbSmash(p, t, base) {
    p.copy(base);
    const up = ease(seg(t, 0, 0.42)), down = ease(seg(t, 0.42, 0.56)), rec = ease(seg(t, 0.7, 1));
    const k = 1 - rec;
    armOnWall(p, 'L', 1);
    const ux = -3.0 * up + 1.7 * down, fx = -1.6 * up + 1.3 * down;
    p.side('upperArm', 'R', base.r[BI.upperArmR * 3] * (1 - k) + ux * k - 0.3 * k, 0, 0.5 * k + 0.2);
    p.side('forearm', 'R', fx * k - 0.25, 0, 0);
    p.add('hips', (-0.25 * up + 0.35 * down) * k, 0, 0);
    p.add('spine', (-0.2 * up + 0.3 * down) * k, -0.25 * up * k, 0);
    p.add('chest', (-0.15 * up + 0.25 * down) * k, -0.3 * up * k + 0.2 * down * k, 0);
    p.add('neck', (0.3 * up - 0.3 * down) * k, 0, 0);
    p.add('jaw', 0.45 * up * k, 0, 0);
    return p;
  },

  // Both feet piston into the wall below (smashes the floor under the monster).
  climbKick(p, t, base) {
    p.copy(base);
    const pull = ease(seg(t, 0, 0.35)), kick = ease(seg(t, 0.35, 0.47)), rec = ease(seg(t, 0.62, 1));
    const k = 1 - rec;
    armOnWall(p, 'L', 1); armOnWall(p, 'R', 1);
    const th = -2.2 * pull + 1.5 * kick, sh = 2.0 * pull - 1.9 * kick;
    for (const sd of ['L', 'R']) {
      const i = BI['thigh' + sd] * 3, j = BI['shin' + sd] * 3;
      p.side('thigh', sd, base.r[i] * (1 - k) + th * k, 0, 0.3);
      p.side('shin', sd, base.r[j] * (1 - k) + Math.max(0, sh) * k, 0, 0);
    }
    p.add('hips', -0.3 * pull * k + 0.25 * kick * k, 0, 0);
    p.hips[1] += 0.03 * pull * k;
    return p;
  },

  // Reach the free (right) hand into a window / toward something beside the monster.
  // side: -1 left .. +1 right (in the monster's frame), h: -1 low .. +1 high
  climbGrab(p, t, base, side = 0.5, h = 0) {
    p.copy(base);
    const reach = ease(seg(t, 0, 0.42)), back = ease(seg(t, 0.55, 1));
    const k = reach * (1 - back);
    armOnWall(p, 'L', 1);
    const ux = -1.5 - h * 0.6, uz = 0.4 + Math.max(0, -side) * 0.2, uy = side * 0.6;
    p.side('upperArm', 'R', base.r[BI.upperArmR * 3] * (1 - k) + ux * k, -uy * k, 0.35 * (1 - k) + uz * k);
    p.side('forearm', 'R', -0.2 * k - 1.3 * back, -0.4 * back, 0);
    p.add('chest', 0, -side * 0.35 * k, 0);
    p.add('neck', 0, -side * 0.3 * k, 0);
    p.add('jaw', 0.25 * k, 0, 0);
    return p;
  },

  // Hold a snack to the mouth with one hand while the other grips.
  climbEat(p, t, base) {
    p.copy(base);
    const up = ease(seg(t, 0, 0.28)), rec = ease(seg(t, 0.85, 1));
    const k = up * (1 - rec);
    armOnWall(p, 'L', 1);
    p.side('upperArm', 'R', -0.9 * k + base.r[BI.upperArmR * 3] * (1 - k), -0.3 * k, 0.9 * k + 0.3 * (1 - k));
    p.side('forearm', 'R', -2.3 * k, -0.6 * k, 0);
    p.add('neck', 0.15 * k, 0.25 * k, 0);
    p.add('head', 0.15 * k, 0.2 * k, 0);
    const chew = seg(t, 0.28, 0.85);
    p.set('jaw', 0.5 * up * (1 - seg(t, 0.26, 0.34)) + Math.max(0, Math.sin(chew * PI * 6)) * 0.22 * (1 - rec), 0, 0);
    return p;
  },

  // Twist off the wall and backhand something flying behind the monster (helicopters).
  climbSwat(p, t, s, base, aim = 0) {
    p.copy(base);
    const wind = ease(seg(t, 0, 0.3)), strike = ease(seg(t, 0.3, 0.46)), rec = ease(seg(t, 0.62, 1));
    const k = 1 - rec;
    const sg = s === 'L' ? 1 : -1;
    const o = s === 'L' ? 'R' : 'L';
    armOnWall(p, o, 1);
    // body rotates out from the wall toward the target side
    p.add('spine', -0.15 * k, sg * (0.6 * wind + 0.5 * strike) * k, 0);
    p.add('chest', -0.1 * k, sg * (0.5 * wind + 0.4 * strike) * k, 0);
    p.add('neck', -0.2 * k, sg * 0.4 * k, 0);
    p.add('hips', 0, sg * 0.25 * k, 0);
    const ux = -1.2 - aim * 0.9;
    p.side('upperArm', s, (-2.0 * wind + (ux + 2.0) * strike) * k + base.r[BI['upperArm' + s] * 3] * (1 - k), 0, (1.4 * wind + 0.2 * strike) * k + 0.3);
    p.side('forearm', s, (-1.6 * wind + 1.5 * strike) * k - 0.1, 0, 0);
    p.add('jaw', 0.4 * strike * k, 0, 0);
    return p;
  },

  // Roar from the side of a tower: one arm grips, the other beats the chest.
  climbRoar(p, t, base) {
    p.copy(base);
    const rise = ease(seg(t, 0, 0.15)), rec = ease(seg(t, 0.85, 1));
    const k = rise * (1 - rec);
    armOnWall(p, 'L', 1);
    const b = Math.max(0, Math.sin(seg(t, 0.2, 0.8) * PI * 10)) * k;
    p.side('upperArm', 'R', 0.3 * k + base.r[BI.upperArmR * 3] * (1 - k) - 0.25 * b, -1.3 * k + 0.35 * b, 0.6 * k + 0.3 * (1 - k) + 0.25 * b);
    p.side('forearm', 'R', -2.2 * k + 0.35 * b, 0, 0);
    p.add('neck', -0.45 * k, -0.4 * k, 0);
    p.add('head', -0.35 * k, -0.2 * k, 0);
    p.add('spine', -0.15 * k, -0.3 * k, 0);
    p.set('jaw', 0.6 * ease(seg(t, 0.1, 0.22)) * (1 - ease(seg(t, 0.75, 0.9))), 0, 0);
    return p;
  },

  // Hauling over a roof edge: k 0 (hanging) .. 1 (crouched on the roof).
  mantle(p, k) {
    climbTorso(p);
    armOnWall(p, 'L', 1); armOnWall(p, 'R', 1);
    legOnWall(p, 'L', 0.5); legOnWall(p, 'R', 0.5);
    const top = new Pose();
    stance(top, 0.9, 0.5);
    top.sym('upperArm', -0.7, 0, 0.3);
    top.sym('forearm', -0.1, 0, 0);
    top.sym('thigh', -1.7, 0, 0.15);
    top.sym('shin', 1.7, 0, 0);
    p.lerp(top, ease(k));
    return p;
  },

  hit(p, t, base) {
    p.copy(base);
    const k = sin(clamp01(t) * PI);
    p.add('hips', -0.25 * k, 0, 0.08 * k);
    p.add('chest', -0.2 * k, 0.15 * k, 0);
    p.add('neck', 0.25 * k, 0, 0);
    p.add('jaw', 0.3 * k, 0, 0);
    return p;
  },

  // Stagger, knees buckle, one arm reaches out, then he crashes forward onto his chest.
  death(p, t) {
    const stag = ease(seg(t, 0, 0.7));
    const fall = ease(seg(t, 0.55, 1.45));
    const settle = ease(seg(t, 1.45, 2.4));
    stance(p.clear(), 0.62, 0.25 + 0.45 * stag);
    // stagger: sway, head lolls
    p.add('hips', -0.25 * stag * (1 - fall), 0.2 * stag, 0.18 * stag * (1 - fall));
    p.add('neck', 0.35 * stag, 0.3 * stag, 0);
    p.add('jaw', 0.45 * stag, 0, 0);
    // collapse forward
    p.add('hips', 0.95 * fall, 0, 0.12 * fall);
    p.add('spine', 0.2 * fall, 0, 0);
    p.add('neck', -0.6 * fall + 0.2 * settle, -0.5 * fall, 0.2 * fall);
    p.side('upperArm', 'L', -1.8 * fall - 0.6 * (1 - fall) * stag, 0, 0.7 * fall + 0.2);
    p.side('forearm', 'L', -0.2 * fall, 0, 0);
    p.side('upperArm', 'R', -0.4 - 0.9 * fall, 0, 1.1 * fall);
    p.side('forearm', 'R', -0.9 * fall, 0, 0);
    p.sym('thigh', -1.3 * fall - 0.4, 0, 0.25 * fall);
    p.sym('shin', 1.5 * fall + 0.4, 0, 0);
    p.hips[1] = -0.05 - 0.12 * stag - 0.48 * fall - 0.04 * settle;
    p.hips[2] = 0.25 * fall;
    return p;
  },
};

// Applies a Pose to bones.
export function applyPose(bones, pose, restPositions) {
  for (let i = 0; i < NB; i++) {
    const name = BONE_NAMES[i];
    const b = bones[name];
    _e.set(pose.r[i * 3], pose.r[i * 3 + 1], pose.r[i * 3 + 2], 'XYZ');
    b.quaternion.setFromEuler(_e);
  }
  const hp = restPositions.hips;
  bones.hips.position.set(hp[0] + pose.hips[0], hp[1] + pose.hips[1], hp[2] + pose.hips[2]);
}

export { BI };
