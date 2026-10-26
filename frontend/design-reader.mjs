// Добавляет книгу в библиотеку пользователя и снимает читалку + остальные экраны.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const SHOTS = `${OUT}/shots`;
const BASE = 'http://localhost:3100';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
  storageState: `${OUT}/auth.json`,
});
const page = await ctx.newPage();
await fs.mkdir(SHOTS, { recursive: true });

async function shot(name, full = true) {
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  console.log('shot', name, page.url());
}

// Добавляем первую книгу из библиотеки
await page.goto(`${BASE}/books`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const addBtn = page.locator('button:has-text("Добавить")').first();
if (await addBtn.count()) {
  await addBtn.click();
  await page.waitForTimeout(5000);
  console.log('after add ->', page.url());
}
await shot('50-books-after-add');

// Читалка
const readerLinks = await page.evaluate(() => [...document.querySelectorAll('a[href*="/reader/"]')].map(a => a.getAttribute('href')).slice(0, 3));
console.log('reader links', JSON.stringify(readerLinks));
const target = readerLinks[0] || '/library';
await page.goto(BASE + target, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
await shot('51-reader', false);
await shot('51-reader-full');

// Клик по слову: открывается карточка перевода
try {
  const word = page.locator('[data-word], .reader-word, span').filter({ hasText: /^the$/i }).first();
  if (await word.count()) { await word.click({ timeout: 3000 }); await page.waitForTimeout(1500); }
} catch {}
await page.screenshot({ path: `${SHOTS}/52-reader-wordsheet.png`, fullPage: false });
console.log('reader url', page.url());

// Мобильная версия дашборда
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await mob.waitForTimeout(2500);
await mob.screenshot({ path: `${SHOTS}/60-mobile-dashboard.png`, fullPage: true });
await mob.screenshot({ path: `${SHOTS}/60-mobile-dashboard-fold.png`, fullPage: false });
await mob.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await mob.waitForTimeout(2000);
await mob.screenshot({ path: `${SHOTS}/61-mobile-landing.png`, fullPage: false });
console.log('mobile done');

await browser.close();
