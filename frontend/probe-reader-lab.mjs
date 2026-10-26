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
  const cs = getComputedStyle(flow);
  const firstP = flow.querySelector('.reader-paragraph');
  const pcs = firstP ? getComputedStyle(firstP) : null;

  // Разбиение параграфа на строки по геометрии символов.
  function lineBoxes(el) {
    const node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return [];
    const text = node.textContent;
    const range = document.createRange();
    const lines = [];
    let cur = null;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!cur || Math.abs(r.top - cur.top) > 2) {
        cur = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, start: i, end: i + 1, text: text[i] };
        lines.push(cur);
      } else {
        cur.right = Math.max(cur.right, r.right);
        cur.left = Math.min(cur.left, r.left);
        cur.bottom = Math.max(cur.bottom, r.bottom);
        cur.end = i + 1;
        cur.text += text[i];
      }
    }
    return lines;
  }

  const lines = lineBoxes(firstP);
  const autoHyphenLines = lines.filter((l) => {
    const trimmed = l.text.replace(/\s+$/, '');
    if (!trimmed.endsWith('-')) return false;
    // настоящий дефис в тексте?
    const idx = l.end - 1;
    return node_char(firstP, idx) !== '-';
  });

  function node_char(el, idx) {
    const t = el.firstChild?.textContent ?? '';
    return t[idx] ?? '';
  }

  const viewport = document.querySelector('.reader-viewport');
  const vpRect = viewport.getBoundingClientRect();
  const flowRect = flow.getBoundingClientRect();

  // Все абзацы: сколько строк и есть ли висячие короткие строки
  const paragraphs = Array.from(flow.querySelectorAll('.reader-paragraph')).slice(0, 6).map((p) => {
    const ls = lineBoxes(p);
    return {
      lines: ls.length,
      widths: ls.map((l) => Math.round(l.right - l.left)),
      endsWithHyphen: ls.filter((l) => l.text.trimEnd().endsWith('-')).length,
      lastLineWidth: ls.length ? Math.round(ls[ls.length - 1].right - ls[ls.length - 1].left) : 0,
      firstLine: ls[0]?.text.slice(0, 60),
    };
  });

  // Ищем вертикальные линии/правила внутри страницы
  const rules = [];
  for (const el of flow.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    for (const side of ['borderLeft', 'borderRight']) {
      const w = parseFloat(s[side + 'Width']);
      if (w > 0 && s[side + 'Style'] !== 'none') {
        const r = el.getBoundingClientRect();
        rules.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 40), side, width: w, color: s[side + 'Color'], left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) });
      }
    }
  }
  const sheetCs = getComputedStyle(document.querySelector('.reader-sheet'));

  return {
    flowStyle: {
      hyphens: cs.hyphens,
      webkitHyphens: cs.webkitHyphens,
      textAlign: cs.textAlign,
      wordSpacing: cs.wordSpacing,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      columnWidth: flow.style.columnWidth,
      fontFamily: cs.fontFamily,
      fontKerning: cs.fontKerning,
      textRendering: cs.textRendering,
      overflowWrap: cs.overflowWrap,
      wordBreak: cs.wordBreak,
      fontFeatureSettings: cs.fontFeatureSettings,
      fontVariantLigatures: cs.fontVariantLigatures,
    },
    paragraphStyle: pcs && {
      textAlign: pcs.textAlign,
      textJustify: pcs.textJustify,
      hyphens: pcs.hyphens,
      textIndent: pcs.textIndent,
      wordSpacing: pcs.wordSpacing,
      letterSpacing: pcs.letterSpacing,
      marginTop: pcs.marginTop,
      marginBottom: pcs.marginBottom,
    },
    sheetShadow: sheetCs.boxShadow,
    viewport: { left: Math.round(vpRect.left), right: Math.round(vpRect.right), width: Math.round(vpRect.width) },
    flowRect: { left: Math.round(flowRect.left), width: Math.round(flowRect.width) },
    firstParagraphLineCount: lines.length,
    autoHyphenatedLines: autoHyphenLines.map((l) => l.text.trim()),
    paragraphs,
    cssRules: rules,
    fontsLoaded: Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
    literataAvailable: document.fonts.check('20px Literata'),
    bodyFontCheck: document.fonts.check('20px "Literata"'),
  };
});

writeFileSync(path.join(OUT, 'probe-reader-lab.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await page.screenshot({ path: path.join(OUT, 'probe-reader-lab.png') });
await browser.close();
