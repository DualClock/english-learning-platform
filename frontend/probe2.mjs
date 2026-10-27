import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.resolve('.tmp');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/reader-lab`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow[aria-hidden="false"]', { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const flow = document.querySelector('.reader-flow');
  const viewport = document.querySelector('.reader-viewport');

  // --- 1. Разбор строк абзаца по текстовым узлам внутри span[data-s] ---
  function lineBoxes(blockEl) {
    const lines = [];
    let cur = null;
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      const range = document.createRange();
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (!cur || Math.abs(r.top - cur.top) > 3) {
          cur = {
            top: r.top, bottom: r.bottom, left: r.left, right: r.right,
            text: text[i], softHyphen: false, lastChar: text[i],
          };
          lines.push(cur);
        } else {
          cur.right = Math.max(cur.right, r.right);
          cur.left = Math.min(cur.left, r.left);
          cur.bottom = Math.max(cur.bottom, r.bottom);
          cur.text += text[i];
          cur.lastChar = text[i];
        }
      }
    }
    return lines;
  }

  const paragraphs = Array.from(flow.querySelectorAll('.reader-paragraph'));
  const paraStats = paragraphs.slice(0, 8).map((p, i) => {
    const lines = lineBoxes(p);
    const raw = p.textContent;
    // Проверяем, стоит ли в исходнике дефис на месте переноса
    const ended = lines.map((l, idx) => {
      const trimmed = l.text.replace(/\s+$/, '');
      const hyphenAtEnd = trimmed.endsWith('-');
      // сколько символов съедено до этой строки
      const consumed = lines.slice(0, idx + 1).reduce((acc, x) => acc + x.text.length, 0);
      const srcChar = raw[trimmed.length - lines.slice(0, idx + 1).reduce((a, x) => a + x.text.length, 0) + trimmed.length - 1];
      return { end: trimmed.slice(-14), hyphenAtEnd };
    });
    const softHyphenEnds = lines.filter((l) => l.text.replace(/\s+$/, '').endsWith('-')).length;
    return {
      index: i,
      lineCount: lines.length,
      widths: lines.map((l) => Math.round(l.right - l.left)),
      hyphenEnds: softHyphenEnds,
      hyphenSamples: lines
        .map((l) => l.text.replace(/\s+$/, ''))
        .filter((t) => t.endsWith('-'))
        .slice(0, 6)
        .map((t) => t.slice(-18)),
      lastLineWidth: lines.length ? Math.round(lines[lines.length - 1].right - lines[lines.length - 1].left) : 0,
      firstLine: lines[0]?.text.slice(0, 70),
    };
  });

  // --- 2. Все тонкие вертикальные/горизонтальные полосы в дереве страницы ---
  const strips = [];
  const push = (el, label) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.height > 60 && r.width <= 8) {
      strips.push({ kind: 'vertical', label, w: +r.width.toFixed(2), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 90), border: `${cs.borderLeftWidth}/${cs.borderRightWidth}`, cls: String(el.className).slice(0, 60) });
    }
    if (r.width > 80 && r.height <= 8) {
      strips.push({ kind: 'horizontal', label, w: Math.round(r.width), h: +r.height.toFixed(2), top: Math.round(r.top), bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 90), cls: String(el.className).slice(0, 60) });
    }
  };
  document.querySelectorAll('body *').forEach((el) => push(el, el.tagName));
  // Псевдоэлементы
  for (const el of document.querySelectorAll('.reader-viewport, .reader-sheet, .reader-stage')) {
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === 'none') continue;
      strips.push({ kind: 'pseudo', label: `${el.className}${pseudo}`, w: cs.width, h: cs.height, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 120), position: cs.position, right: cs.right, top: cs.top, insetBlock: `${cs.top}/${cs.bottom}` });
    }
  }

  // --- 3. Резкие вертикальные границы по пикселям (через canvas) ---
  return {
    flowHyphens: getComputedStyle(flow).hyphens,
    paragraphHyphens: getComputedStyle(paragraphs[0]).hyphens,
    paragraphAlign: getComputedStyle(paragraphs[0]).textAlign,
    paragraphJustify: getComputedStyle(paragraphs[0]).textJustify,
    langAttr: flow.getAttribute('lang'),
    htmlLang: document.documentElement.lang,
    paraStats,
    strips,
    sheet: (() => { const r = document.querySelector('.reader-sheet').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; })(),
    stage: (() => { const r = document.querySelector('.reader-stage').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), bg: getComputedStyle(document.querySelector('.reader-stage')).backgroundColor }; })(),
    viewport: (() => { const r = viewport.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; })(),
    marquee: Array.from(document.querySelectorAll('.reader-paragraph')).slice(0, 3).map((p) => {
      const r = p.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    }),
  };
});

writeFileSync(path.join(OUT, 'probe2.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
