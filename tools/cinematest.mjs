// Cinematic-overhaul verification: zero-HUD, diegetic health, escalation cues, destructible
// lighting, endings, and the 12-shot visual review. Runs in deterministic ?test=1 mode.
// Usage: node tools/cinematest.mjs <outDir> [quality: full|low]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const out = process.argv[2] || '.';
const low = process.argv[3] === 'low';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => {
  const pad = { id: 'Virtual Pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), vibrationActuator: { effects: ['dual-rumble'], playEffect: () => Promise.resolve('complete') } };
  window.__pad = pad; navigator.getGamepads = () => [pad];
});
await page.goto(`http://localhost:5173/?test=1${low ? '&low=1' : ''}`);
await page.waitForFunction(() => window.__game && window.__game.state === 'playing', null, { timeout: 180000 });

const results = [];
const check = (name, pass, info = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const tick = (n) => page.evaluate((n) => window.__game.tick(n), n);
const shot = async (name, cam) => {
  await page.evaluate((cam) => {
    const G = window.__game;
    if (cam) {
      G._shotFreeze = true;
      const c = G.renderer.camera; c.position.set(...cam.pos); c.lookAt(...cam.look); c.fov = cam.fov || 60; c.updateProjectionMatrix();
      G.renderer.updateShadowFocus({ x: cam.look[0], y: 0, z: cam.look[2] });
    }
    G.renderOnce(); G.renderOnce();
  }, cam || null);
  await page.screenshot({ path: `${out}/cine_${name}.png`, timeout: 180000 });
};
// Any visible text / UI over the world during play?
const hudVisible = () => page.evaluate(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    let p = el; while (p) { const c = getComputedStyle(p); if (c.display === 'none' || +c.opacity === 0) return false; p = p.parentElement; }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  const offenders = [...document.querySelectorAll('body *')].filter((el) => el.tagName !== 'CANVAS' && el.id !== 'fade' && el.id !== 'app' && vis(el) && (el.textContent.trim() || el.children.length === 0 && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  return offenders.map((e) => e.id || e.className || e.tagName).slice(0, 5);
});
const noHud = async (when) => { const v = await hudVisible(); check(`no HUD: ${when}`, v.length === 0, v.length ? JSON.stringify(v) : ''); };

// ---------------- 1. intact skyline ----------------
await tick(30);
await page.evaluate(() => { window.__ctx.gorilla.invuln = 1e9; });
await noHud('initial gameplay');
const lit0 = await page.evaluate(() => {
  const c = window.__ctx; let on = 0, tot = 0;
  for (const b of c.city.buildings) for (let i = 0; i < b.N; i++) if (b.exists[i]) { tot++; if (b.power[i] > 0.99) on++; }
  return { on, tot, lamps: c.props.litLamps };
});
check('windows powered at start', lit0.on / lit0.tot > 0.98, JSON.stringify(lit0));
await shot('01_skyline', { pos: [-190, 120, 300], look: [10, 30, 20], fov: 55 });

// ---------------- 2. healthy gorilla on the street ----------------
await page.evaluate(() => { const G = window.__game; G._shotFreeze = false; });
await tick(60);
await shot('02_gorilla_healthy');
const w0 = await page.evaluate(() => window.__ctx.gorilla.model.material.userData.u.uWound.value);

// ---------------- 3. injured gorilla, then healing ----------------
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla; g.invuln = 0;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    g.damage(5.2, 'test', g.pos.clone().add({ x: Math.sin(a) * 40, y: 8 + Math.random() * 6, z: Math.cos(a) * 40 }));
  }
  g.invuln = 1e9;
});
await tick(90);
const injured = await page.evaluate(() => { const g = window.__ctx.gorilla; return { hp: g.health, wound: g.model.material.userData.u.uWound.value, splats: g.hits.length }; });
check('wounds track health loss', injured.wound > 0.6 && injured.splats > 3 && injured.wound > w0 + 0.5, JSON.stringify(injured));
await noHud('taking damage');
await shot('03_gorilla_injured');
// feed: put a pedestrian in reach and eat via the controller (X twice)
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  const h = c.crowd.people.find((p) => p.state !== 'dead' && p.state !== 'held');
  h.x = g.pos.x + Math.sin(g.yaw) * 7; h.z = g.pos.z + Math.cos(g.yaw) * 7; h.y = 0; h.state = 'walk';
  window.__pad.buttons[2] = { pressed: true, value: 1 };
});
await tick(3); await page.evaluate(() => { window.__pad.buttons[2] = { pressed: false, value: 0 }; }); await tick(45);
await page.evaluate(() => { window.__pad.buttons[2] = { pressed: true, value: 1 }; }); await tick(3);
await page.evaluate(() => { window.__pad.buttons[2] = { pressed: false, value: 0 }; }); await tick(240);
const healed = await page.evaluate(() => { const g = window.__ctx.gorilla; return { hp: g.health, wound: g.model.material.userData.u.uWound.value, eaten: window.__ctx.stats.eaten }; });
check('eating visibly heals (wounds recede)', healed.eaten >= 1 && healed.hp > injured.hp && healed.wound < injured.wound - 0.05, JSON.stringify(healed));
await noHud('healing');

