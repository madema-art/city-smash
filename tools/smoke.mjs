// Quick smoke test: boots the game in deterministic test mode, plays a few seconds with some
// actions, renders a frame and reports any page errors. Usage: node tools/smoke.mjs [out.png]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
const out = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/?test=1&low=1');
await page.waitForFunction(() => window.__game && (window.__game.state === 'playing' || window.__game.state === 'loading'), null, { timeout: 120000 }).catch(() => {});
const info = await page.evaluate(() => {
  const G = window.__game; if (!G || G.state !== 'playing') return { state: G && G.state };
  const I = G.input, c = window.__ctx, g = c.gorilla;
  I.held.add('KeyW'); G.tick(90); I.held.delete('KeyW');
  I.injectButton(0); G.tick(40); I.injectButton(2); G.tick(70); I.inject('KeyF'); G.tick(70);
  g.damage(30, 'test', g.chest.clone().add({ x: 0, y: 0, z: -5 })); G.tick(30);
  G.renderOnce();
  return { state: G.state, hp: g.health, wound: +g.woundVis.toFixed(2), lit: c.props.litLamps, mil: c.military.level };
});
if (out) await page.screenshot({ path: out, timeout: 120000 });
console.log(JSON.stringify(info));
console.log('errors:', errors.length ? errors.slice(0, 6).join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
