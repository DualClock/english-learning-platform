// Регистрирует тестового пользователя через настоящий онбординг и сохраняет storageState.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const BASE = 'http://localhost:3100';
const EMAIL = `audit-${Date.now()}@example.com`;
const PASSWORD = 'Nikita-12345';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();

await fs.mkdir(`${OUT}/shots`, { recursive: true });

// Онбординг: пошаговый скриншот каждого шага
await page.goto(`${BASE}/onboarding`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
let step = 0;
const steps = [];
for (let i = 0; i < 14; i++) {
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
  steps.push({ i, url: page.url(), text: bodyText.replace(/\n+/g, ' | ').slice(0, 400) });
  await page.screenshot({ path: `${OUT}/shots/onb-${String(i).padStart(2, '0')}.png`, fullPage: true });

  // пробуем заполнить видимые обязательные поля
  const emailInput = page.locator('input[type="email"]:visible').first();
  if (await emailInput.count()) {
    await emailInput.fill(EMAIL);
  }
  const pw = page.locator('input[type="password"]:visible').first();
  if (await pw.count()) {
    await pw.fill(PASSWORD);
  }
  // имя
  const nameInput = page.locator('input[type="text"]:visible').first();
  if (await nameInput.count() && !(await emailInput.count())) {
    const cur = await nameInput.inputValue().catch(() => '');
    if (!cur) await nameInput.fill('Nikita').catch(() => {});
  }

  const btn = page.locator('button:visible').filter({ hasNotText: /назад|войти|пропустить/i }).first();
  const btnText = await btn.innerText().catch(() => '');
  const before = page.url() + (await page.evaluate(() => document.body.innerText.length));
  await btn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const after = page.url() + (await page.evaluate(() => document.body.innerText.length));
  if (page.url().includes('/dashboard')) { console.log('reached dashboard at step', i); break; }
  if (before === after) { console.log('no change at step', i, 'btn=', btnText); }
  step = i;
}

await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/shots/after-onboarding.png`, fullPage: true });
await ctx.storageState({ path: `${OUT}/auth.json` });
await fs.writeFile(`${OUT}/onb-steps.json`, JSON.stringify({ EMAIL, PASSWORD, steps, finalUrl: page.url() }, null, 2));
console.log('final', page.url());
console.log('email', EMAIL);
await browser.close();
