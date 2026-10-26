// Снимает публичные экраны для UI/UX аудита.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit/shots';
const BASE = 'http://localhost:3100';

const pages = [
  ['01-landing', '/'],
  ['02-login', '/login'],
  ['03-onboarding', '/onboarding'],
  ['04-books', '/books'],
  ['05-library', '/library'],
  ['06-categories', '/categories'],
  ['07-dictionary', '/dictionary'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'ru-RU',
});
await fs.mkdir(OUT, { recursive: true });
const report = [];

for (const [name, path] of pages) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    // прогреваем отложенные анимации/подгрузки
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    // также первый экран (above the fold)
    await page.screenshot({ path: `${OUT}/${name}-fold.png`, fullPage: false });
    report.push({ name, path, status: resp?.status(), url: page.url(), height: h });
    console.log(`${name} OK status=${resp?.status()} h=${h} url=${page.url()}`);
  } catch (e) {
    report.push({ name, path, error: String(e).slice(0, 200) });
    console.log(`${name} FAIL ${String(e).slice(0, 200)}`);
  }
  await page.close();
}

await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
