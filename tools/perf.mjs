// CPU-side cost per simulated frame (gameplay, AI, physics, destruction, light field) during a
// busy scene. Rendering cost cannot be measured meaningfully in headless software GL.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:5173/?test=1&low=1');
await page.waitForFunction(() => window.__game && window.__game.state === 'playing', null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const G = window.__game, c = window.__ctx, g = c.gorilla;
  g.invuln = 1e9;
  c.military.level = 5;
  G.tick(60 * 10); // let the response build up
  const t0 = performance.now(); G.tick(300); const calm = (performance.now() - t0) / 300;
  // trigger a big collapse + fires while fighting
  const b = c.city.buildings.find((b) => b.inFootprint(20, 110));
  for (let i = 0; i < b.N; i++) { const [, y] = b.coords(i); if (y === 0 && b.alive[i]) b.removeCell(i, 1); }
  const t1 = performance.now(); G.tick(300); const busy = (performance.now() - t1) / 300;
  return { calmMsPerFrame: +calm.toFixed(2), collapseMsPerFrame: +busy.toFixed(2), police: c.police.active, helis: c.military.activeCounts.helis, tanks: c.military.activeCounts.tanks, soldiers: c.military.activeCounts.soldiers, fires: c.fires.list.length, debris: c.debris.items.length };
});
console.log(JSON.stringify(r));
await browser.close();
