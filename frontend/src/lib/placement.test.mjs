import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildPlacementAnswers,
  getLevelGuide,
  placementLevelLabel,
  readingPickCaption,
  PLACEMENT_QUESTIONS_PATH,
  PLACEMENT_RESULT_PATH,
} from './placement.ts';

/*
 * Контракт теста уровня (W2.2a).
 *
 * Placement живёт в двух местах сразу: онбординг (шаг перед регистрацией) и
 * публичный /test (ссылка из Telegram, VK, Дзена). Логика вынесена в
 * src/lib/placement.ts именно поэтому — но вынос ничего не стоит, пока его
 * никто не сверяет с сервером. Здесь проверка читает бэкенд: `ProfileController.cs`
 * (пути, анонимность, пороги уровня) и сиды библиотеки (какие книги на каком
 * уровне реально есть).
 */

const here = dirname(fileURLToPath(import.meta.url));
// src/lib → src → frontend → корень репо: бэкенд читается как есть, без копий контракта
const repoRoot = join(here, '..', '..', '..');
const read = (...segments) => readFileSync(join(here, ...segments), 'utf8');
const readRepo = (...segments) => readFileSync(join(repoRoot, ...segments), 'utf8');

const profileController = readRepo(
  'EnglishLearningPlatform.API',
  'Controllers',
  'ProfileController.cs'
);
const analyticsController = readRepo(
  'EnglishLearningPlatform.API',
  'Controllers',
  'AnalyticsController.cs'
);

/** Уровень считает сервер — эти пороги зеркалят `ProfileController.SubmitPlacementResult`. */
const SERVER_THRESHOLDS = [
  [0, 'A1'],
  [4, 'A1'],
  [5, 'A2'],
  [7, 'A2'],
  [8, 'B1'],
  [10, 'B1'],
  [11, 'B2'],
  [13, 'B2'],
  [14, 'C1'],
  [16, 'C1'],
];

test('код CEFR для экрана: строчный код сервера становится A1…C1', () => {
  assert.equal(placementLevelLabel('a2'), 'A2');
  assert.equal(placementLevelLabel('c1'), 'C1');
  // онбординг передаёт и полную строку из списка уровней
  assert.equal(placementLevelLabel('B1 — Средний'), 'B1');
  assert.equal(placementLevelLabel(''), '');
  assert.equal(placementLevelLabel(null), '');
  assert.equal(placementLevelLabel(undefined), '');
});

test('ответы собираются по индексам вопросов, пропущенные не уезжают на сервер', () => {
  const questions = [
    { id: 1, prompt: '', options: [] },
    { id: 2, prompt: '', options: [] },
    { id: 3, prompt: '', options: [] },
  ];

  // «назад» + смена выбора: choices[index] — актуальный ответ, null — не отвечено
  assert.deepEqual(buildPlacementAnswers(questions, [0, null, 2]), [
    { id: 1, choice: 0 },
    { id: 3, choice: 2 },
  ]);
  assert.deepEqual(buildPlacementAnswers(questions, [null, null, null]), []);
  assert.deepEqual(buildPlacementAnswers([], []), []);
});

test('пути клиента совпадают с роутами ProfileController', () => {
  assert.ok(
    profileController.includes('[HttpGet("placement")]'),
    'на сервере нет GET api/profile/placement — фронтент зовёт в 404'
  );
  assert.ok(
    profileController.includes('[HttpPost("placement/result")]'),
    'на сервере нет POST api/profile/placement/result'
  );
  assert.ok(
    profileController.includes('[Route("api/profile")]'),
    'префикс роута ProfileController изменился — пути клиента нужно обновить'
  );

  assert.equal(PLACEMENT_QUESTIONS_PATH, '/api/profile/placement');
  assert.equal(PLACEMENT_RESULT_PATH, '/api/profile/placement/result');
});

/**
 * Гостевой тест возможен ровно потому, что оба эндпоинта анонимные. Как только
 * кто-то снимет [AllowAnonymous], /test начнёт отдавать 401 человеку без
 * аккаунта — то есть ровно тому, ради которого страницу делали.
 */
test('placement остаётся анонимным на сервере', () => {
  for (const attribute of ['[HttpGet("placement")]', '[HttpPost("placement/result")]']) {
    const at = profileController.indexOf(attribute);
    assert.ok(at >= 0, `атрибут ${attribute} не найден`);
    const following = profileController.slice(at, at + 240);
    assert.match(
      following,
      /\[AllowAnonymous\]/,
      `${attribute} больше не [AllowAnonymous] — гость на /test не сможет пройти тест`
    );
  }
});

test('расшифровка уровня покрывает все уровни, которые выдаёт сервер', () => {
  for (const [correct, code] of SERVER_THRESHOLDS) {
    const level = code.toLowerCase();
    const guide = getLevelGuide(level);
    assert.equal(guide.code, code, `для ${correct} правильных expected ${code}`);
    assert.ok(guide.readout.length > 40, `${code}: пустая человеческая расшифровка`);
    assert.ok(guide.picks.length > 0, `${code}: нет полки «что читать»`);
  }
});

test('неизвестный уровень не роняет экран результата', () => {
  const guide = getLevelGuide('z9');
  assert.equal(guide.code, 'Z9');
  assert.deepEqual(guide.picks, []);
  assert.ok(guide.readout.length > 0);
});

/*
 * Книги на результат-экране — единственная вещь обещанная человеку конкретная.
 * Если их нет в сидах, страница враньём продала библиотеку.
 */
