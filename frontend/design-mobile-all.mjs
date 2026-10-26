// Полный мобильный прогон: все авторизованные + публичные экраны на 390px.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const SHOTS = `${OUT}/shots-mobile`;
const BASE = 'http://localhost:3100';

const authed = [
  ['30-dashboard', '/dashboard'],
  ['31-books', '/books'],
  ['32-library', '/library'],
  ['33-categories', '/categories'],
  ['34-dictionary', '/dictionary'],
  ['35-review', '/review'],
  ['36-progress', '/progress'],
  ['37-listening', '/listening'],
  ['38-profile', '/profile'],
  ['39-settings', '/settings'],
  ['40-quiz', '/quiz'],
  ['41-grammar', '/grammar'],
  ['42-translator', '/translator'],
  ['43-writing', '/writing'],
  ['44-dictation', '/practice/dictation'],
  ['45-pronunciation', '/practice/pronunciation'],
];
const publicPages = [
  ['01-landing', '/'],
  ['02-login', '/login'],
  ['03-onboarding', '/onboarding'],
  ['06-categories-pub', '/categories'],
];

const browser = await chromium.launch();
await fs.mkdir(SHOTS, { recursive: true });
const log = [];

async function run(pages, state, tag) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    ...(state ? { storageState: state } : {}),
  });
  const page = await ctx.newPage();
  for (const [name, path] of pages) {
    try {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(700);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png`, fullPage: true });
      // первый экран отдельно
      await page.screenshot({ path: `${SHOTS}/${tag}-${name}-fold.png`, fullPage: false });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      log.push({ tag, name, path, url: page.url(), h, hOverflow: overflow });
      console.log(`${tag}/${name} h=${h} overflowX=${overflow} url=${page.url()}`);
    } catch (e) {
      log.push({ tag, name, path, error: String(e).slice(0, 150) });
      console.log(`${tag}/${name} FAIL ${String(e).slice(0, 150)}`);
    }
  }
  await ctx.close();
}

await run(publicPages, null, 'pub');
await run(authed, `${OUT}/auth.json`, 'auth');

await fs.writeFile(`${OUT}/mobile-report.json`, JSON.stringify(log, null, 2));
await browser.close();
