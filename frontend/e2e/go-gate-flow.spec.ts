import { expect, test } from '@playwright/test';

/*
 * Локальный GO-гейт: полный путь холодного пользователя.
 *
 * Лендинг → книга → гостевая читалка → клик по слову → CTA → регистрация.
 *
 * Почему именно этот путь. В отчёте аудита он был главным обрывом: обещание
 * лендинга «нажми на незнакомое слово» физически не выполнялось без
 * регистрации, а сама регистрация требовала шести полей и теста уровня.
 * После Фазы 1 путь обязан проходиться без аккаунта ДО первого «ага», и этот
 * тест — единственная проверка, которая доказывает это на живом Next + API,
 * а не на чтении кода.
 *
 * Требования к стенду:
 *   - API на http://127.0.0.1:5226 с применёнными миграциями и засеянным
 *     гостевые каталогом (в Development GuestCatalogSeeder делает это сам);
 *   - фронт на http://localhost:3100 (`next dev -p 3100`);
 *   - NEXT_PUBLIC_API_URL указывает на API.
 */

const BOOK_SLUG = 'the-lost-kitten';

/**
 * Гостевой каталог, который видит страница превью.
 *
 * Проверяем НАПРЯМУЮ бэкенд (NEXT_PUBLIC_API_URL), а не прокси `/api/next/*`:
 * прокси по устройству требует сессии — он проксирует браузерные запросы
 * авторизованного пользователя и без куки честно отвечает 401. Гостевая
 * страница превью ходит в API серверным компонентом, а не через этот прокси.
 */
async function guestCatalogIsReady(page: import('@playwright/test').Page): Promise<boolean> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5226';
  const response = await page.request.get(`${apiBase}/api/guest/books`);
  if (!response.ok()) return false;
  const body = (await response.json()) as { total?: number };
  return (body.total ?? 0) > 0;
}

test.describe('гостевой путь до регистрации', () => {
  test('лендинг → книга → читалка → слово → регистрация', async ({ page }) => {
    // 1. Лендинг открывается и обещает то, что дальше действительно работает.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Lexicon/i);

    const startLink = page.getByRole('link', { name: /Начать/i }).first();
    await expect(startLink).toBeVisible();

    // 2. Книга открывается анонимно — без куки сессии.
    await page.goto(`/library/${BOOK_SLUG}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /The Lost Kitten/i }).first()).toBeVisible();

    // 3. Кнопка «Читать без регистрации» есть и ведёт на гостевую читалку.
    const readFree = page.getByTestId('read-without-signup');
    await expect(readFree).toBeVisible();
    await readFree.click();

    await expect(page).toHaveURL(new RegExp(`/reader/preview/${BOOK_SLUG}`));

    // 4. Глава открылась: текст на месте, слова кликабельны.
    if (!(await guestCatalogIsReady(page))) {
      test.skip(
        true,
        'Гостевой каталог пуст: API не засеял публичные копии. ' +
          'Это блокер стенда, а не теста — GuestCatalogSeederTests ловит ту же причину.'
      );
    }

    const words = page.getByTestId('guest-word');
    await expect(words.first()).toBeVisible();

    /*
     * Кликаем слово «morning» из первой фразы — оно заведомо есть в WordLevels
     * (живой запрос: translationRu = «утро»). Индекс (.nth(3)) не годится:
     * он попадал в служебные слова шапки, панель открывалась без перевода, и
     * тест падал на «перевода нет», хотя клик срабатывал. Тест обязан
     * утверждать то, ради чего он существует: слово из книги даёт перевод.
     */
    const target = words.filter({ hasText: /^morning$/i }).first();
    await expect(target).toBeVisible();
    await target.click();

    // 5. Панель перевода открылась, привязана к этому слову и показывает перевод.
    const panel = page.getByTestId('guest-word-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/morning/i);
    await expect(page.getByTestId('guest-word-translation')).toContainText(/утро/i);

    // И путь вперёд не потерян: кнопка регистрации на месте.
    await expect(panel.getByTestId('guest-word-save')).toBeVisible();
  });

  test('из гостевой читалки CTA ведёт на онбординг без теста уровня', async ({ page }) => {
    await page.goto(`/reader/preview/${BOOK_SLUG}`, { waitUntil: 'domcontentloaded' });

    if (!(await guestCatalogIsReady(page))) {
      test.skip(true, 'Гостевой каталог пуст — стенд не засеян');
    }

    /*
     * Кликаем слово «morning» из первой фразы — оно заведомо есть в WordLevels
     * (проверено живым запросом: translationRu = «утро»). Индекс тут не годится:
     * .nth(2) мог попасть в служебную разметку и дать панель без перевода,
     * и тест падал на том, что перевода нет, хотя клик сработал.
     */
    const word = page.getByTestId('guest-word').filter({ hasText: /^morning$/i }).first();
    await expect(word).toBeVisible();
    await word.click();

    const panel = page.getByTestId('guest-word-panel');
    await expect(panel).toBeVisible();

    /*
     * Перевод ждём через тот же якорь, что и утверждение о нём.
     *
     * Раньше здесь было `panel` → `toBeVisible()`. Панель монтируется со
     * скелетоном/CTA, а перевод приезжает отдельным ответом через сотни
     * миллисекунд после сети — и проверка падала на том, что элемента нет,
     * хотя к моменту следующего `expect` он уже на месте. Гонка теста, а не
     * дефект продукта (живой прогон и отладочный спек показывали 200 и «утро»).
     */
    await expect(page.getByTestId('guest-word-translation')).toContainText(/утро/i);

    // «Сохранить в словарь» уводит регистрироваться — и это ПЕРВЫЙ раз,
    // когда аккаунт вообще понадобился.
    const cta = panel.getByTestId('guest-word-save');
    await expect(cta).toBeVisible();
    await cta.click();

    await expect(page).toHaveURL(/\/onboarding/);
    // Онбординг — два шага, а не четыре с тестом.
    await expect(page.getByText(/Шаг 1 из 2/)).toBeVisible();
    await expect(page.getByText(/Шаг 1 из 4/)).toHaveCount(0);
  });

  test('онбординг: два поля, имя необязательно, напоминания включены', async ({ page }) => {
    await page.goto('/onboarding', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('onboarding-email')).toBeVisible();
    await expect(page.getByTestId('onboarding-password')).toBeVisible();

    // Имени в обязательных полях нет — оно спрятано за ссылкой.
    await expect(page.locator('#onboarding-name')).toHaveCount(0);
    await expect(page.getByText(/Указать имя/i)).toBeVisible();

    // Напоминания включены по умолчанию.
    await expect(page.getByTestId('onboarding-notify')).toBeChecked();

    // Тест уровня не показывается: он живёт на /test.
    await expect(page.getByText(/Пройти тест/i)).toHaveCount(0);
  });

  test('уровень из теста приходит в онбординг адресом и не спрашивается заново', async ({ page }) => {
    await page.goto('/onboarding?level=b1', { waitUntil: 'domcontentloaded' });

    // Подсказка говорит, что уровень уже учтён, а выбора уровня в форме нет.
    await expect(page.getByText(/уровень из теста уже учтён/i)).toBeVisible();
    await expect(page.getByText(/Какой у вас уровень/i)).toHaveCount(0);
  });
});
