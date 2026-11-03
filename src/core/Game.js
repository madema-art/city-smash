import * as THREE from 'three';
import { Renderer } from '../render/Renderer.js';
import { Input, NULL_INPUT } from './Input.js';
import { Physics, initRapier } from './Physics.js';
import { EventBus } from './util.js';
import { CameraRig } from './CameraRig.js';
import { Combat } from './Combat.js';
import { Projectiles } from './Projectiles.js';
import { FX } from '../fx/FX.js';
import { DebrisSystem, RubbleField } from '../destruction/Debris.js';
import { City } from '../world/City.js';
import { Props } from '../world/Props.js';
import { sharedBuildingUniforms } from '../world/BuildingMaterial.js';
import { Gorilla } from '../monster/Gorilla.js';
import { buildGorillaGeometry } from '../monster/GorillaModel.js';
import { Crowd } from '../city/Crowd.js';
import { Traffic } from '../city/Traffic.js';
import { Military } from '../enemies/Military.js';
import { WindowPeople } from '../city/WindowPeople.js';
import { Audio } from '../audio/Audio.js';
import { HUD } from '../ui/HUD.js';
import { DESTRUCTION } from '../config.js';

const _v = new THREE.Vector3();

// Top-level game: owns the renderer and the per-run "level" (city, monster, systems).
// A run is torn down and rebuilt on restart so nothing leaks between attempts.
export class Game {
  constructor(container, params) {
    this.params = params;
    this.renderer = new Renderer(container);
    this.input = new Input(this.renderer.dom);
    this.audio = new Audio();
    this.hud = new HUD();
    this.state = 'loading';
    this.level = null;
    this.timeScale = 1;
    this.hitStopT = 0;
    this.fpsAvg = 60;
    this._bindUI();
    this.input.onPad((kind, pad) => {
      if (kind === 'connected') {
        this.hud.callout('CONTROLLER READY', 'good small');
        const l = document.getElementById('pad-status');
        if (l) l.textContent = `🎮 ${pad.id.split('(')[0].trim() || 'Controller'} connected — press A / ✕ to start`;
      }
    });
  }

  async init() {
    const loading = document.getElementById('loading');
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    await new Promise((r) => setTimeout(r, 30));
    await initRapier();
    loading.textContent = 'Sculpting gorilla…';
    await new Promise((r) => setTimeout(r, 30));
    buildGorillaGeometry().geo.userData.shared = true;
    loading.textContent = 'Building the city…';
    await new Promise((r) => setTimeout(r, 30));
    this.startLevel();
    loading.textContent = '';
    btn.disabled = false;
    this.state = 'title';
    this.clock = new THREE.Clock();
    if (this.params.get('test')) {
      // deterministic mode for automated tests: the page drives time via tick()/renderOnce()
      this.testMode = true;
      this.begin(true);
      return;
    }
    this.renderer.renderer.setAnimationLoop(() => this._frame());
    if (this.params.get('autostart')) this.begin(true);
  }

