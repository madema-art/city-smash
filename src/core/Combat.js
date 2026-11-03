import * as THREE from 'three';

const _v = new THREE.Vector3();

// Routes monster attacks to every system that can be hurt, and centralises "game feel"
// (hit-stop, shake, scars) so all attacks share one consistent sense of impact.
export class Combat {
  constructor(ctx) {
    this.ctx = ctx;
  }

  strike(p, radius, amount, dir, kind) {
    const ctx = this.ctx;
    const res = ctx.city.damageSphere(p, radius, amount, dir, { kind });
    let hitSomething = res.destroyed + res.damaged > 0;
    const k = { punch: 1, smash: 1.6, charge: 1.3, thrown: 1.4 }[kind] || 1;
    // enemies / vehicles / people near the fist
    const hits = ctx.military ? ctx.military.hit(p, radius + 2.5, dir, amount * k, kind) : 0;
    const cars = ctx.traffic ? ctx.traffic.hit(p, radius + 1.5, dir, amount * k) : 0;
    const people = ctx.crowd ? ctx.crowd.hit(p, radius + 1, dir, amount * k) : 0;
    ctx.props.impulse(p.x, p.z, p.y < 10 ? radius + 1 : 0, 10 * k);
    hitSomething = hitSomething || hits + cars + people > 0;
    if (hitSomething) {
      const big = res.destroyed > 0 || hits > 0;
      ctx.hitStop(kind === 'smash' ? 0.09 : big ? 0.065 : 0.04);
      ctx.fx.addShake(kind === 'smash' ? 1.1 : big ? 0.55 : 0.3);
      ctx.events.emit('impact', { x: p.x, y: p.y, z: p.z, power: amount * k * (big ? 1.2 : 0.8), kind: res.destroyed + res.damaged > 0 ? 'concrete' : 'metal', glass: res.glass, destroyed: res.destroyed });
      if (res.destroyed + res.damaged > 0) {
        ctx.fx.sparks(p, _v.copy(dir).negate(), 6, [1, 0.9, 0.7]);
        ctx.fx.impactDust(p, _v.copy(dir).negate(), Math.min(1.4, 0.6 + res.destroyed * 0.08));
      }
    }
    if (ctx.crowd) ctx.crowd.alarm(p, 70);
    return { ...res, hitSomething };
  }

  // Radial shockwave on the ground (stomp, slam, heavy landing).
  groundShock(p, radius, power, kind) {
    const ctx = this.ctx;
    const g = new THREE.Vector3(p.x, Math.max(1, p.y) + 1.5, p.z);
    // only the base of nearby buildings takes damage
    ctx.city.damageSphere(g, radius * 0.45, 0.75 * power, new THREE.Vector3(0, -1, 0), { kind });
    if (ctx.military) ctx.military.shock(p, radius, power);
    if (ctx.traffic) ctx.traffic.shock(p, radius, power);
    if (ctx.crowd) { ctx.crowd.shock(p, radius * 0.7, power); ctx.crowd.alarm(p, 90); }
    ctx.props.impulse(p.x, p.z, radius * 0.75, 12 * power);
    ctx.fx.ring(p.x, p.y, p.z, 2, radius * 1.25, 0.7);
    ctx.fx.collapseDust(p.x, p.y + 1, p.z, radius * 0.4, 0.6 * power);
    ctx.fx.chipBurst(new THREE.Vector3(p.x, p.y + 0.5, p.z), new THREE.Vector3(0, 1, 0), new THREE.Color(0.32, 0.31, 0.3), 14, 12 * power, 1);
    ctx.fx.addShake(0.9 * power);
    ctx.hitStop(0.07);
    if (p.y < 1) ctx.city.scar(p.x, p.z, radius * 0.5, 0, 0.9 * power, 0.3);
    ctx.events.emit('shock', { x: p.x, y: p.y, z: p.z, power, kind });
  }

  roar(p) {
    const ctx = this.ctx;
    if (ctx.crowd) ctx.crowd.alarm(p, 220, true);
    if (ctx.military) ctx.military.suppress(p, 90, 2.5);
    ctx.fx.addShake(0.6);
    ctx.fx.ring(p.x, p.y + 8, p.z, 4, 60, 1.2, 0xffffff);
  }

  findGrabbable(reach, from, fwd) {
    const ctx = this.ctx;
    const cands = [];
    if (ctx.crowd) cands.push(...ctx.crowd.grabCandidates(reach, 10));
    if (ctx.military) cands.push(...ctx.military.grabCandidates(reach, 10));
    if (ctx.traffic) cands.push(...ctx.traffic.grabCandidates(reach, 10));
    if (!cands.length) return null;
    // prefer things in front, then close; people first since they heal
    let best = null, bestScore = 1e9;
    for (const c of cands) {
      _v.copy(c.pos).sub(from);
      _v.y = 0;
      const d = _v.length();
      const facing = d > 0.1 ? (_v.x * fwd.x + _v.z * fwd.z) / d : 1;
      if (facing < -0.2) continue;
      const score = c.pos.distanceTo(reach) - facing * 3 - (c.edible ? 2.5 : 0);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best ? best.take() : null;
  }
}