// ---------------- 4/5. lit skyscraper, then smashed windows ----------------
const tower = await page.evaluate(() => { const c = window.__ctx; const b = c.city.buildings.find((b) => b.inFootprint(20, 110)); return { x0: b.x0, z0: b.z0, w: b.width, d: b.depth, h: b.height, cz: b.cz }; });
await shot('04_tower_lit', { pos: [-2, 4, tower.cz + 52], look: [tower.x0 + 10, 60, tower.cz], fov: 64 });
await page.evaluate(() => { window.__game._shotFreeze = false; });
// climb the tower and smash a band of windows at height
await page.evaluate(() => { const c = window.__ctx, g = c.gorilla, b = c.city.buildings.find((b) => b.inFootprint(20, 110)); window.__tower = b; g.pos.set(b.x0 - 5, 0, b.cz); g.yaw = Math.PI / 2; c.cameraRig.yaw = Math.PI / 2; c.cameraRig.pitch = 0; });
const press = async (i, after) => { await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, i); await tick(3); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, i); await tick(after); };
await press(3, 20);
await page.evaluate(() => { window.__pad.axes[1] = -1; }); await tick(200); await page.evaluate(() => { window.__pad.axes[1] = 0; }); await tick(15);
const powBefore = await page.evaluate(() => { const b = window.__tower; let s = 0; for (let i = 0; i < b.N; i++) if (b.exists[i]) s += b.power[i]; return s; });
for (let i = 0; i < 4; i++) await press(7, 26);
await press(6, 60);
const lightLoss = await page.evaluate(() => {
  const b = window.__tower; let s = 0, dead = 0, flick = 0;
  for (let i = 0; i < b.N; i++) if (b.exists[i]) { s += b.power[i]; if (b.power[i] === 0) dead++; else if (b.power[i] < 0.99) flick++; }
  return { s, dead, flick, gy: window.__ctx.gorilla.pos.y };
});
check('smashed windows lose their light (dead + flickering cells)', lightLoss.dead > 5 && lightLoss.flick > 3 && lightLoss.s < powBefore - 5, JSON.stringify(lightLoss));
await noHud('climbing / destruction at height');
await tick(40);
await shot('05_tower_damaged');

// ---------------- 7. climbing at height ----------------
await page.evaluate(() => { window.__pad.axes[1] = -1; }); await tick(260); await page.evaluate(() => { window.__pad.axes[1] = 0; }); await tick(30);
const hy = await page.evaluate(() => window.__ctx.gorilla.pos.y);
check('climbing still works at height', hy > 45, `y=${hy.toFixed(1)}`);
await shot('07_climb_high');

// ---------------- 8. helicopter combat at night (searchlights) ----------------
await page.evaluate(() => {
  const c = window.__ctx, m = c.military, g = c.gorilla;
  m.level = 3;
  for (let i = 0; i < 2; i++) { m._spawnHeli(); const h = m.helis[m.helis.length - 1]; h.x = g.pos.x - 30 - i * 15; h.y = g.pos.y + 14 + i * 6; h.z = g.pos.z + (i ? 20 : -16); h.vx = h.vy = h.vz = 0; }
  c.cameraRig.yaw = -Math.PI / 2 + 0.35; c.cameraRig.pitch = 0.15;
});
await tick(120);
const sl = await page.evaluate(() => { const s = window.__ctx.searchlights; return { beams: s.beams.filter((b) => b.visible).length, spots: s.spots.filter((x) => x.intensity > 0).length }; });
check('helicopter searchlights hunt the monster', sl.beams >= 2 && sl.spots >= 1, JSON.stringify(sl));
await shot('08_heli_night');
await noHud('rooftop/helicopter combat');
// swat one down
await press(7, 60);
const downs = await page.evaluate(() => window.__ctx.stats.helis);
check('helicopter destroyed while elevated', downs >= 1, `helis=${downs}`);
await noHud('helicopter destruction');

