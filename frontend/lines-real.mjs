import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const OUT = path.resolve('.tmp', 'shots');
mkdirSync(OUT, { recursive: true });
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
await page.goto(`${BASE}/reader/60`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow', { timeout: 60000 });
await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const flow = document.querySelector('.reader-flow');
  const vp = document.querySelector('.reader-viewport').getBoundingClientRect();

  function analyzeBlock(block) {
    const lines = [];
    let cur = null;
    for (const span of block.querySelectorAll('[data-s]')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent;
      const range = document.createRange();
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        // вне видимой страницы не интересует
        const onScreen = r.right > vp.left - 1 && r.left < vp.right + 1;
        if (!cur || Math.abs(r.top - cur.top) > 3) {
          cur = { top: r.top, left: r.left, right: r.right, text: text[i], onScreen, ch: [] };
          lines.push(cur);
        } else {
          cur.right = Math.max(cur.right, r.right);
          cur.left = Math.min(cur.left, r.left);
          cur.text += text[i];
          cur.onScreen = cur.onScreen || onScreen;
        }
        cur.ch.push({ ch: text[i], left: r.left, right: r.right, w: r.width });
      }
    }
    return lines;
  }

  const blocks = Array.from(flow.querySelectorAll('.reader-block'));
  const out = [];
  for (const b of blocks) {
    const lines = analyzeBlock(b).filter((l) => l.onScreen);
    for (const l of lines) {
      // пробелы внутри строки
      const gaps = [];
      for (let i = 1; i < l.ch.length; i++) {
        const prev = l.ch[i - 1];
        const next = l.ch[i];
        const gap = next.left - prev.right;
        if (prev.ch === ' ' || next.ch === ' ') {
          gaps.push(+gap.toFixed(2));
        }
      }
      out.push({
        type: b.getAttribute('data-block') || b.className,
        text: l.text,
        width: +(l.right - l.left).toFixed(1),
        endsHyphen: l.text.trimEnd().endsWith('-'),
        lastWord: l.text.trimEnd().split(/\s+/).pop(),
        wordGapMin: gaps.length ? Math.min(...gaps) : null,
        wordGapMax: gaps.length ? Math.max(...gaps) : null,
      });
    }
  }
  return {
    viewport: { left: +vp.left.toFixed(1), right: +vp.right.toFixed(1), width: +vp.width.toFixed(1) },
    lineCount: out.length,
    lines: out,
  };
});

writeFileSync(path.join(OUT, 'lines-real.json'), JSON.stringify(report, null, 2));
console.log('viewport', JSON.stringify(report.viewport));
console.log('lines on page:', report.lineCount);

// Ищем подозрительное: переносы, огромные пробелы, обрезанные слова
const susp = report.lines.filter((l) => l.endsHyphen || (l.wordGapMax && l.wordGapMax > 9));
console.log('\nподозрительные строки:', susp.length);
for (const l of susp.slice(0, 25)) {
  console.log(`  [${l.type}] w=${l.width} gapMax=${l.wordGapMax} hyphen=${l.endsHyphen} :: ${JSON.stringify(l.text.slice(0, 90))}`);
}

console.log('\nвсе строки страницы:');
for (const l of report.lines) {
  console.log(`  w=${String(l.width).padStart(6)} gap=${l.wordGapMin}-${l.wordGapMax} [${l.type}] ${JSON.stringify(l.text.slice(0, 95))}`);
}

await browser.close();
