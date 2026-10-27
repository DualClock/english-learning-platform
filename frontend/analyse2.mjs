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

const analyse = () =>
  page.evaluate(() => {
    const flow = document.querySelector('.reader-flow');
    const vp = document.querySelector('.reader-viewport').getBoundingClientRect();
    const colW = parseFloat(flow.style.columnWidth) || vp.width;
    const flowLeft = flow.getBoundingClientRect().left;

    // Собираем ВСЕ символы с координатами, затем кластеризуем по (колонка, top).
    const chars = [];
    for (const span of flow.querySelectorAll('[data-s]')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent;
      const range = document.createRange();
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        chars.push({
          ch: text[i],
          left: r.left,
          right: r.right,
          top: Math.round(r.top * 2) / 2,
          col: Math.floor((r.left - flowLeft + 2) / colW),
          soft: text.charCodeAt(i) === 0xad,
        });
      }
    }

    const map = new Map();
    for (const c of chars) {
      const key = `${c.col}|${c.top}`;
      let line = map.get(key);
      if (!line) {
        line = { col: c.col, top: c.top, left: c.left, right: c.right, text: '', ch: [], soft: 0 };
        map.set(key, line);
      }
      line.left = Math.min(line.left, c.left);
      line.right = Math.max(line.right, c.right);
      line.text += c.ch;
      line.soft += c.soft ? 1 : 0;
      line.ch.push(c);
    }

    const lines = [...map.values()]
      .filter((l) => l.right > vp.left && l.left < vp.right)
      .sort((a, b) => a.col - b.col || a.top - b.top);

    const result = lines.map((l) => {
      // пробельные интервалы
      const gaps = [];
      for (let i = 1; i < l.ch.length; i++) {
        if (l.ch[i - 1].ch === ' ' || l.ch[i].ch === ' ') {
          gaps.push(+(l.ch[i].left - l.ch[i - 1].right).toFixed(2));
        }
      }
      const trimmed = l.text.replace(/\s+$/, '');
      return {
        col: l.col,
        top: +l.top.toFixed(1),
        width: +(l.right - l.left).toFixed(1),
        text: l.text,
        tail: trimmed.slice(-22),
        startsWithHyphen: /^\s*-/.test(l.text),
        endsHyphen: /-$/.test(trimmed),
        soft: l.soft,
        gapMin: gaps.length ? Math.min(...gaps) : null,
        gapMax: gaps.length ? Math.max(...gaps) : null,
        gapAvg: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : null,
      };
    });
    return {
      colW: +colW.toFixed(1),
      vp: { left: +vp.left.toFixed(1), right: +vp.right.toFixed(1) },
      lineCount: result.length,
      totalChars: chars.length,
      softHyphens: chars.filter((c) => c.soft).length,
      lines: result,
    };
  });

const url = process.argv[2] || `${BASE}/reader/60`;
await page.goto(url, { waitUntil: 'load', timeout: 150000 });
await page.waitForSelector('.reader-flow', { timeout: 60000 });
await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2000);

await page.addStyleTag({ content: 'header, footer { display: none !important; }' });
await page.waitForTimeout(200);

const a = await analyse();
writeFileSync(path.join(OUT, 'lines-clean.json'), JSON.stringify(a, null, 2));

console.log(`colW=${a.colW} vp=${a.vp.left}..${a.vp.right} строк=${a.lineCount} символов=${a.totalChars} мягких переносов=${a.softHyphens}`);
const gaps = a.lines.filter((l) => l.gapMax !== null);
if (gaps.length) {
  const all = gaps.flatMap((l) => [l.gapMin, l.gapMax]);
  console.log(`пробелы: min=${Math.min(...all)} max=${Math.max(...all)}`);
}
const hyph = a.lines.filter((l) => l.endsHyphen);
console.log(`строк с дефисом в конце: ${hyph.length}`);
for (const l of hyph) console.log(`   col${l.col} w=${l.width} ... ${JSON.stringify(l.tail)}`);

console.log('\n-- строки по колонкам --');
for (const l of a.lines) {
  const flag = l.endsHyphen ? 'HYPH' : l.gapMax && l.gapMax > 7 ? 'WIDE' : '    ';
  console.log(`  ${flag} col${l.col} w=${String(l.width).padStart(6)} gap=${l.gapMin}-${l.gapMax} tail=${JSON.stringify(l.tail)}`);
}

await page.screenshot({ path: path.join(OUT, 'clean-page1.png') });
await browser.close();