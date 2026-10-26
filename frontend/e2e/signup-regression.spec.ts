import { expect, test } from '@playwright/test';

/*
 * РЕГРЕССИЯ, из-за которой пользователь не мог создать аккаунт.
 *
 * Дефект: серверный прокси `/api/next/*` требовал сессию NextAuth для любого
 * пути, включая `/auth/register`. У человека, создающего аккаунт, сессии ещё
 * нет — значит форма получала `401 unauthorized` и НИКОГДА не работала.
 *
 * Автотесты этого не видели, потому что все они ходили в API напрямую
 * (`127.0.0.1:5226/api/auth/register`), минуя прокси. Ошибка жила ровно в
 * прослойке, которую никто не проверял сквозным путём.
 *
 * Этот спек — тот самый сквозной путь: форма → прокси → API → БД → редирект.
 * Он падал бы на старом коде и зеленеет на исправленном.
 */

const PASSWORD = 'Nikita-12345';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
}

test.describe('регистрация через интерфейс', () => {
  test('форма создаёт аккаунт, а не падает на 401 из прокси', async ({ page }) => {
    const email = uniqueEmail('signup');

    // Ловим именно тот запрос, который шёл через прокси.
    const registerRequests: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/next/auth/register')) {
        registerRequests.push(`${response.status()} ${url}`);
      }
    });

    await page.goto('/onboarding', { waitUntil: 'domcontentloaded' });

    /*
     * Вводим КЛАВИАТУРОЙ, а не locator.fill().
     *
     * fill() выставляет value напрямую и не воспроизводит последовательность
     * событий живого набора. На этой форме это давало ложный минус: поля
     * заполнены, а кнопка «Далее» оставалась disabled (`onChange` у React не
     * успевал пересчитать состояние). Диагностический спек с
     * page.keyboard.type() показал, что у настоящего человека кнопка
     * активируется — значит ломался тест, а не продукт.
     */
    await page.locator('input[type="email"]').click();
    await page.keyboard.type(email, { delay: 10 });
    await page.locator('input[type="password"]').click();
    await page.keyboard.type(PASSWORD, { delay: 10 });

    // Шаг 1 — аккаунт. Кнопка отключена, пока пароль пуст: это отдельное
    // свойство онбординга, но без него тест кликал бы вхолостую.
    const next = page.getByRole('button', { name: /далее/i });
    await expect(next).toBeEnabled();
    await next.click();

    // Шаг 2 — цель. Регистрация уходит именно здесь (см. handleAccountSubmit
    // → setStep('goal'), затем register()). Кнопка ищется по data-testid:
    // у неё есть точный идентификатор в разметке, и русский текст не нужно
    // угадывать регуляркой (он менялся: «Начать», «Создаём…»).
    const finish = page.getByTestId('onboarding-goal-continue');
    await expect(finish).toBeVisible();
    await finish.click();

    // Ждём ОТВЕТ прокси — не «просто подождать».
    await expect
      .poll(() => registerRequests, { timeout: 30_000 })
      .not.toHaveLength(0);

    // Главное утверждение: ответ не 401.
    for (const entry of registerRequests) {
      expect(entry, 'регистрация не должна получать 401 от прокси').not.toMatch(/^401/);
    }

    // И вторая половина: аккаунт действительно создан — мы попали внутрь,
    // а не остались на форме с ошибкой.
    await expect(page).not.toHaveURL(/\/onboarding$/i, { timeout: 30_000 });
  });

  test('регистрация напрямую через прокси отвечает не 401', async ({ request }) => {
    // Без браузера: этот запрос — копия того, что делает форма. Он должен
    // пройти на публичном маршруте без куки сессии.
    const response = await request.post('/api/next/auth/register', {
      data: {
        email: uniqueEmail('proxy'),
        password: PASSWORD,
        displayName: '',
        timezone: 'Europe/Moscow',
        website: '',
      },
    });

    expect(
      response.status(),
      'публичный маршрут не должен требовать сессию'
    ).not.toBe(401);

    expect(response.ok(), await response.text()).toBeTruthy();
  });

  test('приватный путь без сессии по-прежнему закрыт', async ({ request }) => {
    // Обратная сторона фикса: регистрацию открыли, остальное — нет.
    const response = await request.get('/api/next/dictionary');
    expect(response.status()).toBe(401);
  });
});
