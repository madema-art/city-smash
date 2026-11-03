import * as THREE from 'three';
import { ROAD_CENTERS, CITY_HALF } from '../world/City.js';
import { pick } from '../core/util.js';

// Police response: an environmental escalation signal more than a combat faction.
// Units enter from the city edge with lights and sirens, race along the avenues to intersections
// near the monster and park at angles as roadblocks, strobing red/blue across the street and the
// facades. Their number follows the military response level, so a glance down any street tells
// the player how seriously the city is responding. They are ordinary traffic cars underneath, so
// they can be punched, stomped, crushed, grabbed and thrown like any other vehicle.
const QUOTA = [0, 2, 4, 6, 9, 12, 14];

export class Police {
  constructor(ctx) {
    this.ctx = ctx;
    this.units = [];
    this.cd = 2;
    this.retarget = 0;
  }

  get active() { return this.units.filter((u) => u.car.state === 'police').length; }

  _spawn() {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    const tr = ctx.traffic;
    // choose a roadblock intersection 45–110 m from the monster
    const spots = [];
    for (const cx of ROAD_CENTERS) for (const cz of ROAD_CENTERS) {
      const d = Math.hypot(cx - g.pos.x, cz - g.pos.z);
      if (d > 45 && d < 115) spots.push({ cx, cz, d });
    }
    if (!spots.length) return;
    const spot = pick(spots);
    const used = this.units.filter((u) => u.spot && u.spot.cx === spot.cx && u.spot.cz === spot.cz).length;
    if (used >= 3) return;
    // arrive along one of the intersection's avenues, from the far side of the city
    const vertical = Math.random() < 0.5;
    const roadC = vertical ? spot.cx : spot.cz;
    const target = vertical ? spot.cz : spot.cx;
    const from = (vertical ? g.pos.z : g.pos.x) > target ? -1 : 1; // come from away from the monster
    const start = target + from * (CITY_HALF + 40 - Math.abs(target) * 0.0);
    const car = tr._newCar('police', 0xffffff);
    if (!car) return;
    car.state = 'police';
    car.color = new THREE.Color(1, 1, 1);
    const lane = -from * 1.9 * (vertical ? 1 : 1);
    const u = {
      car, vertical, roadC, lane, along: start, target: target + from * (12 + used * 7), dir: -from, spot,
      speed: 22, parked: false, siren: true, slot: used,
    };
    this._place(u);
    this.units.push(u);
    this.ctx.events.emit('policeArrive', { car });
  }

  _place(u) {
    const c = u.car;
    if (u.vertical) { c.x = u.roadC + u.lane; c.z = u.along; c.yaw = u.dir > 0 ? 0 : Math.PI; }
    else { c.z = u.roadC + u.lane; c.x = u.along; c.yaw = u.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    c.y = 0;
  }

  update(dt) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    const level = ctx.military.level;
    const quota = ctx.military.retreat ? 0 : QUOTA[Math.min(level, QUOTA.length - 1)];
    this.cd -= dt;
    // drop units that were wrecked, grabbed or thrown
    this.units = this.units.filter((u) => u.car.state === 'police' || u.car.state === 'abandoned');
    if (this.active < quota && this.cd <= 0 && g.alive) { this._spawn(); this.cd = 2.5 + Math.random() * 2; }
    this.retarget -= dt;
    for (const u of this.units) {
      const c = u.car;
      if (c.state !== 'police') continue;
      if (!u.parked) {
        const rem = (u.target - u.along) * u.dir;
        const want = rem < 25 ? Math.max(2, rem * 0.8) : 24;
        u.speed += Math.sign(want - u.speed) * Math.min(Math.abs(want - u.speed), 14 * dt);
        u.along += u.dir * u.speed * dt;
        // don't drive through rubble piles or wrecks: stop early as a roadblock
        if (rem <= 0.5 || ctx.rubble.heightAt(c.x, c.z) > 2) {
          u.parked = true;
          // swing across the lane at an angle
          c.yaw += (u.slot % 2 ? 1 : -1) * (0.7 + Math.random() * 0.3);
        } else this._place(u);
        if (!u.parked) this._place(u);
        // run down pedestrians? no: slow for the monster instead
        const dg = Math.hypot(c.x - g.pos.x, c.z - g.pos.z);
        if (dg < 26) { u.parked = true; }
      } else if (this.retarget <= 0) {
        // monster moved far away: the unit pulls out and redeploys
        const dg = Math.hypot(c.x - g.pos.x, c.z - g.pos.z);
        if (dg > 170) { c.state = 'abandoned'; }
      }
      // scatter if the monster comes right at them
      if (u.parked && Math.hypot(c.x - g.pos.x, c.z - g.pos.z) < 14) c.state = 'abandoned';
    }
    if (this.retarget <= 0) this.retarget = 2;
  }

  // Positions of live units with sirens (for spatial audio).
  sirens() {
    return this.units.filter((u) => u.car.state === 'police').map((u) => ({ id: u, x: u.car.x, y: 1.5, z: u.car.z, moving: !u.parked }));
  }
}
