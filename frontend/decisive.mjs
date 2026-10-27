import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const EMAIL = 'reader-e2e-1792931823@test.local';
const PASSWORD = 'ReaderTest123';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 120000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"], button:has-text("Войти")');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40000 });
await page.goto(`${BASE}/reader/60`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow', { timeout: 60000 });
await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(host);

  // РЕШАЮЩИЙ ТЕСТ: длинное слово в узком боксе. Автоперенос -> 1 строка выше,
  // потому что слово разорвётся; без переноса -> слово не влезет.
  function wordTest(label, css, lang) {
    const el = document.createElement('div');
    el.setAttribute('lang', lang);
    el.style.cssText = `width:120px;font-family:var(--font-literata),Literata,Georgia,serif;font-size:20px;line-height:1.75;${css}`;
    el.textContent = 'incomprehensibility';
    host.appendChild(el);
    const lines = Math.round(el.getBoundingClientRect().height / 35);
    const w = Math.round(el.getBoundingClientRect().width);
    host.removeChild(el);
    return { label, lines, width: w };
  }

  const tests = [
    wordTest('hyphens:auto, lang=en', 'hyphens:auto;-webkit-hyphens:auto;', 'en'),
    wordTest('hyphens:manual, lang=en', 'hyphens:manual;', 'en'),
    wordTest('hyphens:auto, lang=ru', 'hyphens:auto;-webkit-hyphens:auto;', 'ru'),
    wordTest('hyphens:auto, lang=de', 'hyphens:auto;-webkit-hyphens:auto;', 'de'),
  ];

  // МЕЖСЛОВНЫЕ ИНТЕРВАЛЫ на реальной странице
  const vp = document.querySelector('.reader-viewport').getBoundingClientRect();
  const gaps = [];
  const lineInfo = [];
  for (const span of document.querySelectorAll('.reader-flow [data-s]')) {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.textContent;
    const range = document.createRange();
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const onScreen = cur.right > vp.left && cur.left < vp.right;
      if (onScreen && cur.words.length > 1) {
        const g = [];
        for (let i = 1; i < cur.words.length; i++) g.push(cur.words[i].left - cur.words[i - 1].right);
        gaps.push(...g);
        lineInfo.push({
          text: cur.text.slice(0, 70),
          width: +(cur.right - cur.left).toFixed(1),
          words: cur.words.length,
          minGap: +Math.min(...g).toFixed(2),
          maxGap: +Math.max(...g).toFixed(2),
          lastChar: cur.text.trim().slice(-1),
        });
      }
      cur = null;
    };
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!cur || Math.abs(r.top - cur.top) > 3) {
        flush();
        cur = { top: r.top, left: r.left, right: r.right, text: text[i], words: [], wordStart: i };
      } else {
        cur.left = Math.min(cur.left, r.left);
        cur.right = Math.max(cur.right, r.right);
        cur.text += text[i];
      }
      // границы слов
      const isSpace = /\s/.test(text[i]);
      const prevSpace = i === 0 || /\s/.test(text[i - 1]);
      if (!isSpace && prevSpace) cur.words.push({ start: i, left: r.left, right: r.right });
      else if (!isSpace) {
        const w = cur.words[cur.words.length - 1];
        if (w) w.right = Math.max(w.right, r.right);
      }
    }
    flush();
  }

  document.body.removeChild(host);

  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    hyphenTests: tests,
    gapCount: gaps.length,
    gapMin: +Math.min(...gaps).toFixed(2),
    gapP50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
    gapP90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
    gapP99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(2),
    gapMax: +Math.max(...gaps).toFixed(2),
    worstLines: [...lineInfo].sort((a, b) => b.maxGap - a.maxGap).slice(0, 8),
    hyphenEndingLines: lineInfo.filter((l) => l.lastChar === '-'),
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
