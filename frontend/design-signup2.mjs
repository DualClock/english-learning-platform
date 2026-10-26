// Регистрация через реальный онбординг по data-testid + съёмка всех авторизованных экранов.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const OUT = 'C:/Users/Nikita/Desktop/EnglishLearningPlatform/.design-audit';
const SHOTS = `${OUT}/shots`;
const BASE = 'http://localhost:3100';
const EMAIL = `audit-${Date.now()}@example.com`;
const PASSWORD = 'Nikita-12345';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await fs.mkdir(SHOTS, { recursive: true });
const log = [];

async function shot(name, full = true) {
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  log.push({ name, url: page.url(), h });
  console.log('shot', name, page.url(), h);
}

await page.goto(`${BASE}/onboarding`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('10-onb-account');

await page.getByTestId('onboarding-email').fill(EMAIL);
await page.getByTestId('onboarding-password').fill(PASSWORD);
await page.waitForTimeout(300);
await shot('11-onb-account-filled', false);
await page.getByTestId('onboarding-submit').click();
await page.waitForTimeout(3000);
await shot('12-onb-goal');
console.log('after submit url', page.url());

const goalContinue = page.getByTestId('onboarding-goal-continue');
if (await goalContinue.count()) {
  await goalContinue.click().catch(() => {});
  await page.waitForTimeout(3500);
}
await shot('13-after-onb');
console.log('final url', page.url());

await ctx.storageState({ path: `${OUT}/auth.json` });
await fs.writeFile(`${OUT}/signup.json`, JSON.stringify({ EMAIL, PASSWORD, log, finalUrl: page.url() }, null, 2));
await browser.close();
