import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/reader-lab`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow[aria-hidden="false"]', { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const TEXT = `The lantern by the river was already burning when Mara reached the wooden bridge. She had walked for an hour through the wet fields, and her boots were heavy with mud. A thin rain moved over the water, turning the far bank into a soft grey shape. She stopped at the middle of the bridge and listened. Somewhere below, the river carried small stones against the piers, and the sound was steady, almost like breathing.`;

  function analyze(el, label) {
    const lines = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    const range = document.createRange();
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const last = lines[lines.length - 1];
        if (!last || Math.abs(r.top - last.top) > 3) {
          lines.push({ top: r.top, left: r.left, right: r.right, text: text[i], wordGaps: [] });
        } else {
          last.right = Math.max(last.right, r.right);
          last.text += text[i];
        }
      }
    }
    const hyphenated = lines.filter((l) => l.text.replace(/\s+$/, '').endsWith('-'));
    // межсловные интервалы: измеряем пробелы через Range по пробельным символам
    const gaps = [];
    const range2 = document.createRange();
    const t = el.textContent;
    let node2 = el.firstChild;
    if (node2 && node2.nodeType === Node.TEXT_NODE) {
      for (let i = 0; i < t.length; i++) {
        if (t[i] === ' ' || t[i] === '\n') {
          range2.setStart(node2, i);
          range2.setEnd(node2, i + 1);
          const r = range2.getBoundingClientRect();
          if (r.width > 0) gaps.push(r.width);
        }
      }
    }
    // Разрывы строк: позиции последних символов строк
    return {
      label,
      lines: lines.length,
      width: Math.round(el.getBoundingClientRect().width),
      hyphenatedCount: hyphenated.length,
      hyphenSamples: hyphenated.map((l) => l.text.trim().slice(-16)),
      lineEnds: lines.map((l) => ({ end: l.text.trim().slice(-12), width: Math.round(l.right - l.left) })),
      gapsCount: gaps.length,
      gapMin: gaps.length ? +Math.min(...gaps).toFixed(2) : null,
      gapMax: gaps.length ? +Math.max(...gaps).toFixed(2) : null,
      gapMedian: gaps.length ? +gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)].toFixed(2) : null,
    };
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(host);

  const results = [];
  for (const [label, css] of [
    ['justify+hyphens:auto', 'text-align:justify;hyphens:auto;-webkit-hyphens:auto;text-justify:inter-word;'],
    ['justify+hyphens:manual', 'text-align:justify;hyphens:manual;-webkit-hyphens:manual;text-justify:inter-word;'],
    ['left+hyphens:auto', 'text-align:left;hyphens:auto;-webkit-hyphens:auto;'],
    ['left+hyphens:manual', 'text-align:left;hyphens:manual;'],
  ]) {
    const p = document.createElement('p');
    p.setAttribute('lang', 'en');
    p.style.cssText = `margin:0;width:655px;font-family:var(--font-literata),Literata,Georgia,serif;font-size:20px;line-height:1.8;${css}`;
    p.textContent = TEXT;
    host.appendChild(p);
    results.push(analyze(p, label));
    host.removeChild(p);
  }

  document.body.removeChild(host);
  return results;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
