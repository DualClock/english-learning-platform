import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LIBRARY_PATH,
  PUBLIC_CLASSICS,
  UNKNOWN_LEVEL_LABEL,
  assembleShelf,
  bookHref,
  bookJsonLd,
  bookVolumeLabel,
  groupByLevel,
  jsonLdScript,
  levelOrder,
  normalizeBook,
  resolveCatalogPayload,
  resolveCoverSrc,
  slugFromTitle,
  storyFromSeed,
  takePreview,
  PREVIEW_WORD_LIMIT,
} from './library.ts';

/*
 * Тесты зеркала публичной витрины (W2.2c).
 *
 * Здесь проверяется не «страница отрисовалась», а то, что офлайн-копия витрины
 * не врёт: слага совпадают с правилом бэкенда, классики не разъехались с
 * PopularBooksService, а превью рассказа не длиннее юридического лимита.
 */

const API_PROJECT = resolve(import.meta.dirname, '..', '..', '..', 'EnglishLearningPlatform.API');
const STORIES_SEED = resolve(API_PROJECT, 'Data', 'Seed', 'stories.json');
const POPULAR_SERVICE = resolve(API_PROJECT, 'Services', 'PopularBooksService.cs');

/*
 * Каркас записи полки. Тесты переписывают только то, что проверяют, поэтому
 * «неизвестный уровень», «нет обложки» и «нет объёма» — значения по умолчанию:
 * страница обязана уметь отрисовать и такую запись.
 */
function book(overrides = {}) {
  return {
    slug: 'the-book',
    title: 'The Book',
    author: null,
    cefrLevel: null,
    kind: 'classic',
    description: null,
    wordCount: null,
    coverUrl: null,
    gutenbergId: null,
    preview: null,
    ...overrides,
  };
}

/*
 * Ключи сида на диске — camelCase, но C#-сторона читает их независимо от
 * регистра, а ручные фикстуры приходят в PascalCase. Обе формы допустимы,
 * поэтому и здесь чтение толерантное: пересборка сида в другом регистре не
 * должна делать тест сломанным.
 */
const seedTitle = (story) => story.Title ?? story.title;
const seedParagraphs = (story) => story.Paragraphs ?? story.paragraphs;

const slugCases = [
  ["Alice's Adventures in Wonderland", 'alices-adventures-in-wonderland'],
  ['Alice’s Adventures in Wonderland', 'alices-adventures-in-wonderland'],
  ['Moby-Dick', 'moby-dick'],
  ['The Picture of Dorian Gray', 'the-picture-of-dorian-gray'],
  ['The Lost Kitten', 'the-lost-kitten'],
  ['Brontë Towers', 'bronte-towers'],
  ['"The Signal": A Ghost Story', 'the-signal-a-ghost-story'],
  ['Dr. Jekyll & Mr. Hyde', 'dr-jekyll-and-mr-hyde'],
  ['  — Frankenstein —  ', 'frankenstein'],
  ['«» — !!!', 'book'],
  ['', 'book'],
];

test('зеркало слага совпадает с правилом PublicSlug на бэкенде', () => {
  // Тот же набор пар, что проверяет C#-тест PublicSlugTests. Если правило
  // поедет на одной стороне, другой тест это поймает сразу.
  for (const [title, expected] of slugCases) {
    assert.equal(slugFromTitle(title), expected, `слаг для «${title}»`);
  }
});

test('классики в зеркале не разъехались с сидом PopularBooksService', (t) => {
  if (!existsSync(POPULAR_SERVICE)) {
    t.skip('API-проект не рядом с этой сборкой фронтенда');
    return;
  }

  const source = readFileSync(POPULAR_SERVICE, 'utf8');
  const block = source.slice(
    source.indexOf('private static readonly List<PopularBookInfo> PopularBooks'),
    source.indexOf('public List<PopularBookInfo> GetPopularBooks()'),
  );

  const seeds = [...block.matchAll(/Title = "([^"]+)",[\s\S]*?CefrLevel = "([^"]+)",[\s\S]*?Author = "([^"]+)",[\s\S]*?GutenbergId = "([^"]+)"/g)]
    .map((m) => ({ title: m[1], level: m[2].toUpperCase(), author: m[3], gutenbergId: m[4] }));

  assert.equal(seeds.length, PUBLIC_CLASSICS.length, 'число классик в зеркале и в сиде');

  for (const seed of seeds) {
    const mirror = PUBLIC_CLASSICS.find((b) => b.slug === slugFromTitle(seed.title));
    assert.ok(mirror, `в зеркале нет классики «${seed.title}»`);
    assert.equal(mirror.author, seed.author);
    assert.equal(mirror.cefrLevel, seed.level);
    assert.equal(mirror.gutenbergId, seed.gutenbergId);
    // Обложек и объёма в зеркале нет намеренно: их знает только бэкенд
    assert.equal(mirror.coverUrl, null);
    assert.equal(mirror.wordCount, null);
    assert.equal(mirror.preview, null);
  }
});

