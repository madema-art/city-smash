import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

// Objects thrown by the monster. They fly as rigid bodies and deliver a heavy hit to the
// first building, helicopter or street surface they strike; vehicles explode on impact.
export class Projectiles {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = [];
    this.wrecks = [];
  }

  launch(held, pos, vel) {
    const ctx = this.ctx;
    const h = held.half;
    const q = held.mesh.quaternion.clone();
    const body = ctx.physics.dynamicBox(pos, q, h.x, h.y, h.z, {
      density: 0.6, linvel: vel, ccd: true,
      angvel: { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 6 },
      friction: 0.6, restitution: 0.1, linearDamping: 0.0, angularDamping: 0.1,
    });
    if (!held.mesh.parent) ctx.root.add(held.mesh);
    this.items.push({ held, body, age: 0, impacted: false, opts: held.projectile || {} });
  }

  update(dt) {
    const ctx = this.ctx;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const t = it.body.translation(), r = it.body.rotation();
      const off = it.opts.centerOffset || 0;
      _q.set(r.x, r.y, r.z, r.w);
      _p.set(0, off, 0).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
      it.held.mesh.position.copy(_p);
      it.held.mesh.quaternion.copy(_q);
      if (!it.impacted) {
        const lv = it.body.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        const dir = new THREE.Vector3(lv.x, lv.y, lv.z).normalize();
        const pos = new THREE.Vector3(t.x, t.y, t.z);
        let hit = null;
        // look slightly ahead so fast objects connect with facades
        for (let k = 0; k <= 2; k++) {
          const probe = pos.clone().addScaledVector(dir, k * 1.6);
          if (ctx.city.solidAt(probe.x, probe.y, probe.z)) { hit = probe; break; }
        }
        if (!hit && ctx.military && ctx.military.hitAir(pos, 9, dir)) hit = pos;
        if (!hit && t.y < 1.6 && it.age > 0.15 && speed > 8) hit = pos;
        if (hit) {
          it.impacted = true;
          const power = it.opts.power || 1.2;
          ctx.combat.strike(hit, 6.5, power, dir, 'thrown');
          if (it.opts.explode) {
            ctx.fx.explosion(hit, 1.1);
            ctx.events.emit('explosion', { x: hit.x, y: hit.y, z: hit.z, power: 1.2 });
            if (hit.y < 2) ctx.city.scar(hit.x, hit.z, 6, 0.9, 0.3, 0);
            it.burn = 10;
            it.held.mesh.traverse((o) => { if (o.material && o.material.color) o.material.color.multiplyScalar(0.2); });
          }
          if (it.held.kind === 'person' || it.held.kind === 'soldier') {
            ctx.root.remove(it.held.mesh);
            ctx.physics.removeBody(it.body);
            this.items.splice(i, 1);
            ctx.stats.civilians++;
            continue;
          }
          it.body.setLinvel({ x: lv.x * 0.25, y: Math.max(2, lv.y * 0.2), z: lv.z * 0.25 }, true);
        }
      }
      if (it.burn > 0) {
        it.burn -= dt;
        if (Math.random() < 0.4) ctx.fx.smoke(t.x, t.y + 1.5, t.z, 2.5, 0.12, 4, 3);
        if (Math.random() < 0.5) ctx.fx.fire(t.x, t.y + 0.8, t.z, 1.7);
      }
      if ((it.impacted && it.age > 3 && it.body.isSleeping()) || it.age > 14 || t.y < -10) {
        ctx.physics.removeBody(it.body);
        this.items.splice(i, 1);
        this.wrecks.push(it.held.mesh);
        if (this.wrecks.length > 30) {
          const old = this.wrecks.shift();
          ctx.root.remove(old);
        }
      }
    }
  }
}