// ---------------- military escalation cues ----------------
const esc = [];
await page.evaluate(() => { const c = window.__ctx, g = c.gorilla; g._leaveClimb('drop'); g.pos.set(0, 0, 150); g.vel.set(0, 0, 0); });
await tick(60);
for (const L of [1, 3, 5, 6]) {
  await page.evaluate((L) => { window.__ctx.military.level = L; }, L);
  await tick(60 * 9);
  esc.push(await page.evaluate(() => {
    const c = window.__ctx;
    return { level: c.military.level, police: c.police.active, sirens: c.police.sirens().length, beams: c.searchlights.beams.filter((b) => b.visible).length, helis: c.military.activeCounts.helis, tanks: c.military.activeCounts.tanks, soldiers: c.military.activeCounts.soldiers };
  }));
}
console.log('   escalation:', JSON.stringify(esc));
const mono = (k) => esc.every((e, i) => i === 0 || e[k] >= esc[i - 1][k] - 1);
check('escalation: police/sirens grow with response level', esc[3].police > esc[0].police && mono('police'));
check('escalation: searchlights + aircraft grow with response level', esc[3].beams > esc[0].beams && esc[3].helis >= esc[0].helis);
await shot('08b_escalation');
await noHud('max military response');

// ---------------- 6. destroyed streetlights ----------------
const lampTest = await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  const lamp = c.props.types.lamp.items.find((it) => it.alive && Math.hypot(it.x - g.pos.x, it.z - g.pos.z) < 40);
  const before = c.lights.sampleStatic(lamp.hx, lamp.hz);
  const n0 = c.props.litLamps;
  c.combat.groundShock(new THREE_V(lamp.x, 0, lamp.z), 18, 1.2, 'stomp');
  c.lights.update(0.016);
  return { before, after: c.lights.sampleStatic(lamp.hx, lamp.hz), n0, n1: c.props.litLamps, at: [lamp.x, lamp.z] };
  function THREE_V(x, y, z) { return window.__ctx.gorilla.pos.clone().set(x, y, z); }
});
check('destroyed streetlights go dark (light field drops)', lampTest.n1 < lampTest.n0 && lampTest.after < lampTest.before * 0.5, JSON.stringify(lampTest));
await tick(40);
await shot('06_lamps_out', { pos: [lampTest.at[0] + 30, 22, lampTest.at[1] + 40], look: [lampTest.at[0], 0, lampTest.at[1]], fov: 58 });
await page.evaluate(() => { window.__game._shotFreeze = false; });

// ---------------- 9. major collapse ----------------
await page.evaluate(() => {
  const b = window.__tower;
  for (let i = 0; i < b.N; i++) { const [x, y] = b.coords(i); if (y <= 1 && b.alive[i] && x < b.nx - 1) b.removeCell(i, 1); }
});
await tick(100);
await shot('09_collapse', { pos: [-70, 30, tower.cz + 70], look: [tower.x0 + 16, 35, tower.cz], fov: 60 });
await page.evaluate(() => { window.__game._shotFreeze = false; });
await tick(200);

// ---------------- 10. heavily destroyed city ----------------
await page.evaluate(() => {
  const c = window.__ctx;
  // knock out the bases of most remaining buildings: the structural sim brings them down
  c.city.buildings.forEach((b, k) => { if (k % 4 === 3) return; for (let i = 0; i < b.N; i++) { const [, y] = b.coords(i); if (y === 0 && b.alive[i] && Math.random() < 0.7) b.removeCell(i, 0); } });
});
for (let i = 0; i < 6; i++) await tick(120);
const dPct = await page.evaluate(() => window.__ctx.city.destroyedPercent);
console.log('   destroyed %', dPct.toFixed(1), ' (internal only)');
await shot('10_ruins', { pos: [-190, 120, 300], look: [10, 30, 20], fov: 55 });
const darkNow = await page.evaluate(() => {
  const c = window.__ctx; let on = 0, tot = 0;
  for (const b of c.city.buildings) for (let i = 0; i < b.N; i++) if (b.exists[i] && b.alive[i]) { tot++; if (b.power[i] > 0.99) on++; }
  return { on, tot };
});
check('ruined city has lost most of its light', darkNow.on / Math.max(1, darkNow.tot) < lit0.on / lit0.tot - 0.2, JSON.stringify(darkNow));
await page.evaluate(() => { window.__game._shotFreeze = false; });

