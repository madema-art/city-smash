// Vertical-gameplay play-test, driven through a virtual gamepad in deterministic ?test=1 mode.
// Usage: node tools/elevtest.mjs [outDir]   (dev server must be running on :5173)
//
// 1 attach to a skyscraper · 2 climb to ~10th floor · 3 hold position · 4 traverse the facade
// 5 punch a hole at that height · 6 grab + eat a person from a window · 7 keep climbing
// 8 swat a helicopter from the wall (+ leap at a second one, re-grab the tower mid-air)
// 9 climb onto the roof · 10 jump off and resume ground play. Camera is checked at every step.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const out = process.argv[2] || '.';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => {
  const pad = {
    id: 'Virtual Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    vibrationActuator: { effects: ['dual-rumble'], playEffect: (t, o) => { (window.__rumbles ||= []).push(o); return Promise.resolve('complete'); } },
  };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
});
await page.goto('http://localhost:5173/?test=1&low=1');
await page.waitForFunction(() => window.__game && window.__game.state === 'playing', null, { timeout: 120000 });

const tick = (n) => page.evaluate((n) => window.__game.tick(n), n);
const btn = (i, v) => page.evaluate(([i, v]) => { window.__pad.buttons[i] = { pressed: v, value: v ? 1 : 0 }; }, [i, v]);
const axis = (i, v) => page.evaluate(([i, v]) => { window.__pad.axes[i] = v; }, [i, v]);
const press = async (i, after = 30) => { await btn(i, true); await tick(3); await btn(i, false); await tick(after); };
const shot = async (name) => { await page.evaluate(() => window.__game.renderOnce()); await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); };
const A = 0, B = 1, X = 2, Y = 3, RT = 7, LT = 6;