test('полка «что читать» совпадает с реальными сидами бэкенда', () => {
  const RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };
  const stories = JSON.parse(
    readFileSync(
      join(repoRoot, 'EnglishLearningPlatform.API', 'Data', 'Seed', 'stories.json'),
      'utf8'
    )
  );
  const popularBooksService = readRepo(
    'EnglishLearningPlatform.API',
    'Services',
    'PopularBooksService.cs'
  );

  /** title → CEFR: рассказы Lexicon и классика из Gutenberg одним справочником */
  const levelsByTitle = new Map(
    stories.map((story) => [story.title, String(story.cefrLevel).toUpperCase()])
  );
  for (const [, title, level] of popularBooksService.matchAll(
    /Title = "([^"]+)",\s*CefrLevel = "([^"]+)"/g
  )) {
    levelsByTitle.set(title, level.toUpperCase());
  }

  for (const code of ['A1', 'A2', 'B1', 'B2', 'C1']) {
    for (const pick of getLevelGuide(code.toLowerCase()).picks) {
      assert.ok(
        levelsByTitle.has(pick.title),
        `книги «${pick.title}» нет ни в stories.json, ни в PopularBooksService`
      );
      assert.equal(
        levelsByTitle.get(pick.title),
        pick.level,
        `«${pick.title}» показана как ${pick.level}, а в сидах её уровень — ${levelsByTitle.get(pick.title)}`
      );
      // Полка не обещает книгу сложнее уровня: «на C1 читается и B2» — правда,
      // «на A2 почитайте Мелвилла» — нет.
      assert.ok(
        RANK[pick.level] <= RANK[code],
        `«${pick.title}» (${pick.level}) стоит на полке ${code} выше своего уровня`
      );
    }
  }

  assert.ok(readingPickCaption(getLevelGuide('a1').picks[0]).length > 0);
});

test('онбординг берёт placement из общего модуля, а не из своих fetch', () => {
  const onboarding = read('..', 'app', 'onboarding', 'page.tsx');

  assert.match(onboarding, /from '@\/app\/lib\/placement-api'/, 'онбординг не использует общий слой');
  assert.doesNotMatch(
    onboarding,
    /api\/profile\/placement/,
    'онбординг по-прежнему зовёт эндпоинты напрямую — контракт продублирован'
  );
});

test('страница /test рендерит текст до JavaScript и ведёт в онбординг', () => {
  const page = read('..', 'app', 'test', 'page.tsx');

  assert.match(page, /вопрос/i, 'в HTML страницы нет упоминания вопросов — пустой экран без JS');
  assert.match(page, /canonical: '\/test'/, 'у публичной страницы нет canonical');
  assert.match(page, /from '@\/lib\/site'/, 'OG должен собираться из боевого siteUrl, а не из NEXTAUTH_URL');

  const testFlow = read('..', 'components', 'test', 'PlacementTest.tsx');
  assert.match(
    testFlow,
    /href="\/onboarding"/,
    'под результатом нет CTA «сохранить результат» в онбординг'
  );
  assert.match(testFlow, /role="radiogroup"/, 'варианты ответа не радиогруппа');
  assert.match(testFlow, /aria-labelledby=\{promptId\}/, 'радиогруппа не подписана текстом вопроса');
  assert.match(testFlow, /aria-live="polite"/, 'состояния (ошибка, счётчик) не озвучиваются');
});

/*
 * SEO-база волны W2.2 отвечает за видимость страницы. Достаточно одного
 * неосторожного слова в matcher'е middleware — и /test начинает отдавать
 * 307 на /login: краулер видит пустоту, человек из Telegram — форму входа.
 */
test('/test осталась публичной для краулера', () => {
  const sitemap = read('..', 'app', 'sitemap.ts');
  const robots = read('..', 'app', 'robots.ts');
  const middleware = read('..', 'middleware.ts');
  const landing = read('..', 'app', 'page.tsx');

  assert.match(sitemap, /const publicPaths: string\[\] = \[\/?\s*'\/',\s*'\/test'/, ' /test нет в публичных путях sitemap');
  assert.doesNotMatch(robots, /'\/test/, ' robots.txt закрывает /test — страница не будет проиндексирована');
  assert.doesNotMatch(middleware, /'\/test\/:path\*'|'\/test'/, ' middleware гейтит /test: гость получит 307 на /login');

  assert.match(landing, /href="\/test"/, 'на лендинге нет заметной ссылки на тест уровня');
});

/**
 * Честный замер: гостевые завершения теста сегодня НЕ пишутся в базу.
 *
 * Трекер на экране результата стоит (`track('placement_test_completed', 'source=test', …)`),
 * но `AnalyticsController` закрыт `[Authorize]` — без JWT это 401, а событие к тому
 * же нет в `AllowedEvents` — с JWT это 400. Сервер ради метрики не дырявили
 * (SECURITY_GATE), поэтому тест работает канарейкой: как только одно из двух
 * изменится, проверка упадёт и заставит обновить TODO в PlacementTest.tsx и
 * отчёт по воронке.
 */
test('placement_test_completed пока не принимается сервером (гостя не мерим)', () => {
  assert.match(analyticsController, /\[Authorize\]/, 'аналитика открыта — проверьте TODO на /test');
  assert.ok(
    !/"placement_test_completed"/.test(analyticsController),
    'событие добавлено в AllowedEvents — замер гостевых завершений пора включать'
  );

  const testFlow = read('..', 'components', 'test', 'PlacementTest.tsx');
  assert.match(testFlow, /placement_test_completed/, 'трекер исчез с экрана результата');
  assert.match(testFlow, /TODO\(W2\.2b\)/, 'нет пометки, почему событие сейчас глухо');
});