  _bindUI() {
    const overlay = document.getElementById('overlay');
    document.getElementById('start-btn').addEventListener('click', () => this.begin());
    document.getElementById('restart-btn').addEventListener('click', () => { this.restart(); this.begin(); });
    overlay.addEventListener('click', (e) => {
      if (this.state === 'paused' && e.target === overlay) this.begin();
    });
    document.getElementById('pause-panel').addEventListener('click', () => { if (this.state === 'paused') this.begin(); });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing' && !this.noLock && this.input.lastDevice !== 'pad') this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && (this.state === 'playing' || this.state === 'paused' || this.state === 'won' || this.state === 'lost')) {
        this.restart();
        this.begin();
      }
      if (e.code === 'Enter' && (this.state === 'won' || this.state === 'lost')) { this.restart(); this.begin(); }
      if (e.code === 'KeyM') this.audio.master && (this.audio.master.gain.value = this.audio.master.gain.value > 0 ? 0 : 0.8);
    });
  }

  begin(noLock = false) {
    this.audio.init();
    if (this.input.lastDevice === 'pad') noLock = true;
    this.noLock = noLock;
    if (!noLock) this.input.requestLock();
    this.state = 'playing';
    this._showPanel(null);
    this.hud.show(true);
    if (!this.level.introDone) {
      this.level.introDone = true;
      this.hud.callout('SMASH THE CITY!', 'good');
      this.hud.hint(this.input.lastDevice === 'pad'
        ? '<b>RT</b> punch · <b>LT</b> smash · <b>B</b> stomp · <b>X</b> grab/eat · <b>Y</b> climb · <b>RB</b> roar · <b>LB/L3</b> sprint'
        : '<b>LMB</b> punch · <b>RMB</b> smash · <b>F</b> stomp · <b>E</b> grab/eat · <b>C</b> climb · <b>Q</b> roar', 9);
      this.level.ctx.events.emit('roarIntro');
    }
  }

  pause() {
    this.state = 'paused';
    this._showPanel('pause-panel');
  }

  _showPanel(id) {
    const overlay = document.getElementById('overlay');
    for (const pid of ['title-panel', 'end-panel', 'pause-panel']) document.getElementById(pid).classList.toggle('hidden', pid !== id);
    overlay.classList.toggle('hidden', !id);
  }

  // ---------------- level lifecycle ----------------
  startLevel() {
    const scene = this.renderer.scene;
    const root = new THREE.Group();
    root.name = 'level';
    scene.add(root);
    const events = new EventBus();
    const physics = new Physics();
    const ctx = {
      root, events, physics, scene,
      stats: { destroyedCells: 0, civilians: 0, soldiers: 0, tanks: 0, helis: 0, eaten: 0, vehicles: 0, collapsed: 0 },
      budget: { physics: 6, chips: 10, glass: 8, dust: 12 },
      hitStop: (t) => { this.hitStopT = Math.max(this.hitStopT, t); },
      input: this.input,
    };
    ctx.fx = new FX(root, this.renderer.envMap);
    ctx.rubble = new RubbleField(root);
    ctx.fx.setFloor((x, z) => ctx.rubble.heightAt(x, z) * 0.8);
    ctx.debris = new DebrisSystem(root, physics, ctx.rubble, events);
    ctx.props = new Props(ctx);
    ctx.city = new City(ctx, parseInt(this.params.get('seed') || '7', 10));
    ctx.city.populateStreets();
    ctx.combat = new Combat(ctx);
    ctx.projectiles = new Projectiles(ctx);
    ctx.gorilla = new Gorilla(ctx, new THREE.Vector3(0, 0, 150));
    ctx.cameraRig = new CameraRig(this.renderer.camera, ctx);
    ctx.crowd = new Crowd(ctx, 320);
    ctx.windows = new WindowPeople(ctx);
    ctx.traffic = new Traffic(ctx);
    ctx.military = new Military(ctx);
    this.level = { ctx, root, time: 0, endT: 0, introDone: false, score: 0, grabCheck: 0, grabHint: '', toppled: new Set() };
    this._wireEvents(ctx);
    window.__ctx = ctx;
  }

  disposeLevel() {
    if (!this.level) return;
    const { ctx, root } = this.level;
    this.renderer.scene.remove(root);
    root.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    ctx.city.scorchTex.dispose();
    ctx.events.clear();
    ctx.physics.dispose();
    for (const [, L] of this.audio.loops) L.seen = false;
    this.audio.sweepLoops();
    this.level = null;
  }

  restart() {
    this.disposeLevel();
    this.startLevel();
    this.hitStopT = 0;
    document.getElementById('callouts').innerHTML = '';
  }

  // ---------------- events → audio / HUD / systems ----------------
  _wireEvents(ctx) {
    const A = this.audio, hud = this.hud, E = ctx.events;
    const R = (strong, weak, ms) => this.input.rumble(strong, weak, ms);
    const near = (x, y, z, range) => Math.max(0, 1 - this.renderer.camera.position.distanceTo(_v.set(x, y, z)) / range);
    E.on('impact', (e) => R(Math.min(1, 0.25 + e.power * 0.3 + (e.destroyed ? 0.2 : 0)), 0.6, e.destroyed ? 140 : 90));
    E.on('shock', (e) => R(Math.min(1, 0.6 * e.power), 0.4, 220));
    E.on('step', (e) => { if (e.power > 0.6) R(0.12, 0.0, 60); });
    E.on('land', (e) => R(0.7, 0.3, 160));
    E.on('hurt', (e) => R(0.2 + Math.min(0.6, e.amount / 10), 0.5, e.amount >= 3 ? 200 : 60));
    E.on('explosion', (e) => { const k = near(e.x, e.y, e.z, 140); if (k > 0) R(0.8 * k * e.power, 0.4 * k, 250); });
    E.on('collapseStart', (e) => { const k = near(e.x, e.y, e.z, 250); R(Math.min(1, 0.3 + e.size / 300) * k, 0.2, 900); });
    E.on('collapseEnd', (e) => { const k = near(e.x, 5, e.z, 250); R(Math.min(1, 0.4 + e.size / 250) * k, 0.5 * k, 700); });
    E.on('roar', () => R(0.5, 0.9, 1500));
    E.on('grab', () => R(0.2, 0.3, 80));
    E.on('eat', () => R(0.15, 0.5, 400));
    // climbing feedback: firm thump per wall punch, heavy for structural smashes
    E.on('climbHit', (e) => R(e.heavy ? 0.85 : 0.45, e.heavy ? 0.5 : 0.7, e.heavy ? 260 : 110));
    E.on('climbStep', () => R(0.08, 0.05, 50));
    E.on('lostGrip', () => { R(0.6, 0.8, 350); hud.callout('LOST GRIP!', 'warn small'); });
    E.on('slip', () => R(0.25, 0.6, 300));
    E.on('mantle', () => R(0.35, 0.2, 180));
    const L = () => this.level;
    const camDist = (x, y, z) => this.renderer.camera.position.distanceTo(_v.set(x, y, z));
    E.on('impact', (e) => {
      const p = { x: e.x, y: e.y, z: e.z };
      A.punch(p, Math.min(1.4, e.power));
      if (e.kind === 'concrete') A.concrete(p, Math.min(2, e.power * (e.destroyed ? 1.3 : 0.6)));
      if (e.glass) A.glass(p, e.glass);
      if (e.kind === 'metal') A.metal(p, 1);
    });
    E.on('metalHit', (e) => A.metal(e, 1.2));
    E.on('swing', (e) => A.whoosh({ x: e.p.x, y: e.p.y + 10, z: e.p.z }, e.heavy));
    E.on('throw', (e) => A.whoosh(e.p, true));
    E.on('grab', () => A.grunt(ctx.gorilla.chest));
    E.on('eat', (e) => { A.munch(e.p); hud.callout(`+${e.heal} HP`, 'good small'); });
    E.on('roar', (e) => { A.roar({ x: e.p.x, y: e.p.y + 12, z: e.p.z }); hud.callout('RAGE!', 'warn'); });
    E.on('roarIntro', () => {});
    E.on('step', (e) => {
      A.step(e.p, e.power);
      const d = camDist(e.p.x, e.p.y, e.p.z);
      ctx.fx.addShake(Math.max(0, 0.22 * e.power * (1 - d / 120)));
      if (e.power > 0.6) ctx.fx.collapseDust(e.p.x, e.p.y + 0.5, e.p.z, 3, 0.25);
      ctx.crowd.alarm(e.p, 45);
    });
    E.on('land', (e) => A.slam(e.p, Math.min(1.2, e.power)));
    E.on('slam', (e) => { A.slam(e.p, 1.5); hud.callout('GROUND SLAM!', 'small'); });
    E.on('shock', (e) => { if (e.kind === 'stomp' || e.kind === 'smash') A.slam(e, e.power); });
    E.on('explosion', (e) => {
      A.explosion(e, e.power);
      const d = camDist(e.x, e.y, e.z);
      ctx.fx.addShake(Math.max(0, e.power * 0.8 * (1 - d / 160)));
      ctx.crowd.alarm(e, 60);
    });
    E.on('gunfire', (e) => A.gunshot(e, e.heli));
    E.on('cannon', (e) => A.cannon(e));
    E.on('rocket', (e) => A.rocket(e));
    E.on('hurt', (e) => { if (e.amount >= 3) A.hurt(); });
    E.on('scream', (e) => A.scream({ x: e.x, y: 1, z: e.z }));
    E.on('groan', (e) => A.groan(e, e.strength));
    E.on('hint', (e) => hud.hint(e.text, 2.5));
    E.on('buildingHit', (e) => {
      const r = e.result;
      for (const b of r.buildings) if (r.ground > 0 || e.p.y < 14) ctx.crowd.exodus(b, 2 + Math.floor(Math.random() * 3));
    });
    E.on('collapseStart', (e) => {
      const p = { x: e.x, y: e.y + 10, z: e.z };
      A.groan(p, 1.5);
      const big = e.size > 60;
      setTimeout(() => A.rumble(p, Math.min(2, e.size / 150 + 0.5), Math.min(6, 1.5 + e.size / 120)), 350);
      const d = camDist(e.x, e.y, e.z);
      ctx.fx.addShake(Math.min(2.5, (e.size / 120) * (1 - Math.min(1, d / 250))));
      ctx.crowd.alarm(p, 140);
      if (big && !L().toppled.has(e.building)) {
        L().toppled.add(e.building);
        ctx.stats.collapsed++;
        hud.callout(e.size > 400 ? 'SKYSCRAPER DOWN!' : 'COLLAPSE!', 'good');
      }
    });
    E.on('collapseEnd', (e) => {
      A.explosion({ x: e.x, y: 4, z: e.z }, Math.min(1.5, e.size / 200 + 0.3));
      const d = camDist(e.x, 5, e.z);
      ctx.fx.addShake(Math.min(2, (e.size / 150) * (1 - Math.min(1, d / 250))));
      ctx.city.scar(e.x, e.z, 16, 0, 0, 0.9);
    });
    E.on('crush', (e) => {
      ctx.crowd.crush(e.x, e.z, 4.5);
      ctx.traffic.crush(e.x, e.z, 4.5);
      ctx.military.crush(e.x, e.z, 4.5);
      ctx.props.impulse(e.x, e.z, 5, 6);
    });
    E.on('debrisImpact', (e) => {
      ctx.crowd.crush(e.x, e.z, 2.2);
      ctx.traffic.crush(e.x, e.z, 2.6);
      ctx.military.crush(e.x, e.z, 2.2);
      ctx.props.impulse(e.x, e.z, 3, 5);
      A.concrete(e, 0.5);
    });
    E.on('levelUp', (e) => {
      if (e.name) { hud.callout(e.name, 'warn'); A.ui('level'); }
      A.setSiren(e.level);
    });
    E.on('kill', (e) => {
      if (e.kind === 'heli') hud.callout('CHOPPER DOWN!', 'good small');
      if (e.kind === 'tank') hud.callout('TANK CRUSHED!', 'good small');
    });
    E.on('gorillaDeath', () => { hud.callout('THE SILVERBACK FALLS', 'warn'); A.roar(ctx.gorilla.chest, false); });
    E.on('mantle', () => A.grunt(ctx.gorilla.chest));
    E.on('climbStep', (e) => A.step(e.p, 0.18));
    E.on('climbCorner', () => A.grunt(ctx.gorilla.chest));
    E.on('lostGrip', () => A.grunt(ctx.gorilla.chest));
    E.on('slip', (e) => A.concrete(e.p, 0.5));
    E.on('windowGrab', (e) => { A.scream(e); A.glass(e, 1); });
    E.on('climbStart', () => {
      A.grunt(ctx.gorilla.chest);
      const n = (this.climbHints = (this.climbHints || 0) + 1);
      if (n <= 2) {
        hud.hint(this.input.lastDevice === 'pad'
          ? '<b>L-STICK</b> climb · <b>RT</b> punch wall · <b>LT</b> smash floor · <b>B</b> kick · <b>X</b> grab from window · <b>A</b> leap · <b>Y</b> let go'
          : '<b>W/S</b> climb · <b>A/D</b> traverse · <b>LMB</b> punch wall · <b>RMB</b> smash floor · <b>F</b> kick · <b>E</b> grab from window · <b>Space</b> leap · <b>C</b> let go', 8);
      }
    });
  }

  // ---------------- main loop ----------------
  _frame() {
    const rawDt = Math.min(this.clock.getDelta(), 1 / 20);
    this.fpsAvg = this.fpsAvg * 0.95 + (1 / Math.max(rawDt, 1e-4)) * 0.05;
    this.input.beginFrame(rawDt);
    this._padSystem();
    const lvl = this.level;
    if (!lvl) return;
    const ctx = lvl.ctx;
    const playing = this.state === 'playing' || this.state === 'won' || this.state === 'lost';
    // hit-stop: a few frames of near-freeze on big impacts sells the weight of a blow
    let dt = rawDt;
    if (this.hitStopT > 0) { this.hitStopT -= rawDt; dt = rawDt * 0.08; }
    if (playing) this._update(dt, rawDt);
    else if (this.state === 'title') this._titleCam(rawDt);
    this._render(rawDt);
  }

  // Gamepad buttons that drive menus: Start pauses/resumes, Back restarts, A starts / retries.
  _padSystem() {
    const I = this.input;
    if (!I.anyPadHit()) return;
    const st = this.state;
    if (st === 'title' && (I.padHit('jump') || I.padHit('pause'))) this.begin(true);
    else if (st === 'playing' && I.padHit('pause')) { this.pause(); }
    else if (st === 'paused' && (I.padHit('pause') || I.padHit('jump'))) this.begin(true);
    else if ((st === 'won' || st === 'lost') && this.level && this.level.endShown && (I.padHit('jump') || I.padHit('pause'))) { this.restart(); this.begin(true); }
    if (I.padHit('restart') && st !== 'title' && st !== 'loading') { this.restart(); this.begin(true); }
  }

  // ---- test hooks ----
  tick(frames = 1, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) {
      this.input.beginFrame(dt);
      this._padSystem();
      let d = dt;
      if (this.hitStopT > 0) { this.hitStopT -= dt; d = dt * 0.08; }
      if (this.state === 'playing' || this.state === 'won' || this.state === 'lost') this._update(d, dt);
    }
  }

  renderOnce() { this._render(1 / 60); }

  _titleCam(dt) {
    const ctx = this.level.ctx;
    this.titleT = (this.titleT || 0) + dt;
    const g = ctx.gorilla;
    const a = this.titleT * 0.08 + 2.6;
    const cam = this.renderer.camera;
    cam.position.set(g.pos.x + Math.sin(a) * 42, 16 + Math.sin(this.titleT * 0.3) * 3, g.pos.z + Math.cos(a) * 42);
    cam.lookAt(g.pos.x, 9, g.pos.z);
    g.update(dt, NULL_INPUT, { yaw: g.yaw, pitch: 0 });
    ctx.crowd.update(dt, cam.position);
    ctx.traffic.update(dt);
    ctx.city.update(dt);
    ctx.props.update(dt);
    ctx.fx.update(dt, this.renderer.scene.fog);
    this.renderer.updateShadowFocus(g.pos);
    sharedBuildingUniforms.uFadeOn.value = 0;
  }

  _update(dt, rawDt) {
    const lvl = this.level;
    const ctx = lvl.ctx;
    lvl.time += dt;
    ctx.budget.physics = 6; ctx.budget.chips = 12; ctx.budget.glass = 10; ctx.budget.dust = 5;
    const g = ctx.gorilla;
    const input = this.state === 'playing' ? this.input : NULL_INPUT;
    ctx.cameraRig.update(rawDt, input, g);
    g.update(dt, input, ctx.cameraRig);
    if (g.heldFollow) g.heldFollow.follow(g);
    const camPos = this.renderer.camera.position;
    ctx.military.update(dt, camPos);
    ctx.crowd.update(dt, camPos);
    ctx.windows.update(dt, camPos);
    ctx.traffic.update(dt);
    ctx.physics.step(dt);
    ctx.city.update(dt);
    ctx.debris.update(dt);
    ctx.projectiles.update(dt);
    ctx.props.update(dt);
    ctx.rubble.update();
    ctx.fx.update(dt, this.renderer.scene.fog);
    // building fade around the line of sight
    sharedBuildingUniforms.uFadeOn.value = 1;
    sharedBuildingUniforms.uCamPos.value.copy(camPos);
    sharedBuildingUniforms.uFocus.value.set(g.pos.x, g.pos.y + 9, g.pos.z);
    // shadows follow what the camera is looking at
    const look = ctx.cameraRig.lookDir;
    this.renderer.updateShadowFocus(_v.set(g.pos.x + look.x * 45, 0, g.pos.z + look.z * 45));
    this.renderer.gradePass.uniforms.uDamage.value = g.hurtFlash;
    // audio listener + helicopter loops
    this.audio.setListener(this.renderer.camera);
    for (const h of ctx.military.helis) if (h.state === 'fly' || h.state === 'falling') this.audio.heliLoop(h, h);
    this.audio.sweepLoops();
    // score + HUD
    const s = ctx.stats;
    const destroyed = ctx.city.destroyedPercent;
    lvl.score = s.destroyedCells * 5 + s.soldiers * 50 + s.tanks * 500 + s.helis * 750 + s.civilians * 10 + s.eaten * 100 + s.vehicles * 60 + s.collapsed * 1000;
    lvl.grabCheck -= dt;
    if (lvl.grabCheck <= 0) {
      lvl.grabCheck = 0.2;
      lvl.grabHint = '';
      const pad = this.input.lastDevice === 'pad';
      if (g.held) lvl.grabHint = g.held.edible ? (pad ? 'X  EAT    ·    RT  THROW' : 'E  EAT    ·    LMB  THROW') : (pad ? 'X / RT  THROW' : 'E / LMB  THROW');
      else if (g.state === 'ground') {
        const reach = g.pos.clone().addScaledVector(g.forward, 7);
        const c = [...ctx.crowd.grabCandidates(reach, 8), ...ctx.military.grabCandidates(reach, 8)];
        if (c.length) lvl.grabHint = pad ? 'X  GRAB SNACK' : 'E  GRAB SNACK';
        else if (ctx.traffic.grabCandidates(reach, 7).length) lvl.grabHint = pad ? 'X  GRAB' : 'E  GRAB';
      }
    }
    this.hud.update(rawDt, {
      health: g.health, destroyed, level: ctx.military.level, score: lvl.score,
      collapsed: s.collapsed, soldiers: s.soldiers, helis: s.helis, tanks: s.tanks, eaten: s.eaten, grabHint: lvl.grabHint,
    });
    // win / lose
    if (this.state === 'playing') {
      if (destroyed >= DESTRUCTION.winPercent) { this.state = 'won'; lvl.endT = 0; this.hud.callout('CITY FLATTENED!', 'good'); this.audio.ui('win'); }
      else if (!g.alive) { this.state = 'lost'; lvl.endT = 0; this.audio.ui('lose'); }
    } else if (this.state === 'won' || this.state === 'lost') {
      lvl.endT += rawDt;
      if (lvl.endT > 3 && !lvl.endShown) {
        lvl.endShown = true;
        this._showEnd(this.state === 'won', destroyed, lvl);
      }
    }
  }

  _showEnd(won, destroyed, lvl) {
    const s = lvl.ctx.stats;
    document.getElementById('end-title').textContent = won ? 'CITY FLATTENED' : 'TAKEN DOWN';
    document.getElementById('end-sub').textContent = won
      ? 'The skyline will never be the same. All hail the silverback.'
      : 'The army got lucky this time. The city still stands… barely.';
    const t = Math.floor(lvl.time);
    document.getElementById('end-stats').innerHTML = `
      Score <b>${Math.round(lvl.score).toLocaleString()}</b><br>
      Destroyed <b>${destroyed.toFixed(1)}%</b> in <b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b><br>
      Buildings toppled <b>${s.collapsed}</b> · Snacks <b>${s.eaten}</b><br>
      Soldiers <b>${s.soldiers}</b> · Tanks <b>${s.tanks}</b> · Choppers <b>${s.helis}</b>`;
    document.exitPointerLock?.();
    this._showPanel('end-panel');
  }

  _render(dt) {
    this.renderer.render(dt);
  }
}
