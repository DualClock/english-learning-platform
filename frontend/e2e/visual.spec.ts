import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Визуальный гейт редизайна.
 *
 * Снимает ключевые экраны в двух вьюпортах и сравнивает с эталоном.
 * Эталоны лежат в e2e/visual-baseline/<проект>/<имя>.png и обновляются
 * намеренно: `npx playwright test --config playwright.visual.config.ts
 * --update-snapshots`. Обновление эталона — это осознанное «вид изменился»,
 * а не способ погасить красный.
 *
 * Публичные экраны снимаются без сессии. Авторизованные — по storageState,
 * который создаёт e2e/visual-auth.setup.ts (одна регистрация на прогон).
 */

const AUTH_STATE = join(__dirname, '.visual-auth.json');

/** Стабильные экраны: снимаются без входа. */
const PUBLIC_SCREENS: { name: string; path: string }[] = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
];

/** Экраны внутри приложения. Требуют сессии. */
const AUTHED_SCREENS: { name: string; path: string }[] = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'books', path: '/books' },
  { name: 'dictionary', path: '/dictionary' },
  { name: 'progress', path: '/progress' },
];

/**
 * Прокрутка перед снимком: включаются Reveal-анимации и подгружаются
 * ленивые блоки. Без этого full-page снимок фиксирует пустые секции.
 */
async function settle(page: import('@playwright/test').Page) {
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

test.describe('публичные экраны', () => {
  for (const screen of PUBLIC_SCREENS) {
    test(`${screen.name}`, async ({ page }) => {
      await page.goto(screen.path, { waitUntil: 'networkidle' });
      await settle(page);
      await expect(page).toHaveScreenshot(`${screen.name}.png`, {
        fullPage: true,
        // Допуск на сглаживание шрифтов между прогонами; раскладку не прощает.
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

test.describe('экраны приложения', () => {
  test.skip(
    !existsSync(AUTH_STATE),
    'Нет e2e/.visual-auth.json — сначала прогони e2e/visual-auth.setup.ts'
  );

  // Сессия подхватывается из файла, созданного setup-скриптом.
  test.use({ storageState: AUTH_STATE });

  for (const screen of AUTHED_SCREENS) {
    test(`${screen.name}`, async ({ page }) => {
      await page.goto(screen.path, { waitUntil: 'networkidle' });
      await settle(page);
      await expect(page).toHaveScreenshot(`${screen.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

/*
 * Читалка снимается отдельно: у неё свой маршрут с id книги, который
 * появляется только после добавления книги в библиотеку. Пока книги нет —
 * тест пропускается, а не падает: это состояние данных, а не регрессия вида.
 */
test.describe('читалка', () => {
  test.skip(
    !existsSync(AUTH_STATE),
    'Нет e2e/.visual-auth.json — сначала прогони e2e/visual-auth.setup.ts'
  );
  test.use({ storageState: AUTH_STATE });

  test('reader', async ({ page }) => {
    const idFile = join(__dirname, '.visual-reader-id');
    test.skip(!existsSync(idFile), 'Нет id книги (.visual-reader-id) — нечего открывать');

    const id = readFileSync(idFile, 'utf8').trim();
    await page.goto(`/reader/${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot('reader.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