const state = () => page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla, cl = g.climb;
  return {
    st: g.state, pos: g.pos.toArray().map((v) => +v.toFixed(1)), face: cl ? [cl.nx, cl.nz] : null,
    action: g.action?.name ?? null, held: g.held?.kind ?? null, hp: +g.health.toFixed(1), eaten: c.stats.eaten, helis: c.stats.helis,
  };
});
// camera sanity: distance, not inside a building, monster not occluded, on the open side of the wall
const cam = (label) => page.evaluate((label) => {
  const c = window.__ctx, g = c.gorilla, cam = window.__game.renderer.camera;
  const chest = g.pos.clone(); chest.y += 10;
  const d = cam.position.distanceTo(chest);
  const inside = c.city.solidAt(cam.position.x, cam.position.y, cam.position.z);
  const dir = chest.clone().sub(cam.position).normalize();
  const blocked = c.city.raycast(cam.position, dir, Math.max(0, d - 6), 1);
  const cl = g.climb;
  let side = null;
  if (cl) side = +((cl.nx ? cam.position.x - cl.wall : cam.position.z - cl.wall) * (cl.nx || cl.nz)).toFixed(1);
  const ok = d > 12 && d < 70 && !inside && blocked < 0 && (side === null || side > 4);
  return { label, ok, dist: +d.toFixed(1), inside, occluded: blocked >= 0, wallSide: side, camY: +cam.position.y.toFixed(1), pitch: +c.cameraRig.pitch.toFixed(2) };
}, label);
const results = [];
const check = async (n, name, cond, extra = {}) => {
  const s = await state();
  const cm = await cam(name);
  const pass = cond(s) && cm.ok;
  results.push({ n, name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(n).padStart(2)} ${name.padEnd(28)} ${JSON.stringify({ ...s, ...extra })}\n        camera ${JSON.stringify(cm)}`);
  return s;
};

// keep the harness focused on climbing: the monster can't die during the scripted run
const setup = await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  g.invuln = 1e9;
  const b = c.city.buildings.find((b) => b.inFootprint(20, 110));
  window.__tower = b;
  g.pos.set(b.x0 - 5, 0, b.cz); g.yaw = Math.PI / 2;
  c.cameraRig.yaw = Math.PI / 2; c.cameraRig.pitch = -0.1;
  return { tower: { x0: b.x0, z0: b.z0, w: b.width, d: b.depth, floors: b.ny } };
});
console.log('tower', JSON.stringify(setup.tower));
await tick(20);

// 1. attach
await press(Y, 30);
await check(1, 'attach to skyscraper', (s) => s.st === 'climb' && s.face && s.face[0] === -1);

// 2. climb to ~10th floor (chest at floor 10 ⇒ root ≈ 27 m)
await axis(1, -1);
for (let i = 0; i < 80; i++) { await tick(10); if ((await state()).pos[1] >= 27) break; }
await axis(1, 0);
await tick(20);
const s2 = await check(2, 'climb to ~10th floor', (s) => s.st === 'climb' && s.pos[1] >= 26 && s.pos[1] < 34);
await shot('elev_02_climb');

// 3. hold position
await tick(120);
const s3 = await check(3, 'hold position (2 s)', (s) => s.st === 'climb' && Math.abs(s.pos[1] - s2.pos[1]) < 0.3);

// 4. traverse right along the facade
await axis(0, 1); await tick(70); await axis(0, 0); await tick(20);
await check(4, 'traverse facade', (s) => s.st === 'climb' && Math.abs(s.pos[2] - s3.pos[2]) > 4 && Math.abs(s.pos[1] - s3.pos[1]) < 1);

// 5. punch a hole in the facade at this height
const floorsBefore = await page.evaluate(() => { const b = window.__tower; const f = new Array(b.ny).fill(0); for (let i = 0; i < b.N; i++) if (b.exists[i] && !b.alive[i]) f[b.coords(i)[1]]++; return f; });
for (let i = 0; i < 3; i++) await press(RT, 26);
await tick(10);
const floorsAfter = await page.evaluate(() => { const b = window.__tower; const f = new Array(b.ny).fill(0); for (let i = 0; i < b.N; i++) if (b.exists[i] && !b.alive[i]) f[b.coords(i)[1]]++; return f; });
const delta = floorsAfter.map((v, i) => v - floorsBefore[i]);
const hitFloors = delta.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
console.log('   destroyed cells per floor index:', JSON.stringify(delta));
await check(5, 'punch hole at 10th floor', () => hitFloors.length > 0 && Math.min(...hitFloors) >= 7 && Math.max(...hitFloors) <= 12 && delta[0] === 0, { floorsHit: hitFloors });
await shot('elev_05_punch');

// 6. grab and eat a person from a window
await page.evaluate(() => { window.__ctx.gorilla.health = 70; });
let cands = 0;
for (let i = 0; i < 30 && !cands; i++) {
  await tick(15);
  cands = await page.evaluate(() => { const g = window.__ctx.gorilla; return window.__ctx.windows.grabCandidates(g.pos, g.climb, 12).length; });
}
console.log('   window candidates in reach:', cands);
await press(X, 30);
const sHeld = await state();
await shot('elev_06_grab');
await press(X, 75);
await check(6, 'grab + eat from window', (s) => sHeld.held === 'person' && s.held === null && s.eaten >= 1 && s.hp > 70, { heldAfterGrab: sHeld.held });

// 7. keep climbing
const s6 = await state();
await axis(1, -1); await tick(60); await axis(1, 0); await tick(10);
await check(7, 'continue climbing', (s) => s.st === 'climb' && s.pos[1] > s6.pos[1] + 4);

// 8. swat a helicopter flying past the facade
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla, m = c.military;
  m._spawnHeli();
  const h = m.helis[m.helis.length - 1];
  h.x = g.pos.x - 11; h.y = g.pos.y + 12; h.z = g.pos.z + 3; h.vx = h.vy = h.vz = 0; h.swoop = 6; h.state = 'fly';
  window.__heli = h;
});
await tick(5);
await press(RT, 40);
const heliState = await page.evaluate(() => window.__heli.state);
await tick(30);
await shot('elev_08_swat');
await check(8, 'swat helicopter from wall', () => heliState !== 'fly', { heli: heliState });
await tick(90);

// 8b. leap at a second chopper, punch it mid-air, then re-grab the tower on the way down
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla, m = c.military;
  m._spawnHeli();
  const h = m.helis[m.helis.length - 1];
  h.x = g.pos.x - 24; h.y = g.pos.y + 14; h.z = g.pos.z; h.vx = h.vy = h.vz = 0; h.swoop = 0; h.swoopCd = 99; h.orbitR = 24; h.state = 'fly';
  window.__heli2 = h;
  c.cameraRig.yaw = -Math.PI / 2; c.cameraRig.pitch = 0.25; // look out at it
});
await tick(2);
await press(A, 18);
for (let i = 0; i < 6; i++) { await press(RT, 6); if ((await page.evaluate(() => window.__heli2.state)) !== 'fly') break; }
const heli2 = await page.evaluate(() => window.__heli2.state);
console.log(`${heli2 !== 'fly' ? 'PASS' : 'FAIL'}  8b leap + mid-air punch       heli2=${heli2}`);
results.push({ n: '8b', name: 'leap at helicopter', pass: heli2 !== 'fly' });
// steer back to the tower and grab on mid-air (or from the street)
await page.evaluate(() => { const c = window.__ctx; c.cameraRig.yaw = Math.PI / 2; c.cameraRig.pitch = -0.1; });
await axis(1, -1);
for (let i = 0; i < 40; i++) { await tick(6); const s = await state(); if (s.st === 'climb') break; if (s.st === 'ground') { await press(Y, 10); } }
await axis(1, 0);
await tick(20);
await check('8c', 're-grab tower after leap', (s) => s.st === 'climb');

// 9. climb onto the roof (setback ledges: haul up, then grab the next tier)
await page.evaluate(() => { const c = window.__ctx; c.cameraRig.yaw = Math.PI / 2; });
let mantles = 0;
for (let i = 0; i < 160; i++) {
  const s = await state();
  if (s.st === 'ground' && s.pos[1] > 88) break;
  if (s.st === 'ground') {
    mantles++;
    // on a setback ledge: walk to the next wall and climb it
    await axis(1, -1); await tick(25); await axis(1, 0);
    await press(Y, 10);
    continue;
  }
  await axis(1, -1); await tick(12);
}
await axis(1, 0); await tick(30);
await shot('elev_09_roof');
await check(9, 'climb onto the roof', (s) => s.st === 'ground' && s.pos[1] > 88, { ledges: mantles });

// 10. jump off and return to ground gameplay
// walk to the north edge (above the avenue) and step off with a jump
await page.evaluate(() => { const c = window.__ctx; c.cameraRig.yaw = Math.PI; c.cameraRig.pitch = -0.2; });
await axis(1, -0.35); // creep to the edge so the fall lands in the avenue, not on the next roof
let leftRoof = false;
for (let i = 0; i < 120; i++) {
  await tick(6);
  const s = await state();
  if (!leftRoof && s.st === 'ground' && s.pos[2] < 101.5) await press(A, 2);
  if (s.st === 'air') leftRoof = true;
  if (leftRoof && s.st === 'ground' && s.pos[1] < 20) break;
}
await axis(1, 0);
await tick(30);
await shot('elev_10_landed');
const s10 = await check(10, 'jump off, back on the street', (s) => s.st === 'ground' && s.pos[1] < 12 && leftRoof);
await page.evaluate(() => { window.__ctx.cameraRig.yaw = Math.PI / 2; }); // walk along the avenue
await axis(1, -1); await tick(60); await axis(1, 0);
await check('10b', 'ground movement resumes', (s) => s.st === 'ground' && Math.hypot(s.pos[0] - s10.pos[0], s.pos[2] - s10.pos[2]) > 5);

const rum = await page.evaluate(() => (window.__rumbles || []).length);
console.log(`\nrumble effects played: ${rum}`);
const failed = results.filter((r) => !r.pass);
console.log(`RESULT ${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.n).join(', ') : ''}`);
console.log('errors:', errors.length ? errors.slice(0, 5).join('\n---\n') : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
