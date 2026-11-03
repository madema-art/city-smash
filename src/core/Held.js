import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _o = new THREE.Vector3();

// Something the monster is carrying in its right hand.
// Systems that offer grabbable objects build one of these around a standalone mesh.
export class Held {
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.kind = opts.kind;
    this.mesh = opts.mesh;
    this.edible = !!opts.edible;
    this.heal = opts.heal || 0;
    this.heavy = !!opts.heavy;
    this.offset = opts.offset || new THREE.Vector3(0, -1.2, 1.0);
    this.localRot = opts.localRot || new THREE.Quaternion();
    this.half = opts.half || new THREE.Vector3(1, 1, 1);
    this.onConsume = opts.onConsume;
    this.onRelease = opts.onRelease;
    this.projectile = opts.projectile || {};
  }

  attach(gorilla) {
    this.gorilla = gorilla;
    this.mesh.matrixAutoUpdate = true;
    this.ctx.root.add(this.mesh);
    gorilla.heldFollow = this;
  }

  follow(gorilla) {
    const hb = gorilla.model.bones.handR;
    hb.matrixWorld.decompose(_p, _q, _s);
    _o.copy(this.offset).applyQuaternion(_q);
    this.mesh.position.copy(_p).add(_o);
    this.mesh.quaternion.copy(_q).multiply(this.localRot);
  }

  consume() {
    this.ctx.root.remove(this.mesh);
    if (this.gorilla) this.gorilla.heldFollow = null;
    if (this.onConsume) this.onConsume();
  }

  release(pos, vel) {
    if (this.gorilla) this.gorilla.heldFollow = null;
    if (this.onRelease) this.onRelease(pos, vel);
    else this.ctx.projectiles.launch(this, pos, vel);
  }
}