test('полка собрана из зеркала сида: слага уникальны, превью короткое', (t) => {
  if (!existsSync(STORIES_SEED)) {
    t.skip('сида рассказов нет рядом с этой сборкой фронтенда');
    return;
  }

  const stories = JSON.parse(readFileSync(STORIES_SEED, 'utf8'));
  assert.ok(Array.isArray(stories) && stories.length > 0);

  const slugs = stories.map((s) => slugFromTitle(seedTitle(s)));
  assert.equal(new Set(slugs).size, slugs.length, 'слага рассказов уникальны');
  assert.equal(new Set(slugs).size, stories.length);

  for (const story of stories) {
    const text = (seedParagraphs(story) ?? []).join(' ').replace(/\s+/g, ' ').trim();
    const words = text.split(' ').filter(Boolean);
    const preview = takePreview(text);
    const previewWords = preview.replace('…', '').split(' ').filter(Boolean);

    assert.ok(
      previewWords.length <= Math.min(words.length, 150),
      `превью «${seedTitle(story)}» длиннее лимита: ${previewWords.length}`,
    );
    assert.ok(preview.endsWith('…') === words.length > 150, `многоточие только на обрезке: ${seedTitle(story)}`);
  }

  // Название рассказа не должно спореть с названием классики за один адрес
  const classicSlugs = new Set(PUBLIC_CLASSICS.map((b) => b.slug));
  for (const slug of slugs) assert.equal(classicSlugs.has(slug), false, `слаг ${slug} занят классикой`);
});

test('полка расставлена по уровням, неизвестный уровень — в конце', () => {
  const groups = groupByLevel([
    book({ slug: 'z', title: 'Z', cefrLevel: null }),
    book({ slug: 'c', title: 'C', cefrLevel: 'B1' }),
    book({ slug: 'a', title: 'A', cefrLevel: 'a1' }),
    book({ slug: 'b', title: 'B', cefrLevel: 'A2' }),
    book({ slug: 'd', title: 'D', cefrLevel: 'B1' }),
  ]);

  assert.deepEqual(
    groups.map((g) => g.level),
    ['A1', 'A2', 'B1', UNKNOWN_LEVEL_LABEL],
  );
  assert.deepEqual(groups[1].books.map((b) => b.title), ['B']);
  assert.deepEqual(groups[2].books.map((b) => b.title), ['C', 'D']);
  assert.equal(groups[0].note, 'Отдельные слова и простые фразы');
  assert.equal(groups.at(-1).note, null);
});

test('уровень вне шкалы не попадает в середину полки', () => {
  assert.ok(levelOrder('C1') < levelOrder('zz'));
  assert.ok(levelOrder(null) > levelOrder('C2'));
});

test('обложка рассказа допилизуется адресом бэкенда, чужая остаётся как есть', () => {
  assert.equal(
    resolveCoverSrc('/uploads/covers/story-0.svg', 'https://api.test'),
    'https://api.test/uploads/covers/story-0.svg',
  );
  assert.equal(
    resolveCoverSrc('/uploads/covers/story-0.svg', 'https://api.test/'),
    'https://api.test/uploads/covers/story-0.svg',
  );
  assert.equal(resolveCoverSrc('https://covers.openlibrary.org/b/id/11-M.jpg', 'https://api.test'), 'https://covers.openlibrary.org/b/id/11-M.jpg');
  assert.equal(resolveCoverSrc(null, 'https://api.test'), null);
  assert.equal(resolveCoverSrc('uploads/covers/strange.svg', 'https://api.test'), null);
});

