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

    /*
     * 2) Эндпоинт достижений отдаёт «ничего не разблокировано».
     *
     * Ответ обязан повторять полную форму UserProgress: страница /progress
     * читает xp, level, metrics и остальные поля и падает на первом же
     * отсутствующем. Раньше здесь был усечённый объект — и /progress
     * уходил в error.tsx, а гейт честно это показывал.
     */
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/progress\/achievements(\?|$)/.test(url)) {
        return new Response(
          JSON.stringify({
            xp: 0,
            level: 1,
            levelTitle: 'Новичок',
            levelStartXp: 0,
            nextLevelXp: 50,
            xpToNextLevel: 50,
            levelProgressPercent: 0,
            metrics: {
              words: 0,
              reviews: 0,
              books: 0,
              pages: 0,
              grammarUnits: 0,
              categoriesLearned: 0,
              activeDays: 0,
              streak: 0,
              xp: 0,
            },
            achievements: [],
            unlockedCount: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return realFetch(input, init);
    };
  }, SEEN_PREFIX);
}

/**
 * Остановить анимации в кадре.
 *
 * Маскот Lexi моргает: компонент ставит setTimeout на 4200 + Math.random()×3200
 * мс и на 120 мс закрывает глаза. Эталон снимался с открытыми глазами, а
 * следующий кадр иногда попадал в моргание — гейт падал на разнице век.
 *
 * getAnimations() здесь не помогает: у глаз не CSS-анимация и не Web Animation,
 * а React-состояние, которое переключает таймер. Поэтому гасим источник —
 * до первой отрисовки подменяем Math.random и setTimeout так, чтобы моргание
 * не наступало никогда. Заодно останавливаем уже запущенные CSS-анимации.
 *
 * Ставится через addInitScript: таймеры планируются при монтировании маскота,
 * то есть раньше, чем мы успеем что-то сделать из теста.
 */
function freezeAnimationsBeforeLoad(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    // 1) Моргание не планируется: интервал моргания в маскоте — 4200 + random×3200.
    Math.random = () => 0;

    const realSetTimeout = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      /*
       * Моргание — единственный таймер с паузой больше 4 секунд, который
       * срабатывает сам по себе. Всё остальное (подсказки, тосты) короче.
       */
      if (typeof timeout === 'number' && timeout >= 4000) {
        return 0 as unknown as number;
      }
      return realSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;

    // 2) Уже запущенные CSS-анимации — на паузу.
    document.addEventListener('DOMContentLoaded', () => {
      document.getAnimations?.().forEach((a) => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch {
          /* не все поддерживают перемотку */
        }
      });
    });
  });
}

/**
 * Убедиться, что снимаем страницу, а не экран ошибки.
 *
 * Во время массового снятия эталонов /progress один раз отрисовал error.tsx
 * («Что-то пошло не так»): параллельные прогоны и прогревающийся API дали
 * исключение в рендере. Гейт этого не заметил — он сравнил ошибку с ошибкой
 * и остался зелёным. Эталон, узаконивший поломку, хуже отсутствия эталона.
 *
 * Поэтому перед снимком и после ожидания страница обязана быть «своей»: если
 * на ней текст ошибки — тест падает с внятным сообщением, а не пишет эталон.
 */
async function assertNotErrorPage(page: import('@playwright/test').Page, name: string) {
  const failed = await page.evaluate(() => {
    const text = document.body.innerText;
    return (
      text.includes('Что-то пошло не так') ||
      text.includes('Не удалось загрузить') ||
      text.includes('Нет связи с сервером')
    );
  });

  if (failed) {
    const snippet = (await page.evaluate(() => document.body.innerText)).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(
      `Экран «${name}» отрисовал состояние ошибки вместо страницы. ` +
        `Эталон не снимаю: он узаконил бы поломку. Видно на экране: ${snippet}`
    );
  }
}

test.describe('публичные экраны', () => {
  for (const screen of PUBLIC_SCREENS) {
    test(`${screen.name}`, async ({ page }) => {
      await freezeClockBeforeLoad(page);
      await suppressAchievementToasts(page);
      await freezeAnimationsBeforeLoad(page);
      await page.goto(screen.path, { waitUntil: 'networkidle' });
      await settle(page);
      await hideToasts(page);
      await assertNotErrorPage(page, screen.name);
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
      await freezeAnimationsBeforeLoad(page);
      await page.goto(screen.path, { waitUntil: 'networkidle' });
      await settle(page);
      await hideToasts(page);
      await assertNotErrorPage(page, screen.name);
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
    await freezeAnimationsBeforeLoad(page);
    await page.goto(`/reader/${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await hideToasts(page);
    await assertNotErrorPage(page, 'reader');
    await expect(page).toHaveScreenshot('reader.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
