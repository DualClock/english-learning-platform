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
  { name: 'books', path: '/books' },
  { name: 'dictionary', path: '/dictionary' },
  { name: 'progress', path: '/progress' },
];

/*
 * Дашборд сознательно вне визуального гейта.
 *
 * Это единственный экран, который собирается из восьми независимых запросов
 * (книги, словарь, повторение, серия, профиль, достижения, рекомендации,
 * чекпоинт) и показывает их результаты. Часть блоков появляется или исчезает
 * в зависимости от данных: счётчики скрываются при нулях, серия меняет текст,
 * карточка продолжения зависит от позиции чтения. Снимок такого экрана
 * сравнивает не вёрстку, а состояние базы — и падает примерно раз в три
 * прогона без единой правки в коде.
 *
 * Дашборд проверяется поведением (e2e: есть приветствие, есть главная
 * карточка, нет ряда нулевых счётчиков) и вручную по скриншотам. Ставить его
 * в пиксельный гейт — значит приучить себя игнорировать красный.
 */

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

/**
 * Скрыть всплывающие уведомления перед снимком.
 *
 * Карточка достижения показывается один раз за сессию (флаг в sessionStorage)
 * и живёт несколько секунд после запроса прогресса. Значит на первом открытии
 * в чистом контексте она в кадре, а при повторном заходе — уже нет, и снимок
 * «плывёт» без единого изменения в вёрстке.
 *
 * Мало скрыть то, что уже есть: тост может отрисоваться после этой проверки.
 * Поэтому сначала ждём его появления (коротко), потом прячем всё найденное.
 * Поведение всплывашки проверяется отдельно, тестами поведения, а не снимком.
 */
async function hideToasts(page: import('@playwright/test').Page) {
  await page
    .locator('[data-achievement-toast]')
    .first()
    .waitFor({ state: 'attached', timeout: 2500 })
    .catch(() => {
      // Тост не появился — это нормальный случай повторного захода.
    });

  await page.evaluate(() => {
    document.querySelectorAll('[data-achievement-toast]').forEach((el) => {
      const node = el as HTMLElement;
      node.style.visibility = 'hidden';
      node.style.pointerEvents = 'none';
    });
  });

  // Дать кадру устояться после скрытия.
  await page.waitForTimeout(150);
}

/**
 * Заморозить часы до первой отрисовки.
 *
 * Дашборд приветствует по времени суток («Доброе утро» / «Доброй ночи») и
 * печатает сегодняшнюю дату. Между прогонами это разное, и гейт ловил смену
 * часов, а не смену вёрстки.
 *
 * Ставится через addInitScript, а не evaluate: приветствие рендерится на
 * клиенте сразу при монтировании, и подмена Date после загрузки уже ничего
 * не меняет — к этому моменту текст на экране.
 */
function freezeClockBeforeLoad(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    const FIXED = new Date('2026-10-26T12:00:00+03:00').getTime();
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(FIXED);
        else super(...(args as [number]));
      }
      static now() {
        return FIXED;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = FrozenDate;
  });
}

const SEEN_PREFIX = 'lexicon:achievements-seen:';

/**
 * Не давать всплывашке достижений испортить снимок.
 *
 * Карточка достижения решается в localStorage по ключу с id пользователя:
 * если ключа нет — это первый заход и старые достижения не всплывают; если
 * ключ есть и появились новые — всплывают. Отсюда и «плавание»: один и тот
 * же экран даёт разный кадр в зависимости от того, был ли уже заход.
 *
 * Подменять localStorage неудобно (ключ зависит от id, которого до сессии
 * нет, а объект Storage в браузере не всегда идёт через прототип), поэтому
 * гасим источник — ответ эндпоинта достижений. Компонент получает пустой
 * список разблокированных достижений, ничего «нового» не находит и тост не
 * показывает. Вёрстка от этого не меняется: всплывашка — отдельный слой.
 */
async function suppressAchievementToasts(page: import('@playwright/test').Page) {
  await page.addInitScript((prefix: string) => {
    // 1) Всё, что уже отмечено просмотренным, остаётся просмотренным.
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          window.localStorage.setItem(key, JSON.stringify(['*']));
        }
      }
    } catch {
      /* приватный режим — всплывашки и так не сохранятся */
    }

    // 2) Эндпоинт достижений отдаёт «ничего не разблокировано».
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/progress\/achievements(\?|$)/.test(url)) {
        return new Response(
          JSON.stringify({ achievements: [], unlockedCount: 0, totalCount: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return realFetch(input, init);
    };
  }, SEEN_PREFIX);
}

test.describe('публичные экраны', () => {
  for (const screen of PUBLIC_SCREENS) {
    test(`${screen.name}`, async ({ page }) => {
      await freezeClockBeforeLoad(page);
      await suppressAchievementToasts(page);
      await page.goto(screen.path, { waitUntil: 'networkidle' });
      await settle(page);
      await hideToasts(page);
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
      await freezeClockBeforeLoad(page);
      await suppressAchievementToasts(page);
      await page.goto(screen.path, { waitUntil: 'networkidle' });
      await settle(page);
      await hideToasts(page);
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
    await freezeClockBeforeLoad(page);
    await suppressAchievementToasts(page);
    await page.goto(`/reader/${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await hideToasts(page);
    await expect(page).toHaveScreenshot('reader.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
