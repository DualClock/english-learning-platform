import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3210';
const EMAIL = 'reader-e2e-1792931823@test.local';
const PASSWORD = 'ReaderTest123';
const OUT = path.resolve('.tmp', 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const CODE = () => {
  const flow = document.querySelector('.reader-flow');
  if (!flow) return { error: 'no flow' };
  const vp = document.querySelector('.reader-viewport').getBoundingClientRect();
  const colW = parseFloat(flow.style.columnWidth) || vp.width;
  const flowLeft = flow.getBoundingClientRect().left;

  // 1) ПЕРЕНОСЫ: слова, у которых диапазон даёт >1 прямоугольник на РАЗНЫХ строках
  const hyph = [];
  const allWords = [];
  for (const span of flow.querySelectorAll('[data-s]')) {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.textContent;
    const re = /[A-Za-z\u00C0-\u024F]+/g;
    let m;
    while ((m = re.exec(text))) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.01 || r.height > 0.01);
      const inView = rects.some((r) => r.right > vp.left - 1 && r.left < vp.right + 1);
      if (!inView) continue;
      allWords.push(m[0]);
      if (rects.length > 1) {
        // где разорвано: по границам между прямоугольниками
        let cut = null;
        if (rects.length === 2) {
          const r0 = rects[0], r1 = rects[1];
          // символ на стыке
          for (let k = 1; k < m[0].length; k++) {
            const rA = document.createRange();
            rA.setStart(node, m.index);
            rA.setEnd(node, m.index + k);
            const rB = document.createRange();
            rB.setStart(node, m.index + k);
            rB.setEnd(node, m.index + m[0].length);
            if ([...rA.getClientRects()].length === 1 && [...rB.getClientRects()].length === 1) {
              cut = k;
              break;
            }
          }
        }
        hyph.push({
          word: m[0],
          pieces: rects.map((r) => ({ left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1) })),
          cut,
          shown: cut ? `${m[0].slice(0, cut)}-${m[0].slice(cut)}` : null,
        });
      }
    }
  }

  // 2) РЕАЛЬНЫЕ ПРОБЕЛЫ: берём пробельные символы как отдельные диапазоны
  //    Внутри предложения и между предложениями (пробел — отдельный текстовый узел).
  const gaps = [];
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  let tn;
  let prevCharRect = null;
  while ((tn = walker.nextNode())) {
    const t = tn.textContent;
    const range = document.createRange();
    for (let i = 0; i < t.length; i++) {
      range.setStart(tn, i);
      range.setEnd(tn, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        prevCharRect = null;
        continue;
      }
      const inView = r.right > vp.left - 1 && r.left < vp.right + 1;
      if (inView && prevCharRect && Math.abs(r.top - prevCharRect.top) < 3) {
        const isSpace = /\s/.test(t[i]);
        const prevIsSpace = /\s/.test(prevCharRect.ch);
        if (isSpace || prevIsSpace) {
          gaps.push({
            gap: +(r.left - prevCharRect.right).toFixed(2),
            kind: prevIsSpace && isSpace ? 'space-space' : 'word',
            ctx: t.slice(Math.max(0, i - 3), i + 3),
          });
        }
      }
      prevCharRect = { left: r.left, right: r.right, top: r.top, ch: t[i] };
    }
  }

  const wordGaps = gaps.filter((g) => g.kind === 'word').map((g) => g.gap).filter((g) => g >= 0).sort((a, b) => a - b);
  const stat = wordGaps.length
    ? {
        n: wordGaps.length,
        min: +wordGaps[0].toFixed(2),
        p50: +wordGaps[Math.floor(wordGaps.length / 2)].toFixed(2),
        p90: +wordGaps[Math.floor(wordGaps.length * 0.9)].toFixed(2),
        max: +wordGaps[wordGaps.length - 1].toFixed(2),
        ratio: +(wordGaps[wordGaps.length - 1] / wordGaps[0]).toFixed(2),
      }
    : null;

  // 3) Стили
  const para = flow.querySelector('.reader-paragraph');
  const ps = para ? getComputedStyle(para) : null;

  return {
    hyphens: hyph,
    hyphenCount: hyph.length,
    wordCount: allWords.length,
    gapStat: stat,
    worstGaps: gaps.filter((g) => g.kind === 'word').sort((a, b) => b.gap - a.gap).slice(0, 8),
    style: ps
      ? { textAlign: ps.textAlign, hyphens: ps.hyphens, webkitHyphens: ps.webkitHyphens, textJustify: ps.textJustify, fontSize: ps.fontSize, lineHeight: ps.lineHeight, wordSpacing: ps.wordSpacing }
      : null,
    colW: +colW.toFixed(1),
    lang: flow.getAttribute('lang'),
  };
};

async function run(url, label, pages = 2, needLogin = true) {
  if (needLogin) {
    await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 120000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"], button:has-text("Войти")');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40000 });
  }
  await page.goto(url, { waitUntil: 'load', timeout: 150000 });
  await page.waitForSelector('.reader-flow', { timeout: 60000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);

  const out = [];
  for (let i = 0; i < pages; i++) {
    const r = await page.evaluate(CODE);
    r.page = i + 1;
    out.push(r);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
  }
  console.log(`\n########## ${label} ##########`);
  for (const r of out) {
    console.log(`\n--- стр ${r.page}: слов=${r.wordCount} переносов=${r.hyphenCount} colW=${r.colW} lang=${r.lang}`);
    if (r.style) console.log(`    стиль: ${JSON.stringify(r.style)}`);
    if (r.gapStat) console.log(`    межсловные интервалы: ${JSON.stringify(r.gapStat)}`);
    for (const h of r.hyphens) console.log(`    ПЕРЕНОС: ${JSON.stringify(h.word)} → ${h.shown ?? '?'} (кусков ${h.pieces.length})`);
    if (r.worstGaps?.length) console.log(`    худшие пробелы: ${JSON.stringify(r.worstGaps.map((g) => g.gap))}`);
  }
  return out;
}

const res = {};
res.lab = await run(`${BASE}/reader-lab`, 'reader-lab', 2, false);
res.kitten = await run(`${BASE}/reader/60`, 'The Lost Kitten', 2, true);
res.alice = await run(`${BASE}/reader/61`, 'Alice', 2, false);
writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify(res, null, 2));
await browser.close();