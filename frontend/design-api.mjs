// Разведка API: какие эндпоинты книг есть и как добавить книгу пользователю.
import { chromium } from '@playwright/test';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${OUT}/auth.json` });
const page = await ctx.newPage();

await page.goto('http://localhost:3100/dashboard', { waitUntil: 'networkidle' });
const res = await page.evaluate(async () => {
  const paths = ['api/books', 'api/library', 'api/books/list', 'api/catalog/books'];
  const out = {};
  for (const p of paths) {
    try {
      const r = await fetch('/api/next/' + p, { headers: { accept: 'application/json' } });
      const t = await r.text();
      out[p] = { status: r.status, body: t.slice(0, 500) };
    } catch (e) { out[p] = { error: String(e) }; }
  }
  return out;
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
