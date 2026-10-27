import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** В ESM нет __dirname — вычисляем каталог файла явно. */
const HERE = dirname(fileURLToPath(import.meta.url));

/*
 * Готовит окружение для визуального гейта: регистрирует одноразовый аккаунт,
 * сохраняет сессию и id книги для читалки.
 *
 * Отдельный скрипт, а не globalSetup: эталоны снимаются не на каждый прогон,
 * а тогда, когда стенд поднят и данные готовы. Запуск:
 *   node e2e/visual-auth.setup.mjs
 *
 * Пароль намеренно простой: это локальный стенд и одноразовый аккаунт,
 * а не учётная запись с данными.
 */
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key];
}

const BASE = `http://localhost:${process.env.E2E_PORT || 3100}`;
const EMAIL = `visual-${Date.now()}@example.com`;
const PASSWORD = 'Nikita-12345';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();

// Регистрация через настоящий онбординг: так же, как это делает человек.
await page.goto(`${BASE}/onboarding`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByTestId('onboarding-email').fill(EMAIL);
await page.getByTestId('onboarding-password').fill(PASSWORD);
await page.getByTestId('onboarding-submit').click();

// Шаг 1 -> 2. Ждём именно появления второй формы, а не фиксированную паузу:
// иначе клик по «Начать» уходит до того, как форма отрисовалась.
await page.getByTestId('onboarding-goal-continue').waitFor({ state: 'visible', timeout: 30_000 });
await page.waitForTimeout(500);
await page.getByTestId('onboarding-goal-continue').click();

// Регистрация уходит и показывается welcome. Ждём кнопку перехода.
const welcomeBtn = page.getByText('Выбрать первую книгу', { exact: false });
await welcomeBtn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await page.screenshot({ path: '../.design-audit/shots/91-welcome.png', fullPage: false });
await welcomeBtn.first().click().catch(() => {});
await page.waitForTimeout(4000);
console.log('после регистрации:', page.url());

// Если welcome не появился — входим вручную тем же паролем.
if (!page.url().includes('/books') && !page.url().includes('/dashboard')) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Войти")').first().click();
  await page.waitForTimeout(5000);
  console.log('после ручного входа:', page.url());
}

// Книга для экрана читалки: берём первую классику через приложение-прокси.
const created = await page.evaluate(async () => {
  const r = await fetch('/api/next/books/popular/11', { method: 'POST' });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 300) };
});
console.log('книга:', JSON.stringify(created));

try {
  const id = JSON.parse(created.body).id;
  if (id) writeFileSync(join(HERE, '.visual-reader-id'), String(id));
} catch {
  // id уже могла существовать в библиотеке — тогда читалку найдём через /books
  await page.goto(`${BASE}/books`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const href = await page
    .locator('a[href^="/reader/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (href) writeFileSync(join(HERE, '.visual-reader-id'), href.split('/')[2]);
}

await ctx.storageState({ path: join(HERE, '.visual-auth.json') });
console.log('сессия сохранена, email:', EMAIL);
await browser.close();
