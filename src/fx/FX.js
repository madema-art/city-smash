import * as THREE from 'three';
import { ParticleSystem } from './Particles.js';
import { BallisticPieces, makeShardGeometry, makeRockGeometry } from './Ballistic.js';
import { DESTRUCTION, WORLD } from '../config.js';
import { patchCityLight } from '../render/CityLights.js';

const _c = new THREE.Color();
const R = Math.random;

// High-level effect helpers. Everything visual that is not a rigid body lives here.
export class FX {
  constructor(scene, envMap) {
    this.dust = new ParticleSystem(scene, 5000, false);
    this.glow = new ParticleSystem(scene, 2500, true);

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9cc6e8, metalness: 0.95, roughness: 0.04, side: THREE.DoubleSide, envMap, envMapIntensity: 1.6,
      emissive: 0x0d1820, emissiveIntensity: 0.2,
    });
    this.glass = new BallisticPieces(scene, makeShardGeometry(), glassMat, DESTRUCTION.maxGlass, { groundLinger: 4, bounce: 0.15 });

    const chipMat = patchCityLight(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), { key: 'chips' });
    this.chips = new BallisticPieces(scene, makeRockGeometry(0, 11), chipMat, DESTRUCTION.maxChips, { groundLinger: 6, bounce: 0.3, castShadow: true });

    // Shock rings for stomps and slams.
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48, 1).rotateX(-Math.PI / 2);
    this.scene = scene;

    // Dynamic point lights for explosions (small fixed pool to keep shader permutations stable).
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 60, 2);
      l.userData.life = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.shake = 0;
  }

  setFloor(fn) { this.glass.floorFn = fn; this.chips.floorFn = fn; }

  update(dt, fog) {
    this.dust.update(dt, fog);
    this.glow.update(dt, fog);
    this.glass.update(dt, WORLD.gravity * 0.8);
    this.chips.update(dt, WORLD.gravity);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.userData.t += dt;
      const t = r.userData.t / r.userData.life;
      r.scale.setScalar(r.userData.r0 + (r.userData.r1 - r.userData.r0) * (1 - (1 - t) * (1 - t)));
      r.material.opacity = 0.55 * (1 - t);
      if (t >= 1) { this.scene.remove(r); r.material.dispose(); this.rings.splice(i, 1); }
    }
    for (const l of this.lights) {
      if (l.userData.life > 0) {
        l.userData.life -= dt;
        l.intensity = Math.max(0, l.userData.peak * (l.userData.life / l.userData.max));
      } else l.intensity = 0;
    }
  }

  flashLight(pos, peak = 4000, life = 0.35, color = 0xff8a3a) {
    let l = this.lights.find((x) => x.userData.life <= 0) || this.lights[0];
    l.position.copy(pos);
    l.color.set(color);
    l.userData.life = life; l.userData.max = life; l.userData.peak = peak;
    l.intensity = peak;
  }

  // Concrete dust puff from an impact on a wall.
  impactDust(p, n, scale = 1, color = null) {
    const c = color || _c.setRGB(0.46, 0.41, 0.35);
    const count = Math.round(5 * scale);
    for (let i = 0; i < count; i++) {
      const s = (2.2 + R() * 3) * scale;
      this.dust.emit(
        p.x + (R() - 0.5) * 3 * scale, p.y + (R() - 0.5) * 3 * scale, p.z + (R() - 0.5) * 3 * scale,
        (n.x * 6 + (R() - 0.5) * 8) * scale, (n.y * 6 + (R() - 0.2) * 5) * scale, (n.z * 6 + (R() - 0.5) * 8) * scale,
        s, 1.8 + R() * 2.2, c.r * (0.9 + R() * 0.2), c.g * (0.9 + R() * 0.2), c.b * (0.9 + R() * 0.2), 0.32,
        { grow: 1.4, drag: 1.6, gravity: -0.8 },
      );
    }
  }

  // Billowing ground-hugging dust rolling outward from a collapse.
  collapseDust(x, y, z, radius, strength = 1, color = null) {
    const c = color || _c.setRGB(0.5, 0.45, 0.38);
    const count = Math.round(7 * strength);
    for (let i = 0; i < count; i++) {
      const a = R() * Math.PI * 2;
      const r = radius * Math.sqrt(R());
      const sp = 6 + R() * 12;
      const s = 5 + R() * 7;
      this.dust.emit(
        x + Math.cos(a) * r, Math.max(1.5, y + (R() - 0.3) * 4), z + Math.sin(a) * r,
        Math.cos(a) * sp, 1 + R() * 3.5, Math.sin(a) * sp,
        s, 4 + R() * 4, c.r * (0.85 + R() * 0.2), c.g * (0.85 + R() * 0.2), c.b * (0.85 + R() * 0.2), 0.34,
        { grow: 2.4, drag: 0.55, gravity: 0.25, fadeIn: 0.4 },
      );
    }
  }

  smoke(x, y, z, size = 4, dark = 0.18, life = 5, vy = 4) {
    const g = dark + R() * 0.06;
    this.dust.emit(x, y, z, (R() - 0.5) * 2, vy + R() * 2, (R() - 0.5) * 2, size, life, g, g * 0.97, g * 0.95, 0.55,
      { grow: 2.2, drag: 0.4, gravity: 0.5, fadeIn: 0.3 });
  }

  fire(x, y, z, size = 3) {
    this.glow.emit(x + (R() - 0.5), y, z + (R() - 0.5), (R() - 0.5) * 2, 4 + R() * 4, (R() - 0.5) * 2, size, 0.5 + R() * 0.4,
      1.0, 0.45 + R() * 0.2, 0.12, 0.9, { grow: 0.4, drag: 1.0, colorShift: 0.6 });
  }

  explosion(p, scale = 1) {
    // fireball
    for (let i = 0; i < 26 * scale; i++) {
      const a = R() * 6.283, e = R() * 1.4 - 0.2, sp = (6 + R() * 16) * scale;
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 4, Math.sin(a) * Math.cos(e) * sp,
        (3 + R() * 4) * scale, 0.5 + R() * 0.6, 1.0, 0.55 + R() * 0.25, 0.18, 1.0, { grow: 1.0, drag: 3.0, colorShift: 0.5 });
    }
    // core flash
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 14 * scale, 0.18, 1, 0.9, 0.7, 1, { grow: 1.5, drag: 0 });
    // sparks
    for (let i = 0; i < 24 * scale; i++) {
      const a = R() * 6.283, e = R() * 1.5, sp = 20 + R() * 30;
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp,
        0.5 + R() * 0.5, 0.6 + R() * 0.8, 1, 0.7, 0.3, 1, { grow: -0.3, drag: 1.2, gravity: -25 });
    }
    // smoke
    for (let i = 0; i < 18 * scale; i++) {
      const a = R() * 6.283, sp = (2 + R() * 8) * scale;
      const g = 0.12 + R() * 0.1;
      this.dust.emit(p.x + (R() - 0.5) * 3, p.y + R() * 3, p.z + (R() - 0.5) * 3, Math.cos(a) * sp, 3 + R() * 6, Math.sin(a) * sp,
        (4 + R() * 5) * scale, 3 + R() * 4, g, g * 0.95, g * 0.9, 0.7, { grow: 1.8, drag: 0.9, gravity: 1.2, fadeIn: 0.25 });
    }
    this.flashLight(p, 6000 * scale, 0.45);
  }

  sparks(p, dir, count = 8, color = [1, 0.8, 0.4]) {
    for (let i = 0; i < count; i++) {
      const sp = 10 + R() * 20;
      this.glow.emit(p.x, p.y, p.z, dir.x * sp + (R() - 0.5) * 12, dir.y * sp + R() * 8, dir.z * sp + (R() - 0.5) * 12,
        0.35 + R() * 0.35, 0.25 + R() * 0.35, color[0], color[1], color[2], 1, { grow: -0.5, drag: 2, gravity: -20 });
    }
  }

  muzzle(p, size = 1) {
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, size, 0.06, 1, 0.85, 0.5, 1, { grow: 0.5, drag: 0 });
  }

  glassBurst(p, n, count = 14, spread = 3) {
    for (let i = 0; i < count; i++) {
      const sp = 3 + R() * 9;
      const s = 0.35 + R() * 0.9;
      this.glass.spawn(
        p.x + (R() - 0.5) * spread, p.y + (R() - 0.5) * spread, p.z + (R() - 0.5) * spread,
        n.x * sp + (R() - 0.5) * 6, n.y * sp + R() * 4, n.z * sp + (R() - 0.5) * 6,
        s, s * (0.6 + R() * 0.8), 1, _c.setRGB(0.8 + R() * 0.2, 0.9, 1.0),
      );
    }
  }

  chipBurst(p, n, color, count = 10, speed = 10, size = 1) {
    for (let i = 0; i < count; i++) {
      const sp = speed * (0.4 + R());
      const s = (0.35 + R() * 0.9) * size;
      const v = 0.85 + R() * 0.3;
      this.chips.spawn(
        p.x + (R() - 0.5) * 2, p.y + (R() - 0.5) * 2, p.z + (R() - 0.5) * 2,
        n.x * sp + (R() - 0.5) * 9, n.y * sp + R() * 7, n.z * sp + (R() - 0.5) * 9,
        s, s * 0.7, s, _c.setRGB(color.r * v, color.g * v, color.b * v),
      );
    }
  }

  ring(x, y, z, r0, r1, life = 0.6, color = 0xd8cbb5) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
    m.position.set(x, y + 0.3, z);
    m.userData = { t: 0, life, r0, r1 };
    m.renderOrder = 9;
    m.userData.noAO = true;
    this.scene.add(m);
    this.rings.push(m);
  }

  addShake(amount) { this.shake = Math.min(3.5, this.shake + amount); }

  clear() {
    this.dust.clear(); this.glow.clear(); this.glass.clear(); this.chips.clear();
    for (const r of this.rings) { this.scene.remove(r); r.material.dispose(); }
    this.rings.length = 0;
    this.shake = 0;
  }
}
