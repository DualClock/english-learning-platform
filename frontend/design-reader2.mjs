// Добавляет рассказ через реальный эндпоинт и снимает читалку.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const SHOTS = `${OUT}/shots`;
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
  storageState: `${OUT}/auth.json`,
});
const page = await ctx.newPage();
await page.goto('http://localhost:3100/dashboard', { waitUntil: 'networkidle' });

const created = await page.evaluate(async () => {
  const r = await fetch('/api/next/books/popular/11', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 800) };
});
console.log('create story:', JSON.stringify(created));

let id = null;
try { id = JSON.parse(created.body).id; } catch {}
if (!id) {
  // пробуем получить список книг пользователя
  const list = await page.evaluate(async () => {
    const r = await fetch('/api/next/books', { headers: { accept: 'application/json' } });
    return { s: r.status, t: (await r.text()).slice(0, 1000) };
  });
  console.log('list:', JSON.stringify(list));
}

if (id) {
  await page.goto(`http://localhost:3100/reader/${id}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${SHOTS}/51-reader.png`, fullPage: false });
  console.log('reader ok', page.url());

  // клик по слову в тексте
  const clicked = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('span, word, .reader-word')]
      .filter(el => el.children.length === 0 && /^[A-Za-z]{4,8}$/.test(el.textContent?.trim() || ''));
    if (!cands[3]) return null;
    cands[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return cands[3].textContent;
  });
  console.log('clicked word', clicked);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/52-reader-wordsheet.png`, fullPage: false });

  // мобильная читалка
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(`http://localhost:3100/reader/${id}`, { waitUntil: 'networkidle' });
  await mob.waitForTimeout(4500);
  await mob.screenshot({ path: `${SHOTS}/53-reader-mobile.png`, fullPage: false });

  await fs.writeFile(`${OUT}/reader-id.txt`, String(id));
}
await browser.close();
