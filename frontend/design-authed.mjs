// Логин + съёмка всех авторизованных экранов приложения для UI/UX аудита.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const SHOTS = `${OUT}/shots`;
const BASE = 'http://localhost:3100';
const EMAIL = process.env.AUDIT_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD || 'Nikita-12345';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await fs.mkdir(SHOTS, { recursive: true });
const log = [];

async function shot(name, full = true) {
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  log.push({ name, url: page.url(), h });
  console.log('shot', name, page.url(), 'h=' + h);
}

// --- Логин ---
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/20-login.png`, fullPage: false });
await page.locator('input[type="email"]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Войти")').first().click();
await page.waitForTimeout(5000);
console.log('after login', page.url());
await shot('21-post-login');

const routes = [
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

for (const [name, path] of routes) {
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    await shot(name);
    if (!page.url().includes(path)) console.log('  redirect ->', page.url(), r?.status());
  } catch (e) {
    console.log('FAIL', name, String(e).slice(0, 160));
  }
}

await ctx.storageState({ path: `${OUT}/auth.json` });
await fs.writeFile(`${OUT}/route-log.json`, JSON.stringify(log, null, 2));
await browser.close();
