import * as THREE from 'three';

// Persistent localized fires: electrical fires in wrecked floors, burning rubble after collapses.
// Each fire emits flame + smoke particles and stamps a flickering orange pool into the city light
// field; the few fires closest to the camera also drive real point lights. Bounded in number.
export class Fires {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.max = 26;
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 45, 2);
      ctx.root.add(l);
      this.lights.push(l);
    }
  }

  start(x, y, z, life = 40, size = 1) {
    // merge with a fire that is already burning close by
    for (const f of this.list) if (Math.hypot(f.x - x, f.y - y, f.z - z) < 6) { f.life = Math.max(f.life, life); f.size = Math.min(2, f.size + 0.2); return f; }
    if (this.list.length >= this.max) this.list.shift();
    const f = { x, y, z, life, size, t: Math.random() * 10 };
    this.list.push(f);
    return f;
  }

  update(dt, camPos) {
    const fx = this.ctx.fx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.life -= dt;
      f.t += dt;
      if (f.life <= 0) { this.list.splice(i, 1); continue; }
      const k = Math.min(1, f.life / 8) * f.size;
      if (Math.random() < 0.7 * k) fx.fire(f.x + (Math.random() - 0.5) * 2 * f.size, f.y, f.z + (Math.random() - 0.5) * 2 * f.size, 1.8 + 1.4 * k);
      if (Math.random() < 0.3 * k) fx.smoke(f.x, f.y + 2, f.z, 3 + 2 * k, 0.05, 7, 4 + 2 * k);
      const fl = 0.75 + 0.25 * Math.sin(f.t * 17) * Math.sin(f.t * 7.3);
      if (f.y < 24) this.ctx.lights.pulse(f.x, f.z, 1.0 * k * fl, 0.42 * k * fl, 0.12 * k * fl, 11 + 5 * k);
    }
    // real lights for the nearest few
    const near = [...this.list].sort((a, b) => (a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2 - ((b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2));
    this.lights.forEach((l, i) => {
      const f = near[i];
      if (!f) { l.intensity = 0; return; }
      l.position.set(f.x, f.y + 2, f.z);
      l.intensity = 900 * Math.min(1, f.life / 8) * f.size * (0.75 + 0.25 * Math.sin(f.t * 19) * Math.sin(f.t * 5.1));
    });
  }

  clear() { this.list.length = 0; for (const l of this.lights) l.intensity = 0; }
}
