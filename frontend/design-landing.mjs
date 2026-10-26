// Съёмка лендинга с прокруткой (Reveal-анимации включаются во вьюпорте).
import { chromium } from '@playwright/test';
const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit/shots';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < total; y += 500) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(250);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-landing-full.png`, fullPage: true });

// секции по отдельности: ищем блоки по тегу section
const sections = await page.evaluate(() => {
  return [...document.querySelectorAll('section')].map((s, i) => {
    const r = s.getBoundingClientRect();
    return { i, top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
  });
});
console.log(JSON.stringify(sections));
for (const s of sections) {
  try {
    await page.evaluate((v) => window.scrollTo(0, v), s.top - 20);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/land-sec-${s.i}.png`, fullPage: false });
  } catch {}
}
console.log('total height', total);
await browser.close();
