// Renders fixed viewpoints for lighting/look review.
// Usage: node tools/looktest.mjs <outDir> [extraQuery]   e.g. "tm=aces&exp=0.9"
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const out = process.argv[2] || '.';
const extra = process.argv[3] ? '&' + process.argv[3] : '';
const tag = process.argv[4] || 'look';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:5173/?test=1${extra}`);
await page.waitForFunction(() => window.__game && window.__game.state === 'playing', null, { timeout: 120000 });
await page.evaluate(() => window.__game.tick(30));

const views = {
  street: { cam: [-6, 9, 178], look: [14, 22, 110] },
  aerial: { cam: [-120, 150, 260], look: [0, 0, 40] },
  gorilla: { cam: [14, 13, 168], look: [0, 9, 150] },
};
const which = (process.env.VIEWS || 'street,aerial,gorilla,dust').split(',');
for (const name of which) {
  if (name === 'dust') {
    await page.evaluate(() => {
      const c = window.__ctx; const g = c.gorilla;
      g.pos.set(7, 0, 115); g.yaw = Math.PI / 2; c.cameraRig.yaw = Math.PI / 2; c.cameraRig.pitch = -0.1;
      // knock out the tower's base to trigger a collapse
      const b = c.city.buildings.find((b) => b.inFootprint(20, 110));
      for (let i = 0; i < b.N; i++) { const [x, y] = b.coords(i); if (y === 0 && x < 4 && b.alive[i]) b.removeCell(i, 1); }
    });
    await page.evaluate(() => window.__game.tick(150));
    await page.evaluate(() => { const c = window.__ctx; const cam = window.__game.renderer.camera; cam.position.set(-40, 40, 175); cam.lookAt(25, 25, 112); });
  } else {
    const v = views[name];
    await page.evaluate((v) => {
      window.__game.state = 'title'; // freeze gameplay camera
      const cam = window.__game.renderer.camera;
      cam.position.set(...v.cam); cam.lookAt(...v.look); cam.updateMatrixWorld();
      window.__game.renderer.updateShadowFocus({ x: v.look[0], y: 0, z: v.look[2] });
    }, v);
  }
  await page.evaluate(() => { window.__game.renderOnce(); window.__game.renderOnce(); });
  await page.screenshot({ path: `${out}/${tag}_${name}.png`, timeout: 120000 });
  await page.evaluate(() => { window.__game.state = 'playing'; });
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
