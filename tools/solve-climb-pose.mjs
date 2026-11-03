// Numerically solves the gorilla climbing grip poses (hands/feet planted on a wall plane).
// Results are pasted into ARM_*/LEG_* in src/monster/GorillaAnimator.js. Run: node tools/solve-climb-pose.mjs
import * as THREE from 'three';
import { createSkeleton } from '../src/monster/GorillaModel.js';
import { Pose, applyPose } from '../src/monster/GorillaAnimator.js';
const S = 9.2;
const { bones, rest } = createSkeleton();
const v = new THREE.Vector3();
function torso(p) {
  p.clear();
  p.set('hips', 0.32, 0, 0); p.set('spine', 0.12, 0, 0); p.set('chest', 0.05, 0, 0);
  p.set('neck', -0.55, 0, 0); p.set('head', -0.25, 0, 0);
  p.hips[1] = -0.02; p.hips[2] = 0.05;
}
function solve(limb, target, init) {
  const names = limb === 'arm' ? ['upperArmL', 'upperArmL', 'upperArmL', 'forearmL'] : ['thighL', 'thighL', 'shinL', 'footL'];
  const comps = limb === 'arm' ? [0, 1, 2, 0] : [0, 2, 0, 0];
  const end = limb === 'arm' ? 'handL' : 'footL';
  const x = init.slice();
  const p = new Pose();
  const err = () => {
    torso(p);
    const vals = {};
    names.forEach((n, i) => { vals[n] = vals[n] || [0, 0, 0]; vals[n][comps[i]] = x[i]; });
    for (const n in vals) p.set(n, ...vals[n]);
    if (limb === 'leg') p.set('footL', x[3], 0, 0);
    applyPose(bones, p, rest); bones.root.updateMatrixWorld(true);
    v.setFromMatrixPosition(bones[end].matrixWorld).multiplyScalar(S);
    let e = v.distanceTo(target);
    // prefer natural joints: elbow/knee bend in the anatomical direction
    if (limb === 'arm' && x[3] > 0.05) e += x[3] * 3;
    if (limb === 'arm' && x[3] < -1.9) e += (-1.9 - x[3]) * 3;
    if (limb === 'arm' && x[0] > -0.9) e += (x[0] + 0.9) * 2;
    if (limb === 'leg' && x[2] < -0.05) e += -x[2] * 3;
    return e;
  };
  let best = err();
  for (let step = 0.4; step > 0.005; step *= 0.6) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < x.length; i++) for (const d of [step, -step]) {
        x[i] += d; const e = err();
        if (e < best - 1e-5) { best = e; improved = true; } else x[i] -= d;
      }
    }
  }
  return { x: x.map((a) => +a.toFixed(3)), err: +best.toFixed(2) };
}
const W = 3.2; // wall plane, metres in front of the gorilla's root
const T = {
  handHigh: new THREE.Vector3(4.2, 17.5, W), handLow: new THREE.Vector3(5.2, 14.0, W),
  footHigh: new THREE.Vector3(3.2, 5.0, W - 0.3), footLow: new THREE.Vector3(3.0, 1.2, W - 0.3),
};
console.log('handHigh', JSON.stringify(solve('arm', T.handHigh, [-2.6, 0, 0.3, -0.3])));
console.log('handLow', JSON.stringify(solve('arm', T.handLow, [-1.6, 0, 0.7, -1.2])));
console.log('footHigh', JSON.stringify(solve('leg', T.footHigh, [-1.6, 0.25, 1.4, -0.4])));
console.log('footLow', JSON.stringify(solve('leg', T.footLow, [-0.9, 0.2, 0.9, -0.3])));