test('ответ API разбирается defensively', () => {
  assert.equal(normalizeBook(null), null);
  assert.equal(normalizeBook('мусор'), null);
  assert.equal(normalizeBook({ title: 'No slug' }), null);
  assert.equal(normalizeBook({ slug: '  ', title: 'No slug' }), null);

  const book = normalizeBook({
    slug: ' the-lost-kitten ',
    title: 'The Lost Kitten',
    author: 'Lexicon Stories',
    cefrLevel: 'a1',
    kind: 'story',
    wordCount: 0,
    coverUrl: '/uploads/covers/story-0.svg',
    preview: 'Mia found a small kitten.',
    filePath: '/uploads/books/private.epub',
    uploadedByUserId: 'user-1',
  });

  assert.equal(book.slug, 'the-lost-kitten');
  assert.equal(book.cefrLevel, 'A1');
  assert.equal(book.kind, 'story');
  // 0 слов не бывает: это «неизвестно», а не цифра на витрине
  assert.equal(book.wordCount, null);
  // Приватные поля не должны просочиться в объект страницы
  assert.deepEqual(Object.keys(book).sort(), [
    'author',
    'cefrLevel',
    'coverUrl',
    'description',
    'gutenbergId',
    'kind',
    'preview',
    'slug',
    'title',
    'wordCount',
  ]);
});

test('неизвестный kind не ломает полку', () => {
  const book = normalizeBook({ slug: 'x', title: 'X', kind: 'user-upload' });
  assert.equal(book.kind, 'classic');
});

test('JSON-LD содержит только честные поля и экранирован', () => {
  const data = bookJsonLd(
    book({ slug: 'alice', title: 'Alice', author: 'Lewis Carroll', cefrLevel: 'A2', gutenbergId: '11', kind: 'classic' }),
    'https://lexicon.test/library/alice',
  );

  assert.equal(data['@type'], 'Book');
  assert.equal(data.inLanguage, 'en');
  assert.equal(data.isAccessibleForFree, true);
  assert.equal(data.bookFormat, 'https://schema.org/EBook');
  assert.equal(data.genre, 'Classic literature');
  assert.equal(data.sameAs, 'https://www.gutenberg.org/ebooks/11');
  // Никогда не выдумываем рейтинги и число читателей
  assert.equal('aggregateRating' in data, false);
  assert.equal('ratingCount' in data, false);
  assert.equal('numberOfWords' in data, false);

  const script = jsonLdScript(
    bookJsonLd(book({ slug: 'x', title: '</script><img src=x onerror=alert(1)>' }), 'https://lexicon.test/library/x'),
  );

  assert.equal(script.includes('<'), false);
  assert.equal(script.includes('>'), false);
  assert.equal(script.includes('&'), false);
  assert.equal(script.includes('\\u003c/script'), true);
});

test('объём книги подписывается по-русски', () => {
  assert.equal(bookVolumeLabel(null), null);
  assert.equal(bookVolumeLabel(0), null);
  assert.equal(bookVolumeLabel(1), '1 слово');
  assert.equal(bookVolumeLabel(2), '2 слова');
  assert.equal(bookVolumeLabel(5), '5 слов');
  assert.equal(bookVolumeLabel(21), '21 слово');
  assert.equal(bookVolumeLabel(12), '12 слов');
  // Разряды разделяются неразрывным пробелом — тем же, что в format.ts
  assert.equal(bookVolumeLabel(1234), '1' + String.fromCharCode(160) + '234 слова');
});

test('свои копии разрядов и плюрализации совпадают с общими хелперами', async () => {
  // bookVolumeLabel не импортирует format.ts и plural.ts (Node не резолвит
  // импорты без расширения, а Next — с расширением .ts), поэтому одинаковость
  // проверяется здесь: разошлись — тест красный
  const { formatNumber } = await import('./format.ts');
  const { pluralWords } = await import('./plural.ts');

  for (const n of [1, 2, 5, 11, 12, 21, 104, 1234, 120_000]) {
    assert.equal(
      bookVolumeLabel(n),
      `${formatNumber(n)} ${pluralWords(n)}`,
      `подпись для ${n}`,
    );
  }
});

test('адреса витрины строятся от одного префикса', () => {
  assert.equal(LIBRARY_PATH, '/library');
  assert.equal(bookHref('the-lost-kitten'), '/library/the-lost-kitten');
});

/*
 * Зеркало сида и деградация SSR.
 *
 * Сам src/lib/library-catalog.ts (fetch + node:fs) под node --test не импортируется:
 * он resolution-специфичен для Next, а его поведение в точности «вызов
 * resolveCatalogPayload по ответу API, иначе зеркало». Проверяются здесь
 * обе ветки этого решения.
 */

