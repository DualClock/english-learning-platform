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

const CODE = () => {
  const flow = document.querySelector('.reader-flow');
  const vp = document.querySelector('.reader-viewport').getBoundingClientRect();
  const colW = parseFloat(flow.style.columnWidth) || vp.width;
  const flowLeft = flow.getBoundingClientRect().left;

  // Все текстовые узлы по порядку → символы с глобальным индексом
  const chars = [];
  let global = 0;
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    const range = document.createRange();
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      chars.push({
        gi: global++,
        ch: text[i],
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        visible: r.width > 0 || r.height > 0,
      });
    }
  }

  // Группируем видимые символы в строки: сначала по колонке, потом по top
  const vis = chars.filter((c) => c.visible && c.right > vp.left - 2 && c.left < vp.right + 2);
  const keyed = vis.map((c) => ({ ...c, col: Math.round((c.left - flowLeft) / colW) }));
  const buckets = new Map();
  for (const c of keyed) {
    const k = `${c.col}|${Math.round(c.top)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }

  const lines = [];
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.gi - b.gi);
    // разрыв по gi → это уже другая строка (не склеиваем колонки)
    const segs = [];
    let cur = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].gi > arr[i - 1].gi + 3) {
        segs.push(cur);
        cur = [];
      }
      cur.push(arr[i]);
    }
    segs.push(cur);
    for (const seg of segs) {
      lines.push({
        col: seg[0].col,
        top: seg[0].top,
        text: seg.map((c) => c.ch).join(''),
        firstGi: seg[0].gi,
        lastGi: seg[seg.length - 1].gi,
        left: Math.min(...seg.map((c) => c.left)),
        right: Math.max(...seg.map((c) => c.right)),
        chars: seg.map((c) => ({ ch: c.ch, left: c.left, right: c.right, gi: c.gi })),
      });
    }
  }
  lines.sort((a, b) => a.col - b.col || a.top - b.top);

  // Перенос: следующая строка начинается ровно со следующего символа, и оба — буквы
  const isLetter = (ch) => /[A-Za-z\u00C0-\u024F]/.test(ch);
  const src = chars.map((c) => c.ch).join('');
  for (let i = 0; i < lines.length; i++) {
    const nxt = lines[i + 1];
    const cur = lines[i];
    const a = cur.chars[cur.chars.length - 1];
    const b = nxt && nxt.col === cur.col ? nxt.chars[0] : null;
    cur.hyphenated =
      Boolean(b) && b.gi === a.gi + 1 && isLetter(a.ch) && isLetter(b.ch) && src[a.gi + 1] === b.ch;
    cur.nextFirst = b ? { gi: b.gi, ch: b.ch, delta: b.gi - a.gi } : null;
  }

  // Пробелы внутри строки
  for (const l of lines) {
    const gaps = [];
    for (let i = 1; i < l.chars.length; i++) {
      if (l.chars[i - 1].ch === ' ' || l.chars[i].ch === ' ') {
        gaps.push({ gap: +(l.chars[i].left - l.chars[i - 1].right).toFixed(2), at: l.chars[i].gi });
      }
    }
    l.gaps = gaps.map((g) => g.gap);
    l.width = +(l.right - l.left).toFixed(1);
    l.isLastOfColumn = false;
  }

  const allGaps = lines.flatMap((l) => l.gaps).filter((g) => g > 0.5).sort((a, b) => a - b);
  const stat = allGaps.length
    ? {
        n: allGaps.length,
        min: +allGaps[0].toFixed(2),
        p25: +allGaps[Math.floor(allGaps.length * 0.25)].toFixed(2),
        p50: +allGaps[Math.floor(allGaps.length * 0.5)].toFixed(2),
        p75: +allGaps[Math.floor(allGaps.length * 0.75)].toFixed(2),
        p95: +allGaps[Math.floor(allGaps.length * 0.95)].toFixed(2),
        max: +allGaps[allGaps.length - 1].toFixed(2),
      }
    : null;

  const para = flow.querySelector('.reader-paragraph');
  const cs = para ? getComputedStyle(para) : null;
  const heading = flow.querySelector('.reader-heading');

  return {
    colW: +colW.toFixed(1),
    vp: { left: +vp.left.toFixed(1), right: +vp.right.toFixed(1) },
    flowLang: flow.getAttribute('lang'),
    htmlLang: document.documentElement.lang,
    paraStyle: cs ? { textAlign: cs.textAlign, textJustify: cs.textJustify, hyphens: cs.hyphens, webkitHyphens: cs.webkitHyphens, wordSpacing: cs.wordSpacing, fontSize: cs.fontSize, lineHeight: cs.lineHeight } : null,
    hasHeading: Boolean(heading),
    lineCount: lines.length,
    hyphenatedLines: lines.filter((l) => l.hyphenated).length,
    gapStat: stat,
    lines: lines.map((l) => ({
      col: l.col,
      top: +l.top.toFixed(1),
      width: l.width,
      hyphenated: l.hyphenated,
      gapMin: l.gaps.length ? Math.min(...l.gaps.filter((g) => g > 0.5)) : null,
      gapMax: l.gaps.length ? Math.max(...l.gaps) : null,
      text: l.text.length > 78 ? l.text.slice(0, 78) + '…' : l.text,
      tail: l.text.replace(/\s+$/, '').slice(-18),
    })),
  };
};

async function probe(url, label, pages) {
  await page.goto(url, { waitUntil: 'load', timeout: 150000 });
  await page.waitForSelector('.reader-flow', { timeout: 60000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: 'header, footer { display: none !important; }' });
  await page.waitForTimeout(200);

  const results = [];
  for (let p = 0; p < (pages || 3); p++) {
    const r = await page.evaluate(CODE);
    r.page = p + 1;
    results.push(r);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
  }
  console.log(`\n########## ${label} ##########`);
  for (const r of results) {
    console.log(`\n--- стр ${r.page}: строк=${r.lineCount} переносов=${r.hyphenatedLines} colW=${r.colW} lang=${r.flowLang}/${r.htmlLang}`);
    if (r.page === 1) {
      console.log(`    стиль: ${JSON.stringify(r.paraStyle)}`);
      console.log(`    пробелы: ${JSON.stringify(r.gapStat)}`);
    }
    for (const l of r.lines) {
      if (l.width < 1) continue;
      console.log(`      ${l.hyphenated ? 'ПЕРЕНОС' : '       '} col${l.col} w=${String(l.width).padStart(6)} gap=${l.gapMin}-${l.gapMax} tail=${JSON.stringify(l.tail)}`);
    }
  }
  return results;
}

const out = {};
out.kitten = await probe(`${BASE}/reader/60`, 'The Lost Kitten (60)', 2);
out.alice = await probe(`${BASE}/reader/61`, 'Alice (61)', 3);
writeFileSync(path.join(OUT, 'final-probe.json'), JSON.stringify(out, null, 2));

await browser.close();