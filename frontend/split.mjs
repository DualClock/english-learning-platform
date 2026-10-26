import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
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

async function probe(url, label) {
  await page.goto(url, { waitUntil: 'load', timeout: 150000 });
  await page.waitForSelector('.reader-flow', { timeout: 60000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2000);

  const res = await page.evaluate(() => {
    const flow = document.querySelector('.reader-flow');
    const vp = document.querySelector('.reader-viewport').getBoundingClientRect();

    // 1) Слова, разорванные переносом: у диапазона слова больше одного rect.
    const splitWords = [];
    let wordCount = 0;
    for (const span of flow.querySelectorAll('[data-s]')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent;
      const re = /[A-Za-z\u00C0-\u024F']+/g;
      let m;
      while ((m = re.exec(text))) {
        wordCount++;
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length > 1) {
          // интересуют только слова в видимой области
          const inView = rects.some((r) => r.right > vp.left && r.left < vp.right);
          if (inView) {
            splitWords.push({
              word: m[0],
              pieces: rects.map((r) => ({ left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1) })),
            });
          }
        }
      }
    }

    // 2) Синтезированный дефис: диапазон «последняя буква + 1 символ» на строке
    //    уходит вправо дальше самой буквы на ширину дефиса.
    const hyphenEvidence = [];
    for (const span of flow.querySelectorAll('[data-s]')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent;
      for (let i = 0; i < text.length - 1; i++) {
        const a = document.createRange();
        a.setStart(node, i);
        a.setEnd(node, i + 1);
        const ra = a.getBoundingClientRect();
        if (!ra.width) continue;
        const b = document.createRange();
        b.setStart(node, i);
        b.setEnd(node, i + 2);
        const rb = b.getBoundingClientRect();
        // второй символ остался на той же строке, но правее с зазором > 1px
        if (Math.abs(rb.top - ra.top) < 2 && rb.right - ra.right > 1.2) {
          hyphenEvidence.push({
            ctx: text.slice(Math.max(0, i - 8), i + 3),
            gap: +(rb.right - ra.right).toFixed(2),
          });
        }
      }
    }

    // 3) Пробелы: justify сейчас vs left
    const measureGaps = () => {
      const gaps = [];
      for (const span of flow.querySelectorAll('[data-s]')) {
        const node = span.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.textContent;
        const chars = [];
        const range = document.createRange();
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          chars.push({ i, ch: text[i], left: r.left, right: r.right, top: Math.round(r.top * 2) / 2 });
        }
        const byLine = new Map();
        for (const c of chars) {
          const k = `${c.top}`;
          if (!byLine.has(k)) byLine.set(k, []);
          byLine.get(k).push(c);
        }
        for (const line of byLine.values()) {
          if (!(line[line.length - 1].right > vp.left && line[0].left < vp.right)) continue;
          for (let k = 1; k < line.length; k++) {
            if (line[k - 1].ch === ' ' || line[k].ch === ' ') gaps.push(+(line[k].left - line[k - 1].right).toFixed(2));
          }
        }
      }
      return gaps;
    };

    const gapsJustify = measureGaps();
    const para = flow.querySelector('.reader-paragraph');
    const before = para.style.textAlign;
    para.style.textAlign = 'left';
    const gapsLeft = measureGaps();
    para.style.textAlign = before || '';

    const stat = (a) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      return {
        n: a.length,
        min: +s[0].toFixed(2),
        p50: +s[Math.floor(s.length / 2)].toFixed(2),
        p90: +s[Math.floor(s.length * 0.9)].toFixed(2),
        max: +s[s.length - 1].toFixed(2),
        ratio: +(s[s.length - 1] / s[0]).toFixed(2),
      };
    };

    return {
      wordCount,
      splitWords: splitWords.slice(0, 30),
      splitCount: splitWords.length,
      hyphenEvidence: hyphenEvidence.slice(0, 20),
      hyphenEvidenceCount: hyphenEvidence.length,
      gapsJustify: stat(gapsJustify),
      gapsLeft: stat(gapsLeft),
      colW: +parseFloat(flow.style.columnWidth).toFixed(1),
    };
  });
  console.log(`\n########## ${label} (${url}) ##########`);
  console.log(JSON.stringify(res, null, 2));
  return res;
}

const all = [];
all.push(await probe(`${BASE}/reader/60`, 'The Lost Kitten (детская книга)'));
all.push(await probe(`${BASE}/reader/61`, 'Alice (плотный текст)'));

writeFileSync(path.join(OUT, 'split-report.json'), JSON.stringify(all, null, 2));
await browser.close();