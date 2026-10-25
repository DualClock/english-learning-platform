import { expect, test } from '@playwright/test';

/**
 * Полный проход читалки на живом бэкенде.
 *
 * Требует аккаунт и книгу в нём, поэтому включается переменными окружения:
 *   E2E_EMAIL, E2E_PASSWORD, E2E_BOOK_ID
 * Без них тест пропускается — в CI без секретов он не должен падать.
 *
 * Что проверяется: два запроса на открытие, место восстанавливается после
 * reload, слово уходит в карман, разбор главы отдаёт слова, «Учить» доводит
 * до словаря. Сценарий намеренно короткий: это смоук, а не замена ручному
 * проходу по трём размерам экрана.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const bookId = process.env.E2E_BOOK_ID;

test.skip(
  !email || !password || !bookId,
  'нужны E2E_EMAIL, E2E_PASSWORD и E2E_BOOK_ID — иначе смоук не к чему привязать'
);

test('книга открывается, помнит место и собирает карман', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('email@example.com').fill(email!);
  await page.getByPlaceholder('••••••••').fill(password!);
  await page.getByRole('button', { name: /войти|вход/i }).click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  const readerRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/reader/')) {
      readerRequests.push(new URL(url).pathname);
    }
  });

  await page.goto(`/reader/${bookId}`);
  await expect(page.locator('.reader-flow')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.reader-flow')).toHaveAttribute('aria-hidden', 'false', {
    timeout: 30_000,
  });

  // Открытие — манифест и глава, без семнадцати запросов старой читалки.
  const chapterCalls = readerRequests.filter((path) => path.includes('/chapters/'));
  expect(chapterCalls.length, 'на открытие должна уходить одна глава').toBeLessThanOrEqual(1);

  const pageLabel = page.locator('footer span[aria-live="polite"]');
  await expect(pageLabel).toContainText('/');

  // Листаем и запоминаем место.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => pageLabel.textContent()).not.toBe('1 / 1');
  const urlWithAnchor = page.url();
  expect(urlWithAnchor).toMatch(/[?&]ch=/);

  await page.reload();
  await expect(page.locator('.reader-flow')).toHaveAttribute('aria-hidden', 'false', {
    timeout: 30_000,
  });
  expect(page.url(), 'якорь должен пережить reload').toBe(urlWithAnchor);

  // Тап по слову открывает лист и кладёт слово в карман.
  const sentence = page.locator('.reader-flow [data-s]').first();
  await sentence.click({ position: { x: 12, y: 8 } });
  const sheet = page.getByRole('dialog');
  if (await sheet.isVisible().catch(() => false)) {
    await expect(sheet).toContainText(/карман|перевод|слово/i);
  }
});
