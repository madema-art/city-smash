import * as THREE from 'three';
import { clamp, damp, dampAngle } from './util.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

// Third-person orbit camera with obstruction handling, climbing framing, FOV kicks and shake.
export class CameraRig {
  constructor(camera, ctx) {
    this.camera = camera;
    this.ctx = ctx;
    this.yaw = Math.PI; // looking toward -Z
    this.pitch = -0.16;
    this.dist = 36;
    this.curDist = 36;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.fov = 60;
    this.shakeT = 0;
    this.kick = 0;
    this.lookDir = new THREE.Vector3(0, 0, -1);
    this.first = true;
  }

  get forward() { return _d.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)); }

  update(dt, input, g) {
    const sens = input.sensitivity;
    this.yaw -= input.lookDX * sens;
    this.pitch = clamp(this.pitch - input.lookDY * sens, -0.95, 0.6);
    // Controller comfort: R3 snaps behind the monster; while running with no right-stick
    // input the camera drifts in behind the direction of travel.
    const padUser = input.lastDevice === 'pad';
    if (input.hit && input.hit('recenter')) { this.recenter = 0.35; }
    if (this.recenter > 0) {
      this.recenter -= dt;
      this.yaw = dampAngle(this.yaw, g.yaw, 14, dt);
      this.pitch = damp(this.pitch, -0.16, 10, dt);
    }
    this.idleLook = Math.abs(input.lookDX) + Math.abs(input.lookDY) > 0.01 ? 0 : (this.idleLook || 0) + dt;
    if (padUser && this.idleLook > 0.8 && g.speed > 4 && g.state === 'ground' && !g.action) {
      const k = Math.min(1, (g.speed - 4) / 12) * 1.2;
      this.yaw = dampAngle(this.yaw, g.yaw, k, dt);
    }

    const climbing = g.state === 'climb';
    const airborne = g.state === 'air';
    const sprint = g.speed > 14;
    // framing
    let want = 34;
    if (sprint) want = 40;
    if (climbing) want = 46;
    if (g.action && g.action.name === 'smash') want = 30;
    if (g.state === 'dead') want = 48;
    this.dist = damp(this.dist, want, 3, dt);
    // look target: chest, raised while climbing and leading jumps
    const tgt = _v.set(g.pos.x, g.pos.y + (climbing ? 12 : 11), g.pos.z);
    if (airborne) tgt.y += clamp(g.vel.y * 0.15, -2, 3);
    if (this.first) { this.smoothTarget.copy(tgt); this.first = false; }
    this.smoothTarget.x = damp(this.smoothTarget.x, tgt.x, 12, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, tgt.z, 12, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, tgt.y, airborne ? 5 : 9, dt);
    if (climbing && g.climb) {
      // swing the camera out from the wall so the monster and facade are both visible
      const wallYaw = Math.atan2(g.climb.nx, g.climb.nz) + Math.PI;
      if (input.lookDX === 0) this.yaw = dampAngle(this.yaw, wallYaw, 1.2, dt);
      this.pitch = damp(this.pitch, Math.max(this.pitch, 0.05), 2, dt);
    }
    const dir = this.forward; // camera looks along dir
    // shoulder offset to the right so the crosshair isn't hidden by the monster
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulder = climbing ? 0 : 5;
    const pivot = this.smoothTarget.clone().addScaledVector(right, shoulder);
    // obstruction: pull in (partially) when a building blocks the view; the facade shader
    // dithers away anything still in between.
    const back = dir.clone().negate();
    let dist = this.dist;
    const hit = this.ctx.city.raycast(pivot, back, dist, 1.5);
    if (hit > 0) dist = Math.max(16, hit - 2);
    this.curDist = dist < this.curDist ? damp(this.curDist, dist, 14, dt) : damp(this.curDist, dist, 2.5, dt);
    const pos = pivot.clone().addScaledVector(back, this.curDist);
    // never under the street / rubble
    const floor = this.ctx.city.groundAt(pos.x, pos.z, pos.y + 2) + 1.5;
    if (pos.y < floor) pos.y = floor;
    // shake
    const fx = this.ctx.fx;
    this.shakeT += dt;
    const sh = fx.shake;
    if (sh > 0.001) {
      const t = this.shakeT * 38;
      pos.x += (Math.sin(t * 1.3) + Math.sin(t * 2.9)) * sh * 0.35;
      pos.y += (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1)) * sh * 0.35;
      pos.z += (Math.sin(t * 1.1 + 2) + Math.sin(t * 2.3)) * sh * 0.35;
    }
    fx.shake = Math.max(0, fx.shake - dt * (1.8 + fx.shake * 2.5));
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().add(dir));
    // FOV: wider when sprinting, punch-in kick on big hits
    this.kick = Math.max(0, this.kick - dt * 6);
    const wantFov = (sprint ? 68 : 60) + (climbing ? 4 : 0) - this.kick * 4;
    this.fov = damp(this.fov, wantFov, 5, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.lookDir.copy(dir);
  }

  // Point in the world the crosshair is over (for throwing).
  aimPoint(maxDist = 200) {
    const o = this.camera.position.clone();
    const d = this.lookDir.clone();
    const hit = this.ctx.city.raycast(o, d, maxDist, 1.5);
    const g = this.ctx.gorilla;
    // also consider helicopters near the aim ray
    const mil = this.ctx.military;
    if (mil) {
      for (const h of mil.helis) {
        if (h.state !== 'fly') continue;
        const hp = new THREE.Vector3(h.x, h.y, h.z);
        const t = hp.clone().sub(o).dot(d);
        if (t < 0) continue;
        const closest = o.clone().addScaledVector(d, t);
        if (closest.distanceTo(hp) < 9 && (hit < 0 || t < hit)) return hp;
      }
    }
    if (hit > 0) return o.addScaledVector(d, hit);
    void g;
    return o.addScaledVector(d, maxDist);
  }
}