// ---------------- 11. victory ----------------
await page.evaluate(() => { const c = window.__ctx; window.__forceWin = c.city.destroyedPercent; });
const won = await page.evaluate(() => {
  const G = window.__game, c = window.__ctx;
  // finish the job: keep demolishing until the objective is reached
  let guard = 0;
  while (c.city.destroyedPercent < 60 && guard++ < 40) {
    for (const b of c.city.buildings) for (let i = 0; i < b.N && c.city.destroyedPercent < 60; i++) if (b.alive[i] && Math.random() < 0.4) b.removeCell(i, 0);
    G.tick(10);
  }
  G.tick(30);
  return { state: G.state, retreat: c.military.retreat };
});
check('victory triggers (military retreats)', won.state === 'won' && won.retreat, JSON.stringify(won));
await tick(60 * 7);
await shot('11_victory');
const v2 = await page.evaluate(() => ({ ready: window.__game.level.endReady, lamps: window.__ctx.props.litLamps, lightsOn: window.__ctx.props.types.lamp.items.filter((it) => it.light && it.light.on > 0).length }));
check('victory: power fails across the city; restart becomes available', v2.ready && v2.lightsOn < 25, JSON.stringify(v2));
await noHud('victory');
// restart with A
await page.evaluate(() => { window.__pad.buttons[0] = { pressed: true, value: 1 }; }); await tick(3); await page.evaluate(() => { window.__pad.buttons[0] = { pressed: false, value: 0 }; }); await tick(10);
const rs = await page.evaluate(() => ({ state: window.__game.state, hp: window.__ctx.gorilla.health, fade: document.getElementById('fade').style.opacity }));
check('restart from victory with A', rs.state === 'playing' && rs.hp === 100, JSON.stringify(rs));
await noHud('after restart');

// ---------------- 12. defeat ----------------
await tick(30);
await page.evaluate(() => { const g = window.__ctx.gorilla; g.invuln = 0; for (let i = 0; i < 25; i++) g.damage(5, 'test', g.pos.clone().add({ x: 20, y: 8, z: 10 })); });
await tick(60 * 6);
const lost = await page.evaluate(() => ({ state: window.__game.state, ready: window.__game.level.endReady, cease: window.__ctx.military.ceaseFire }));
check('defeat plays out (collapse, cease-fire, restart ready)', lost.state === 'lost' && lost.ready && lost.cease, JSON.stringify(lost));
await shot('12_defeat');
await noHud('defeat');
// mid-game restart must not happen on a tap: tap Back, still playing
await page.evaluate(() => { window.__pad.buttons[0] = { pressed: true, value: 1 }; }); await tick(3); await page.evaluate(() => { window.__pad.buttons[0] = { pressed: false, value: 0 }; }); await tick(10);
await page.evaluate(() => { window.__pad.buttons[8] = { pressed: true, value: 1 }; }); await tick(10); await page.evaluate(() => { window.__pad.buttons[8] = { pressed: false, value: 0 }; }); await tick(30);
const tap = await page.evaluate(() => ({ state: window.__game.state, t: window.__game.level.time }));
check('tapping Back does not restart during play', tap.state === 'playing' && tap.t > 0.5, JSON.stringify(tap));
await page.evaluate(() => { window.__pad.buttons[8] = { pressed: true, value: 1 }; }); await tick(80);
const held = await page.evaluate(() => ({ state: window.__game.state, t: window.__game.level.time }));
await page.evaluate(() => { window.__pad.buttons[8] = { pressed: false, value: 0 }; });
check('holding Back restarts', held.t < 0.5, JSON.stringify(held));

const failed = results.filter((r) => !r.pass);
console.log(`RESULT ${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.name).join(' | ') : ''}`);
console.log('errors:', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