test('превью рассказа из сида режется тем же лимитом, что на бэкенде', () => {
  const short = 'Mia found a small kitten behind the school.';
  assert.equal(takePreview(short), short);
  assert.equal(takePreview('   '), '');

  const long = Array.from({ length: 400 }, (_, i) => `The keeper lit the lamp again ${i}.`).join(' ');
  const preview = takePreview(long);
  const words = preview.replace('…', '').split(' ').filter(Boolean);

  assert.ok(words.length <= PREVIEW_WORD_LIMIT, `${words.length} слов при лимите ${PREVIEW_WORD_LIMIT}`);
  assert.ok(preview.endsWith('…'), 'на обрезке обязано стоять многоточие');
});

test('рассказ из сида становится записью полки без выдуманных полей', () => {
  const story = storyFromSeed(
    {
      Title: 'The Lost Kitten',
      Author: 'Lexicon Stories',
      CefrLevel: 'a1',
      Description: 'Девочка находит котёнка.',
      Paragraphs: ['Mia found a small kitten behind the school.', 'It was cold and very hungry.'],
    },
    0,
  );

  assert.equal(story.slug, 'the-lost-kitten');
  assert.equal(story.kind, 'story');
  assert.equal(story.cefrLevel, 'A1');
  assert.equal(story.coverUrl, '/uploads/covers/story-0.svg');
  // 14 = 8 слов первой фразы + 6 слов второй: тот же подсчёт, что у
  // PublicCatalogService.CountWords (Split(' ') без пустых токенов)
  assert.equal(story.wordCount, 14);
  assert.equal(story.gutenbergId, null);
  assert.match(story.preview, /small kitten/);

  // Пустое название — не запись: такие строки сида не должны ронять полку
  assert.equal(storyFromSeed({ Title: '   ' }, 1), null);
});

test('полка из зеркал сортирована и без дублей слага', () => {
  const story = storyFromSeed({ Title: 'Moby-Dick', CefrLevel: 'c1', Paragraphs: ['A whale.'] }, 0);
  // A1-рассказ нужен, чтобы полка выглядела как боевая: в stories.json строки
  // уровня A1 есть, и зеркало без них начиналось бы с A2
  const easiest = storyFromSeed(
    { Title: 'The Lost Kitten', CefrLevel: 'a1', Paragraphs: ['Mia found a small kitten.'] },
    1,
  );
  const shelf = assembleShelf(PUBLIC_CLASSICS, [story, easiest]);

  // Рассказ с названием классики не даёт второй адрес: суффиксы коллизий считает
  // бэкенд, зеркало оставляет первую запись
  assert.equal(shelf.filter((b) => b.slug === 'moby-dick').length, 1);
  assert.equal(shelf.find((b) => b.slug === 'moby-dick').kind, 'classic');
  assert.equal(new Set(shelf.map((b) => b.slug)).size, shelf.length);

  // Первый на полке — самый лёгкий уровень
  assert.equal(levelOrder(shelf[0].cefrLevel), 0);
  assert.equal(shelf[0].slug, 'the-lost-kitten');
});

test('ответ API становится витриной, мусор — нет', () => {
  const mirror = [PUBLIC_CLASSICS[0]];

  const fromApi = resolveCatalogPayload(
    {
      count: 2,
      books: [
        { slug: 'the-lost-kitten', title: 'The Lost Kitten', kind: 'story', cefrLevel: 'a1', wordCount: 321 },
        { slug: 'frankenstein', title: 'Frankenstein', kind: 'classic', cefrLevel: 'b1', gutenbergId: '84' },
      ],
    },
    mirror,
  );

  assert.equal(fromApi.source, 'api');
  assert.equal(fromApi.books.length, 2);
  assert.equal(fromApi.books[0].slug, 'the-lost-kitten', 'полка начинается с A1');

  // Живой API, который вернул пустой список, не должен превращать витрину в ноль
  assert.equal(resolveCatalogPayload({ count: 0, books: [] }, mirror).source, 'seed');
  assert.equal(resolveCatalogPayload(null, mirror).source, 'seed');
  assert.equal(resolveCatalogPayload('не json', mirror).source, 'seed');
  assert.equal(resolveCatalogPayload({ books: [{ title: 'без слага' }] }, mirror).source, 'seed');

  // Приватных полей в витрине нет даже если их принесли
  const leaked = resolveCatalogPayload(
    {
      books: [
        {
          slug: 'x',
          title: 'X',
          filePath: '/uploads/books/private.epub',
          uploadedByUserId: 'user-1',
        },
      ],
    },
    mirror,
  );

  assert.equal(leaked.books.length, 1);
  assert.equal('filePath' in leaked.books[0], false);
  assert.equal('uploadedByUserId' in leaked.books[0], false);
});
