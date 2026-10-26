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

// 1. Исходный текст главы: ищем мягкие переносы и невидимые символы
const raw = await page.evaluate(async () => {
  const m = await (await fetch('http://localhost:5226/api/reader/books/60')).json();
  const ch = m.chapters[0].id;
  const c = await (await fetch(`http://localhost:5226/api/reader/books/60/chapters/${ch}`)).json();
  const texts = [];
  for (const b of c.blocks ?? c.content?.blocks ?? []) {
    if (b.sentences) texts.push(...b.sentences.map((s) => s.text));
  }
  const joined = texts.join('\n');
  const count = (re) => (joined.match(re) || []).length;
  return {
    totalChars: joined.length,
    softHyphen: count(/\u00AD/g),
    zeroWidth: count(/[\u200B-\u200D\uFEFF]/g),
    nonBreaking: count(/\u00A0/g),
    hyphenDash: count(/[\u2010-\u2015]/g),
    asciiHyphen: count(/-/g),
    sample: joined.slice(0, 300),
    lineWithLittle: (joined.match(/.{0,40}little.{0,40}/g) || []).slice(0, 3),
  };
});
console.log('RAW TEXT:', JSON.stringify(raw, null, 2));

// 2. Определяющий тест авто-переносов
await page.goto(`${BASE}/reader/60`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow', { timeout: 60000 });
await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const hyphTest = await page.evaluate(() => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(host);

  function measure(label, css, lang, text, width) {
    const el = document.createElement('div');
    el.setAttribute('lang', lang);
    el.style.cssText = `width:${width}px;font-family:var(--font-literata),Literata,Georgia,serif;font-size:20px;line-height:1.75;${css}`;
    el.textContent = text;
    host.appendChild(el);
    const lines = Math.round(el.getBoundingClientRect().height / 35);
    const res = { label, lines, height: Math.round(el.getBoundingClientRect().height), scrollWidth: el.scrollWidth };
    host.removeChild(el);
    return res;
  }

  const WORD = 'incomprehensibility';
  const out = [
    measure('hyphens:auto lang=en 80px', 'hyphens:auto;-webkit-hyphens:auto', 'en', WORD, 80),
    measure('hyphens:none lang=en 80px', 'hyphens:none', 'en', WORD, 80),
    measure('hyphens:auto lang=ru 80px', 'hyphens:auto;-webkit-hyphens:auto', 'ru', WORD, 80),
    measure('hyphens:auto lang=en 200px', 'hyphens:auto;-webkit-hyphens:auto', 'en', WORD.repeat(1), 200),
  ];
  document.body.removeChild(host);

  // Проверяем реальный текст на странице: есть ли дефис в конце строки (рендер)
  return out;
});
console.log('\nHYPHENATION TEST:', JSON.stringify(hyphTest, null, 2));

await browser.close();
