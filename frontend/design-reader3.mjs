// Читалка с раскрытым chrome + остальные учебные экраны.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const SHOTS = `${OUT}/shots`;
const BASE = 'http://localhost:3100';
const id = (await fs.readFile(`${OUT}/reader-id.txt`, 'utf8')).trim();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, locale: 'ru-RU',
  storageState: `${OUT}/auth.json`,
});
const page = await ctx.newPage();

await page.goto(`${BASE}/reader/${id}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
// наводим мышь к верху, чтобы показать chrome
await page.mouse.move(700, 20);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/54-reader-chrome.png`, fullPage: false });
// клик по слову: ищем самый частый span в тексте
const info = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')].filter(s => s.children.length === 0 && /^[A-Za-z'’-]{3,12}$/.test((s.textContent||'').trim()));
  return { count: spans.length, sample: spans.slice(0, 6).map(s => s.textContent), cls: spans[0]?.className || '' };
});
console.log('word spans', JSON.stringify(info));
if (info.count) {
  const w = page.locator('span').filter({ hasText: new RegExp('^' + info.sample[2] + '$') }).first();
  await w.click({ timeout: 5000 }).catch(e => console.log('click fail', String(e).slice(0,100)));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/55-reader-wordsheet.png`, fullPage: false });
}

// Учебные экраны, которые не снялись в общем прогоне
for (const [name, path] of [
  ['70-grammar-list', '/grammar'],
  ['71-quiz', '/quiz'],
  ['72-translator', '/translator'],
  ['73-writing', '/writing'],
  ['74-dictation', '/practice/dictation'],
  ['75-pronunciation', '/practice/pronunciation'],
]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log('shot', name, page.url());
}
await browser.close();
