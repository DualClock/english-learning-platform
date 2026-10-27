import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.resolve('.tmp', 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const [name, vp] of [
  ['desktop', { width: 1440, height: 900 }],
  ['laptop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
  ['tablet', { width: 834, height: 1112 }],
]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/reader-lab`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.reader-flow[aria-hidden="false"]', { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });

  const info = await page.evaluate(() => {
    const flow = document.querySelector('.reader-flow');
    const vp2 = document.querySelector('.reader-viewport');
    const sheet = document.querySelector('.reader-sheet');
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), t: Math.round(b.top), b: Math.round(b.bottom) }; };
    const cs = getComputedStyle(flow.querySelector('.reader-paragraph'));
    return {
      viewport: { w: innerWidth, h: innerHeight },
      sheet: r(sheet),
      viewportBox: r(vp2),
      textLeft: Math.round(flow.querySelector('.reader-paragraph').getBoundingClientRect().left),
      textRight: Math.round(flow.querySelector('.reader-paragraph').getBoundingClientRect().right),
      align: cs.textAlign, hyphens: cs.hyphens, textIndent: cs.textIndent, fontSize: cs.fontSize,
    };
  });
  console.log(name, JSON.stringify(info));
  await page.close();
}

// Крупный фрагмент текста для визуальной оценки кегля/переносов
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
await page.goto(`${BASE}/reader-lab`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow[aria-hidden="false"]', { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);
const box = await page.evaluate(() => {
  const p = document.querySelector('.reader-paragraph');
  const b = p.getBoundingClientRect();
  return { x: Math.max(0, b.left - 10), y: Math.max(0, b.top - 10), width: Math.min(b.width + 20, 700), height: Math.min(b.height + 20, 400) };
});
await page.screenshot({ path: path.join(OUT, 'text-crop.png'), clip: box });
await browser.close();
console.log('done');
