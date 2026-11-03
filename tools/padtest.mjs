// Automated play-test driven through a virtual gamepad (navigator.getGamepads stub).
// Runs the game in deterministic ?test=1 mode: time advances only via __game.tick().
// Usage: node tools/padtest.mjs [outDir]   (dev server must be running on :5173)
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
const press = async (i, holdFrames = 4, after = 30) => { await btn(i, true); await tick(holdFrames); await btn(i, false); await tick(after); };
const shot = async (name) => { await page.evaluate(() => window.__game.renderOnce()); await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); };
const state = () => page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  return {
    pos: g.pos.toArray().map((v) => +v.toFixed(1)), yaw: +g.yaw.toFixed(2), speed: +g.speed.toFixed(1), st: g.state, action: g.action?.name ?? null,
    hp: +g.health.toFixed(1), destroyed: +c.city.destroyedPercent.toFixed(2), cells: c.stats.destroyedCells,
    sections: c.city.buildings.reduce((n, b) => n + b.sections.length, 0), collapsed: c.stats.collapsed,
    level: c.military.level, mil: c.military.activeCounts, device: window.__game.input.lastDevice,
    rumbles: (window.__rumbles || []).length, held: g.held?.kind ?? null, eaten: c.stats.eaten, game: window.__game.state,
  };
});
const log = async (label) => console.log(label.padEnd(14), JSON.stringify(await state()));

await log('start');
await axis(1, -1); await tick(120); await log('L-stick fwd 2s');
await axis(1, -0.4); await tick(60); await log('half tilt 1s');
await axis(1, -1); await btn(4, true); await tick(120); await log('LB sprint 2s');
await axis(1, 0); await btn(4, false); await tick(60); await log('release');
const yaw0 = await page.evaluate(() => window.__ctx.cameraRig.yaw);
await axis(2, 1); await tick(45); await axis(2, 0);
console.log('R-stick right: camera yaw', yaw0.toFixed(2), '->', (await page.evaluate(() => window.__ctx.cameraRig.yaw)).toFixed(2));
await press(0, 3, 70); await log('A jump');
// line up on the showcase tower (east of the start road)
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  g.pos.set(7, 0, 115); g.vel.set(0, 0, 0); g.yaw = Math.PI / 2;
  c.cameraRig.yaw = Math.PI / 2; c.cameraRig.pitch = -0.12;
});
await tick(20);
for (let i = 0; i < 4; i++) await press(7, 3, 30);
await log('RT punch x4');
await shot('pad_punch');
for (let i = 0; i < 3; i++) await press(6, 3, 62);
await log('LT smash x3');
await press(1, 3, 60); await log('B stomp');
let collapsed = false;
for (let i = 0; i < 40 && !collapsed; i++) {
  // step into the hole, then hit again (like a player would)
  await axis(1, -1); await tick(12); await axis(1, 0);
  await press(i % 3 === 2 ? 6 : 7, 3, i % 3 === 2 ? 62 : 32);
  const s = await state();
  if (s.sections > 0) { collapsed = true; console.log('collapse after', i + 1, 'more hits', JSON.stringify(s)); }
}
await log('pounding');
await tick(70); await shot('pad_collapse_a');
await tick(120); await shot('pad_collapse_b');
await log('after collapse');
// grab + eat
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  const h = c.crowd.people.find((p) => p.state !== 'dead' && p.state !== 'held');
  h.x = g.pos.x + Math.sin(g.yaw) * 7; h.z = g.pos.z + Math.cos(g.yaw) * 7; h.y = 0; h.state = 'walk';
});
await press(2, 3, 45); await log('X grab');
await shot('pad_hold');
await press(2, 3, 85); await log('X eat');
// grab a car and throw it with RT at the tower
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  const car = c.traffic.cars.find((k) => k.state === 'parked' || k.state === 'drive' || k.state === 'abandoned');
  car.state = 'abandoned'; car.x = g.pos.x + Math.sin(g.yaw) * 7; car.z = g.pos.z + Math.cos(g.yaw) * 7; car.y = 0;
});
await press(2, 3, 45); await log('X grab car');
await press(7, 3, 90); await log('RT throw');
// aim assist: a chopper hovering above-front; jump (A) then punch (RT)
await page.evaluate(() => {
  const c = window.__ctx, g = c.gorilla;
  if (!c.military.helis.length) c.military._spawnHeli();
  const h = c.military.helis[0];
  h.state = 'fly'; h.x = g.pos.x + Math.sin(g.yaw) * 9 + 3; h.z = g.pos.z + Math.cos(g.yaw) * 9; h.y = g.pos.y + 19;
  h.vx = h.vy = h.vz = 0; h.swoop = 99; h.orbitR = 10;
  c.cameraRig.yaw = g.yaw;
});
await btn(0, true); await tick(3); await btn(0, false); await tick(10);
await press(7, 3, 40);
console.log('heli after jump+RT:', await page.evaluate(() => window.__ctx.military.helis.map((h) => h.state).join(',')), 'helis killed', await page.evaluate(() => window.__ctx.stats.helis));
await tick(150); await shot('pad_heli');
// pause / resume with Start, restart with Back
await press(9, 2, 2); console.log('Start ->', (await state()).game);
await press(9, 2, 2); console.log('Start ->', (await state()).game);
// let the military arrive and fight for a while
await tick(60 * 25); await log('25s later');
await shot('pad_fight');
const r = await page.evaluate(() => (window.__rumbles || []).slice(-3));
console.log('last rumbles', JSON.stringify(r));
await press(8, 2, 5); await log('Back restart');
console.log('errors:', errors.length ? errors.slice(0, 5).join('\n---\n') : 'none');
await browser.close();
