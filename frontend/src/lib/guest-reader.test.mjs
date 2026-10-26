import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GUEST_API_PREFIX,
  GUEST_BANNER_TEXT,
  GUEST_CHAPTERS_AVAILABLE,
  GUEST_ONLY_FIRST_CHAPTER,
  GUEST_SIGNUP_PATH,
  formatLevel,
  guestBookUrl,
  guestBooksUrl,
  guestChapterUrl,
  guestPreviewHref,
  guestWordUrl,
  hasTranslation,
  lockedChapterCount,
  lockedChaptersLabel,
  previewDescription,
  previewNotice,
  segmentChapterText,
  signupHrefForWord,
  tokenizeWords,
  wordCtaCopy,
} from './guest-reader.ts';

/*
 * Гостевой режим чтения: чистые функции страницы /reader/preview/<slug>.
 *
 * Проверяем то, что видит гость и что нельзя проверить сборкой: какое слово
 * окажется под пальцем (пунктуация по краям, дефис, апостроф), что случится
 * на пустой строке, и какой текст CTA соответствует состоянию перевода.
 * Сетевых вызовов здесь нет — за это отвечает e2e/guest-reader.spec.ts.
 */

// ------------------------------------------------------------------ адреса

/*
 * Адреса абсолютные и идут ПРЯМО на API, а не через `/api/next/*`.
 *
 * Прокси `/api/next` требует сессии: он достаёт access-токен из httpOnly-куки
 * и без неё отвечает 401. Гость сессии не имеет по определению — и клик по
 * слову получал 401 «Не удалось получить перевод» при живом API. Это нашёл
 * e2e на локальном стенде; юнит-тесты проверяли строку адреса и были зелёными,
 * потому что в них был зашит тот же неверный ожидаемый префикс.
 */
test('адреса идут на гостевой контроллер напрямую, минуя прокси сессии', () => {
  // База берётся из NEXT_PUBLIC_API_URL; в тесте переменной нет — значит дефолт.
  assert.match(GUEST_API_PREFIX, /^https?:\/\/.+\/api\/guest$/);
  assert.ok(
    !GUEST_API_PREFIX.startsWith('/api/next'),
    'гостевые адреса не должны идти через прокси, которому нужна кука'
  );

  assert.equal(guestBooksUrl(), `${GUEST_API_PREFIX}/books`);
  assert.equal(guestBookUrl('moby-dick'), `${GUEST_API_PREFIX}/books/moby-dick`);
  assert.equal(
    guestChapterUrl('moby-dick', 'c00-abc123'),
    `${GUEST_API_PREFIX}/books/moby-dick/chapters/c00-abc123`
  );
  // Апостроф encodeURIComponent не экранирует — это допустимый символ сегмента
  // пути, и HTTP-роут получает ровно то слово, которое было в тексте.
  assert.equal(
    guestWordUrl('moby-dick', "don't"),
    `${GUEST_API_PREFIX}/books/moby-dick/words/don't`
  );
  // А вот пробел и слэш в слове попали бы в новый сегмент пути — их кодируем.
  assert.equal(
    guestWordUrl('moby-dick', 'a/b c'),
    `${GUEST_API_PREFIX}/books/moby-dick/words/a%2Fb%20c`
  );

  // Слаг из ссылки кодируется: книга с кириллицей или пробелом не должна
  // превратиться во второй сегмент пути.
  assert.equal(guestPreviewHref('the lost kitten'), '/reader/preview/the%20lost%20kitten');
});

