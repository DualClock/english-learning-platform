import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/reader-lab`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow[aria-hidden="false"]', { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);

const out = await page.evaluate(() => {
  const flow = document.querySelector('.reader-flow');
  const cs = getComputedStyle(flow.querySelector('.reader-paragraph'));

  // Полный список признаков переноса, которые браузер реально применяет.
  const probe = document.createElement('div');
  probe.setAttribute('lang', 'en');
  probe.style.cssText = 'position:absolute;left:-9999px;width:655px;font-family:var(--font-literata),Literata,Georgia,serif;font-size:20px;line-height:1.8;text-align:justify;hyphens:auto;-webkit-hyphens:auto';
  probe.textContent = 'The representative extraordinary incomprehensible determination of internationalization demonstrates hyphenation behaviour in a narrow measure of typographic composition.';
  document.body.appendChild(probe);

  // Кросс-браузерный тест через вставку мягкого переноса
  const soft = document.createElement('div');
  soft.setAttribute('lang', 'en');
  soft.style.cssText = 'position:absolute;left:-9999px;width:200px;font-family:serif;font-size:20px;hyphens:manual';
  soft.textContent = 'extra\u00ADordinary';
  document.body.appendChild(soft);

  const result = {
    paragraph: {
      hyphens: cs.hyphens,
      webkitHyphens: cs.webkitHyphens,
      wordBreak: cs.wordBreak,
      overflowWrap: cs.overflowWrap,
      lineBreak: cs.lineBreak,
      textAlign: cs.textAlign,
      textJustify: cs.textJustify,
      fontVariantLigatures: cs.fontVariantLigatures,
      fontFeatureSettings: cs.fontFeatureSettings,
      hyphensLimitChars: cs.hyphenateLimitChars,
      hyphensLimitLast: cs.hyphenateLimitLast,
      hyphensLimitZone: cs.hyphenateLimitZone,
      hyphensCharacter: cs.hyphenateCharacter,
      langFromElement: document.querySelector('.reader-paragraph').closest('[lang]')?.getAttribute('lang'),
    },
    probeRendered: {
      width: Math.round(probe.getBoundingClientRect().width),
      height: Math.round(probe.getBoundingClientRect().height),
    },
    softHyphenRendered: Math.round(soft.getBoundingClientRect().height),
    // Реальные переносы: проверяем наличие символа '-' в конце строк у длинных абзацев
    actualHyphens: (() => {
      const samples = [];
      for (const p of document.querySelectorAll('.reader-paragraph')) {
        const node = p.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.textContent;
        let lineTop = null;
        let lineText = '';
        const range = document.createRange();
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (lineTop === null || Math.abs(r.top - lineTop) > 3) {
            if (lineText.trim().endsWith('-')) samples.push(lineText.trim().slice(-20));
            lineTop = r.top;
            lineText = text[i];
          } else {
            lineText += text[i];
          }
        }
        if (lineText.trim().endsWith('-')) samples.push(lineText.trim().slice(-20));
        if (samples.length > 12) break;
      }
      return samples;
    })(),
  };

  document.body.removeChild(probe);
  document.body.removeChild(soft);
  return result;
});

console.log(JSON.stringify(out, null, 2));

// Оценка «рваности» правого края: сколько строк короче полной ширины
const ragged = await page.evaluate(() => {
  const rows = [];
  for (const p of document.querySelectorAll('.reader-paragraph')) {
    const node = p.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.textContent;
    const range = document.createRange();
    let lineTop = null, left = 1e9, right = -1e9, lineText = '';
    const flush = () => {
      if (lineTop !== null) rows.push({ w: Math.round(right - left), text: lineText.trim().slice(0, 30) });
    };
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (lineTop === null || Math.abs(r.top - lineTop) > 3) {
        flush();
        lineTop = r.top; left = r.left; right = r.right; lineText = text[i];
      } else {
        left = Math.min(left, r.left); right = Math.max(right, r.right); lineText += text[i];
      }
    }
    flush();
  }
  const full = Math.max(...rows.map((r) => r.w));
  const short = rows.filter((r) => r.w < full - 6 && r.w < full * 0.93);
  return { full, lines: rows.length, shortLines: short.length, shortest: short.slice(0, 10) };
});
console.log('RAGGED', JSON.stringify(ragged));

await browser.close();
