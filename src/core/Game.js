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
import { Police } from '../enemies/Police.js';
import { Searchlights } from '../enemies/Searchlights.js';
import { Fires } from '../fx/Fires.js';
import { Audio } from '../audio/Audio.js';
import { HUD } from '../ui/HUD.js';
import { CityLights } from '../render/CityLights.js';
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
    this.hud = new HUD(params.get('debug') === '1');
    this.fadeEl = document.getElementById('fade');
    this.restartHold = 0;
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
    this.renderer.dom.addEventListener('mousedown', () => {
      if ((this.state === 'won' || this.state === 'lost') && this.level && this.level.endReady) { this.restart(); this.begin(); }
    });
    document.getElementById('restart-btn').addEventListener('click', () => { this.restart(); this.begin(); });
    overlay.addEventListener('click', (e) => {
      if (this.state === 'paused' && e.target === overlay) this.begin();
    });
    document.getElementById('pause-panel').addEventListener('click', () => { if (this.state === 'paused') this.begin(); });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing' && !this.noLock && this.input.lastDevice !== 'pad') this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (['Enter', 'Space', 'KeyR'].includes(e.code) && (this.state === 'won' || this.state === 'lost') && this.level && this.level.endReady) { this.restart(); this.begin(); }
      if (e.code === 'KeyR' && this.state === 'paused') { this.restart(); this.begin(); }
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
    if (!this.level.introDone && this.hud.enabled) {
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
    ctx.lights = new CityLights();
    ctx.fx = new FX(root, this.renderer.envMap);
    ctx.fires = new Fires(ctx);
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
    ctx.police = new Police(ctx);
    ctx.searchlights = new Searchlights(ctx);
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
    ctx.lights.dispose();
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
    this.fadeEl.style.opacity = '0';
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
    E.on('regrip', (e) => { R(0.4, 0.5, 160); A.grunt(e.p); A.concrete(e.p, 0.6); });
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
    E.on('eat', (e) => { A.munch(e.p); A.content(e.p); hud.callout(`+${e.heal} HP`, 'good small'); });
    E.on('breath', (e) => A.breath(e.p, e.sev, e.exert));
    E.on('powerFail', (e) => A.power(e, e.big));
    E.on('lampBreak', (e) => { A.lamp(e); R(0.15, 0.4, 70); });
    E.on('policeArrive', () => {});
    E.on('victory', () => { A.powerDown(); R(0.9, 0.6, 1200); });
    E.on('gorillaDeath', (e) => { A.bodyFall(e.p); R(1, 0.8, 900); });
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
      if (e.name) hud.callout(e.name, 'warn');
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
    this._restartHold(rawDt);
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
    else if (st === 'paused' && I.padHit('restart')) { this.restart(); this.begin(true); }
    else if ((st === 'won' || st === 'lost') && this.level && this.level.endReady && (I.padHit('jump') || I.padHit('pause') || I.padHit('restart'))) { this.restart(); this.begin(true); }
  }

  // ---- test hooks ----
  tick(frames = 1, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) {
      this.input.beginFrame(dt);
      this._padSystem();
      this._restartHold(dt);
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
    ctx.lights.update(dt);
    sharedBuildingUniforms.uTime.value += dt;
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
    if ((this.state === 'won' || this.state === 'lost') && lvl.cine) this._cinematicCam(rawDt, lvl);
    else ctx.cameraRig.update(rawDt, input, g);
    g.update(dt, input, ctx.cameraRig);
    if (g.heldFollow) g.heldFollow.follow(g);
    const camPos = this.renderer.camera.position;
    const destroyedPctForAudio = ctx.city.destroyedPercent;
    ctx.camPos = camPos;
    ctx.military.update(dt, camPos);
    ctx.police.update(dt);
    ctx.searchlights.update(dt);
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
    ctx.fires.update(dt, camPos);
    ctx.lights.update(dt);
    sharedBuildingUniforms.uTime.value += dt;
    // building fade around the line of sight
    sharedBuildingUniforms.uFadeOn.value = 1;
    sharedBuildingUniforms.uCamPos.value.copy(camPos);
    sharedBuildingUniforms.uFocus.value.set(g.pos.x, g.pos.y + 9, g.pos.z);
    // shadows follow what the camera is looking at
    const look = ctx.cameraRig.lookDir;
    this.renderer.updateShadowFocus(_v.set(g.pos.x + look.x * 45, 0, g.pos.z + look.z * 45));
    this.renderer.gradePass.uniforms.uDamage.value = g.hurtFlash;
    // audio listener + spatial loops (nearest few of each kind)
    this.audio.setListener(this.renderer.camera);
    for (const h of ctx.military.helis) if (h.state === 'fly' || h.state === 'falling') this.audio.heliLoop(h, h);
    const near = (list, n) => list.sort((a, b) => ((a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2) - ((b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2)).slice(0, n);
    for (const sd of near(ctx.police.sirens(), 4)) this.audio.sirenLoop(sd.id, sd, sd.moving);
    for (const t of near(ctx.military.tanks.filter((t) => t.hp > 0 && !t.held), 2)) this.audio.engineLoop(t, { x: t.x, y: 2, z: t.z });
    lvl.radioT = (lvl.radioT || 3) - dt;
    if (lvl.radioT <= 0 && ctx.military.level > 0 && !ctx.military.retreat) {
      lvl.radioT = 7 - Math.min(5, ctx.military.level) + Math.random() * 4;
      const src = [...ctx.police.sirens(), ...ctx.military.soldiers.filter((x) => x.state === 'aim').slice(0, 3)];
      if (src.length) { const r = src[Math.floor(Math.random() * src.length)]; this.audio.radio({ x: r.x, y: 2, z: r.z }); }
    }
    this.audio.setAmbience(g.pos.y, Math.max(0, 1 - destroyedPctForAudio / 60));
    this.audio.sweepLoops();
    // score + HUD (HUD is debug-only)
    const s = ctx.stats;
    const destroyed = destroyedPctForAudio;
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
      if (destroyed >= DESTRUCTION.winPercent) this._beginVictory(lvl);
      else if (!g.alive) this._beginDefeat(lvl);
    } else if (this.state === 'won' || this.state === 'lost') {
      this._endSequence(rawDt, lvl);
    }
  }

  // ---------------- endings (no text: the world tells the story) ----------------
  _beginVictory(lvl) {
    const ctx = lvl.ctx;
    this.state = 'won';
    lvl.endT = 0;
    lvl.endReady = false;
    lvl.endEvents = {};
    ctx.military.retreat = true;
    ctx.city.blackoutWave(ctx.gorilla.pos);
    ctx.events.emit('victory', { p: ctx.gorilla.pos.clone() });
    this._beginCinematic(lvl, true);
  }

  _beginDefeat(lvl) {
    const ctx = lvl.ctx;
    this.state = 'lost';
    lvl.endT = 0;
    lvl.endReady = false;
    lvl.endEvents = {};
    this._beginCinematic(lvl, false);
  }

  _beginCinematic(lvl, won) {
    const cam = this.renderer.camera;
    const g = lvl.ctx.gorilla;
    const off = cam.position.clone().sub(g.pos);
    lvl.cine = { won, a: Math.atan2(off.x, off.z), from: cam.position.clone(), fromLook: g.chest, blend: 0 };
    document.exitPointerLock?.();
  }

  _endSequence(dt, lvl) {
    const ctx = lvl.ctx;
    const g = ctx.gorilla;
    lvl.endT += dt;
    const t = lvl.endT;
    const once = (k, at, fn) => { if (t >= at && !lvl.endEvents[k]) { lvl.endEvents[k] = true; fn(); } };
    if (lvl.cine.won) {
      // a last landmark gives way as the power dies across the city
      once('topple', 1.2, () => {
        let best = null, bd = 1e9;
        for (const b of ctx.city.buildings) {
          if (b.height < 44 || b.destroyedFraction > 0.25 || b.collapsedOnce) continue;
          const d = Math.hypot(b.cx - g.pos.x, b.cz - g.pos.z);
          if (d > 60 && d < 260 && d < bd) { bd = d; best = b; }
        }
        if (best) best._startFloorCollapse(Math.min(2, best.ny - 2));
      });
      once('roar', 2.0, () => {
        if (g.state === 'climb') g._start('climbRoar'); else if (g.state !== 'air') g._start('roar');
      });
      once('ready', 6.5, () => { lvl.endReady = true; });
    } else {
      once('cease', 2.5, () => { ctx.military.ceaseFire = true; });
      once('ready', 4.5, () => { lvl.endReady = true; });
      // the picture slowly settles toward darkness, but never fully: the aftermath stays visible
      this.fadeEl.style.opacity = Math.min(0.55, Math.max(0, (t - 5) / 6) * 0.55).toFixed(3);
    }
  }

  // Slow, controlled orbit that frames the monster against the skyline (input-free endings only).
  _cinematicCam(dt, lvl) {
    const c = lvl.cine;
    const g = lvl.ctx.gorilla;
    const cam = this.renderer.camera;
    c.blend = Math.min(1, c.blend + dt / 2.2);
    c.a += dt * (c.won ? 0.12 : 0.07);
    const dist = c.won ? 46 : 30;
    const height = c.won ? 6 : 9;
    const want = new THREE.Vector3(g.pos.x + Math.sin(c.a) * dist, g.pos.y + height, g.pos.z + Math.cos(c.a) * dist);
    // stay out of buildings: pull in along the line to the monster if needed
    const look = g.pos.clone(); look.y += c.won ? 13 : 3;
    const dir = want.clone().sub(look);
    const len = dir.length(); dir.normalize();
    const hit = lvl.ctx.city.raycast(look, dir, len, 1.5);
    if (hit > 0) want.copy(look).addScaledVector(dir, Math.max(6, hit - 2));
    const floor = lvl.ctx.city.groundAt(want.x, want.z, want.y + 2) + 1.5;
    if (want.y < floor) want.y = floor;
    const e = c.blend * c.blend * (3 - 2 * c.blend);
    cam.position.lerpVectors(c.from, want, e);
    const lk = c.fromLook.clone().lerp(look, e);
    cam.lookAt(lk);
    cam.fov += ((c.won ? 52 : 48) - cam.fov) * Math.min(1, dt * 1.5);
    cam.updateProjectionMatrix();
  }

  // Hold R / Back for a second to restart mid-game (the picture fades to black as you hold).
  _restartHold(dt) {
    if (this.state !== 'playing') { if (this.restartHold > 0) { this.restartHold = 0; this.fadeEl.style.opacity = '0'; } return; }
    const held = this.input.held.has('KeyR') || this.input.padHeld.has(8);
    this.restartHold = held ? this.restartHold + dt : Math.max(0, this.restartHold - dt * 3);
    this.fadeEl.style.opacity = Math.min(1, this.restartHold / 1.1).toFixed(3);
    if (this.restartHold >= 1.1) {
      this.restartHold = 0;
      this.restart();
      this.begin(this.noLock);
    }
  }

  _render(dt) {
    this.renderer.render(dt);
  }
}
