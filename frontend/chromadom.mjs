import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const EMAIL = 'reader-e2e-1792931823@test.local';
const PASSWORD = 'ReaderTest123';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 120000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"], button:has-text("Войти")');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40000 });

const scanPage = async (url, label) => {
  await page.goto(url, { waitUntil: 'load', timeout: 150000 });
  await page.waitForTimeout(3000);
  return page.evaluate((lbl) => {
    function parse(c) {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    }
    function classify(col) {
      const { r, g, b, a } = col;
      if (a < 0.04) return null;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx === 0) return null;
      const sat = (mx - mn) / mx;
      // тёплое (бумага/чернила) и нейтральное — не интересно
      const warm = r >= g && g >= b;
      if (warm) return null;
      if (sat < 0.10) return null;
      return { sat: +sat.toFixed(3), rgb: `rgb(${r},${g},${b})`, alpha: +a.toFixed(2) };
    }

    const hits = [];
    for (const el of document.querySelectorAll('.reader-stage *, .reader-viewport, .reader-viewport::after')) {
      if (!(el instanceof HTMLElement)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      const fields = {
        backgroundColor: cs.backgroundColor,
        borderTopColor: cs.borderTopColor,
        borderBottomColor: cs.borderBottomColor,
        borderLeftColor: cs.borderLeftColor,
        borderRightColor: cs.borderRightColor,
        outlineColor: cs.outlineColor,
        color: cs.color,
        backgroundImage: cs.backgroundImage,
      };
      for (const [name, value] of Object.entries(fields)) {
        if (name === 'color') continue; // цвет текста — не «линия»
        if (name === 'backgroundImage') {
          // градиенты с насыщенным цветом
          const rgbs = [...String(value).matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').map(Number));
          for (const p of rgbs) {
            const c = classify({ r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] });
            if (c) hits.push({ el: el.className || el.tagName, prop: 'backgroundImage', ...c, value: String(value).slice(0, 90), rect: { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) } });
          }
          continue;
        }
        const c = parse(value);
        if (!c) continue;
        const k = classify(c);
        if (k) hits.push({ el: el.className || el.tagName, prop: name, ...k, value, rect: { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) } });
      }
    }
    return { label: lbl, hits };
  }, label);
};

const out = [];
out.push(await scanPage(`${BASE}/reader/60`, 'reader sepia default'));
// Светлая тема
await page.evaluate(() => {
  const stage = document.querySelector('.reader-stage');
  if (stage) stage.dataset.readerTheme = 'day';
});
await page.waitForTimeout(600);
out.push({ label: 'reader day', hits: (await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('.reader-stage *')) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const cs = getComputedStyle(el);
    const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor || '');
    if (!m) continue;
    const p = m[1].split(',').map(Number);
    const a = p[3] === undefined ? 1 : p[3];
    if (a < 0.04) continue;
    const mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]);
    if (mx === 0 || (mx - mn) / mx < 0.1) continue;
    if (p[0] >= p[1] && p[1] >= p[2]) continue;
    hits.push({ el: el.className || el.tagName, rgb: `rgb(${p[0]},${p[1]},${p[2]})`, a, rect: { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) } });
  }
  return hits;
})).hits });

out.push(await scanPage(`${BASE}/reader-lab`, 'reader-lab'));

writeFileSync(path.resolve('.tmp', 'shots', 'chroma-dom.json'), JSON.stringify(out, null, 2));
for (const r of out) {
  console.log(`\n### ${r.label} — найдено ${r.hits.length}`);
  for (const h of r.hits) {
    console.log(`   [${h.prop}] ${h.el} ${h.rgb} sat=${h.sat} a=${h.alpha ?? h.a} rect x=${h.rect.x} y=${h.rect.y} w=${h.rect.w} h=${h.rect.h}`);
  }
}
await browser.close();