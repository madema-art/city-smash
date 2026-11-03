// Usage: node tools/shot.mjs "<url query>" out.png [waitMs] [w] [h]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
const [,, query = '', out = 'shot.png', wait = '4000', w = '1400', h = '700'] = process.argv;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:5173/${query}`);
await page.waitForTimeout(+wait);
if (process.env.EVAL) { const r = await page.evaluate(process.env.EVAL); if (r !== undefined) console.log('EVAL:', JSON.stringify(r)); }
if (process.env.WAIT2) await page.waitForTimeout(+process.env.WAIT2);
console.log(logs.slice(0, 40).join('\n'));
await page.screenshot({ path: out, timeout: 120000 });
await browser.close();
