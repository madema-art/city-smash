import RAPIER from '@dimforge/rapier3d-compat';
import { WORLD } from '../config.js';

let ready = null;
export function initRapier() {
  if (!ready) ready = RAPIER.init();
  return ready;
}
export { RAPIER };

// Thin wrapper over a Rapier world. Rigid bodies are used selectively: debris chunks,
// knocked vehicles and props, wrecks, thrown objects. Buildings contribute fixed colliders
// only for their exposed cells, so the broadphase stays small.
export class Physics {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: WORLD.gravity, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 2;
    this.accum = 0;
    // Ground slab.
    const ground = RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(0.9);
    this.world.createCollider(ground);
  }

  step(dt) {
    // Fixed step, at most 2 sub-steps per frame so a hitch never spirals.
    this.accum = Math.min(this.accum + dt, 1 / 30);
    let n = 0;
    while (this.accum >= 1 / 60 && n < 2) {
      this.world.step();
      this.accum -= 1 / 60;
      n++;
    }
  }

  fixedBox(x, y, z, hx, hy, hz) {
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.8),
    );
  }

  removeCollider(c) {
    if (c) this.world.removeCollider(c, false);
  }

  dynamicBox(pos, quat, hx, hy, hz, { density = 1, linvel, angvel, friction = 0.7, restitution = 0.1, ccd = false, linearDamping = 0.05, angularDamping = 0.3 } = {}) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setCcdEnabled(ccd);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(density).setFriction(friction).setRestitution(restitution);
    this.world.createCollider(col, body);
    if (linvel) body.setLinvel(linvel, true);
    if (angvel) body.setAngvel(angvel, true);
    return body;
  }

  kinematicCapsule(halfHeight, radius, pos) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
    );
    this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
    return body;
  }

  removeBody(b) {
    if (b) this.world.removeRigidBody(b);
  }

  dispose() {
    this.world.free();
  }
}