test('страница превью — /reader/preview, а не приватная /reader/<id>', () => {
  const href = guestPreviewHref('alices-adventures-in-wonderland');

  assert.match(href, /^\/reader\/preview\//);
  // middleware не должен гейтить превью, поэтому адрес начинается с этого
  // префикса, а не с /reader/<id>/.
  assert.ok(!/^\/reader\/\d/.test(href));
});

// ------------------------------------------------------- слово под пальцем

test('клик по слову с пунктуацией отдаёт слово без знаков: «word,» → «word»', () => {
  const tokens = tokenizeWords('The word, and a sentence.');

  assert.deepEqual(
    tokens.map((token) => token.lookup),
    ['the', 'word', 'and', 'sentence']
  );
  // Исходное написание сохраняется: кнопка показывает «word», а не «word».
  assert.deepEqual(
    tokens.map((token) => token.text),
    ['The', 'word', 'and', 'sentence']
  );
});

test('дефисное слово остаётся одним словом', () => {
  const tokens = tokenizeWords('A well-known story.');

  assert.deepEqual(
    tokens.map((token) => token.lookup),
    ['well-known', 'story']
  );
});

test('апостроф не разрывает слово: don\'t и typographic don’t', () => {
  assert.deepEqual(
    tokenizeWords("I don't know.").map((token) => token.lookup),
    ["don't", 'know']
  );
  // Типографский апостроф из EPUB тоже часть слова, а не разделитель: иначе
  // «don’t» распалось бы на «don» и «t».
  assert.deepEqual(
    tokenizeWords('I don’t know.').map((token) => token.lookup),
    ['don’t', 'know']
  );
});

test('односимвольные слова и цифры не становятся запросами', () => {
  // «a» и «I» в справочнике искать нечего, а «3.14» — не слово.
  const tokens = tokenizeWords('I saw a cat at 3.14 in 1984.');

  assert.deepEqual(
    tokens.map((token) => token.lookup),
    ['saw', 'cat', 'at', 'in']
  );
});

test('пустая строка и строка без латиницы дают пустую разметку', () => {
  assert.deepEqual(tokenizeWords(''), []);
  assert.deepEqual(tokenizeWords('   '), []);
  assert.deepEqual(tokenizeWords('…—«»'), []);
  assert.deepEqual(tokenizeWords(null), []);
  assert.deepEqual(tokenizeWords(undefined), []);

  // Текст без единого слова не теряется: он отдаётся одной непрерывной частью,
  // иначе гость увидел бы пустую страницу вместо строки из тире.
  assert.deepEqual(segmentChapterText('   '), [{ kind: 'space', text: '   ' }]);
  assert.deepEqual(segmentChapterText(''), []);
});

test('разметка восстанавливает исходную строку без потерь', () => {
  const text = "It was raining, and Mr. Smith don't forget — the river's 'edge'.";

  const rebuilt = segmentChapterText(text)
    .map((segment) => (segment.kind === 'word' ? segment.token.text : segment.text))
    .join('');

  assert.equal(rebuilt, text);
});

test('позиции слов совпадают с местом в строке', () => {
  const text = 'One two.';
  const [one, two] = tokenizeWords(text);

  assert.equal(text.slice(one.start, one.start + one.text.length), 'One');
  assert.equal(text.slice(two.start, two.start + two.text.length), 'two');
});

// ------------------------------------------------------ условие «перевод есть»

test('перевод есть только у непустой строки', () => {
  assert.equal(hasTranslation('река'), true);
  assert.equal(hasTranslation('  река  '), true);

  // Пустая строка и пробелы — то же, что null: подпись «перевод:» без перевода
  // хуже, чем честный CTA.
  assert.equal(hasTranslation(''), false);
  assert.equal(hasTranslation('   '), false);
  assert.equal(hasTranslation(null), false);
  assert.equal(hasTranslation(undefined), false);
});

test('CTA различает «перевода нет», «загружается» и «ошибка сети»', () => {
  const withTranslation = wordCtaCopy({ translation: 'река' });
  assert.equal(withTranslation.action, 'Сохранить в словарь');
  // Перевод есть — текста «перевод недоступен» в панели быть не должно.
  assert.ok(!/недоступен/.test(withTranslation.body));

  const withoutTranslation = wordCtaCopy({ translation: null });
  assert.equal(withoutTranslation.action, 'Сохранить в словарь');
  assert.match(withoutTranslation.body, /аккаунт/);

  const loading = wordCtaCopy({ translation: null, loading: true });
  assert.match(loading.body, /Ищем перевод/);

  // Ошибка сети — это не «нет перевода»: предлагать регистрацию вместо
  // повтора запроса нечестно.
  const failed = wordCtaCopy({ translation: null, failed: true });
  assert.equal(failed.action, 'Повторить');
  assert.match(failed.body, /связь/);
});

test('кнопка сохранения ведёт на онбординг и не пишет слово сама', () => {
  const href = signupHrefForWord("don't");

  // encodeURIComponent не экранирует апостроф — это допустимый query-символ,
  // и заново декодированный на онбординге он останется тем же словом.
  assert.equal(href, `${GUEST_SIGNUP_PATH}?next=reader&word=don't`);
  assert.equal(decodeURIComponent(href.split('word=')[1]), "don't");
  // Именно форма, а не API-запись: гостю сохранять некуда.
  assert.ok(href.startsWith('/onboarding'));
});

// --------------------------------------------------------------- подписи

test('уровень подписан кодом, а с пояснением — кодом и словами', () => {
  assert.equal(formatLevel('a2'), 'A2');
  assert.equal(formatLevel(' B1 '), 'B1');
  assert.equal(formatLevel('b1', 'основная мысль текста'), 'B1 — основная мысль текста');
  assert.equal(formatLevel(null), null);
  assert.equal(formatLevel(''), null);
});

test('баннер и лимит глав совпадают с контрактом бэкенда', () => {
  assert.equal(GUEST_CHAPTERS_AVAILABLE, 1);
  assert.equal(GUEST_ONLY_FIRST_CHAPTER, 'guest_only_first_chapter');
  assert.match(GUEST_BANNER_TEXT, /глава 1/i);
  assert.match(GUEST_BANNER_TEXT, /аккаунт/);
});

test('подпись «ещё N глав» склоняется по-русски и молчит у одноглавой книги', () => {
  assert.equal(lockedChapterCount(12), 11);
  assert.equal(lockedChapterCount(1), 0);
  assert.equal(lockedChapterCount(null), 0);

  assert.equal(lockedChaptersLabel(2), 'С аккаунтом откроется ещё 1 глава');
  assert.equal(lockedChaptersLabel(3), 'С аккаунтом откроется ещё 2 главы');
  assert.equal(lockedChaptersLabel(6), 'С аккаунтом откроется ещё 5 глав');
  assert.equal(lockedChaptersLabel(12), 'С аккаунтом откроется ещё 11 глав');
  assert.equal(lockedChaptersLabel(22), 'С аккаунтом откроется ещё 21 глава');
  assert.equal(lockedChaptersLabel(15), 'С аккаунтом откроется ещё 14 глав');
  // Одноглавая книга не обещает «ещё 0 глав».
  assert.equal(lockedChaptersLabel(1), null);
  assert.equal(lockedChaptersLabel(0), null);
});

test('уведомление различает «текста нет» и «бэкенд не ответил»', () => {
  assert.equal(previewNotice({ hasText: true }), null);

  const noText = previewNotice({ hasText: false });
  assert.ok(noText);
  assert.match(noText.title, /не выложен/);

  const broken = previewNotice({ hasText: true, backendError: true });
  assert.ok(broken);
  assert.match(broken.title, /не загрузился/);
});

test('description для metadata собрана только из известных полей', () => {
  const description = previewDescription({
    slug: 'moby-dick',
    title: 'Moby-Dick',
    author: 'Herman Melville',
    cefrLevel: 'c1',
    kind: 'classic',
    description: 'Adventure of Captain Ahab',
    wordCount: null,
    coverUrl: null,
    gutenbergId: '2701',
    preview: null,
  });

  assert.equal(
    description,
    'Herman Melville · C1 · Adventure of Captain Ahab · Первая глава — без регистрации'
  );
  // Ни рейтинга, ни числа читателей: при отсутствии данных это была бы ложь.
  assert.ok(!/рейтинг|читател/.test(description));
});
