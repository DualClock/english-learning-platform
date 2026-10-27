import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const OUT = path.resolve('.tmp', 'shots');
mkdirSync(OUT, { recursive: true });

const EMAIL = 'reader-e2e-1792931823@test.local';
const PASSWORD = 'ReaderTest123';

const browser = await chromium.launch();

for (const [label, vp] of [
  ['real-desktop', { width: 1440, height: 900 }],
  ['real-mobile', { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"], button:has-text("Войти")');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40000 });
  console.log(label, 'logged in ->', page.url());

  // Находим книгу через API каталога книг пользователя
  const books = await page.evaluate(async () => {
    const r = await fetch('/api/books/mine');
    if (!r.ok) return { status: r.status, body: (await r.text()).slice(0, 200) };
    return await r.json();
  }).catch((e) => ({ error: String(e) }));
  console.log(label, 'books:', JSON.stringify(books).slice(0, 400));

  await page.goto(`${BASE}/library`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(2500);
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/reader/"]')).map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 60) }))
  );
  console.log(label, 'reader links:', JSON.stringify(links).slice(0, 500));

  const target = links[0]?.href || '/reader/60';
  await page.goto(`${BASE}${target}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.reader-flow', { timeout: 60000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const flow = document.querySelector('.reader-flow');
    const p = flow.querySelector('.reader-paragraph') || flow.querySelector('p');
    const cs = p ? getComputedStyle(p) : null;
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), t: Math.round(b.top), b: Math.round(b.bottom) }; };
    return {
      url: location.href,
      header: document.querySelector('header')?.innerText?.slice(0, 80),
      sheet: r(document.querySelector('.reader-sheet')),
      viewport: r(document.querySelector('.reader-viewport')),
      textAlign: cs?.textAlign,
      hyphens: cs?.hyphens,
      fontSize: cs?.fontSize,
      lang: flow.getAttribute('lang'),
      blocks: flow.querySelectorAll('.reader-block').length,
      text: (flow.innerText || '').slice(0, 200),
    };
  });
  console.log(label, 'reader:', JSON.stringify(info, null, 1));

  await page.screenshot({ path: path.join(OUT, `${label}-p1.png`) });
  // Вторая страница
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${label}-p2.png`) });
  await page.keyboard.press('Home');
  await page.waitForTimeout(900);

  if (errors.length) console.log(label, 'console errors:', errors.slice(0, 5));
  await ctx.close();
}

await browser.close();
console.log('done');
