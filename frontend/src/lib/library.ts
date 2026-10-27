/*
 * Публичная витрина книг (W2.2c): типы, полка каталога и зеркало сида.
 *
 * Модуль чистый — без fetch и без node:fs, поэтому его можно импортить и из
 * серверного компонента, и из юнит-теста (в npm run test:unit Node 24 запускает
 * .ts напрямую). Чтение каталога с бэкенда — в src/lib/library-catalog.ts.
 *
 * Источник правды о книгах — GET /api/catalog/books на бэкенде: там считается
 * слаг, там whitelist «только строки без владельца», там превью. То, что лежит
 * здесь, — страховка на случай, когда бэкенд при сборке недоступен (локальная
 * сборка, CI). Зеркало закреплено тестом src/lib/library.test.mjs: слаг сверяется
 * с тем же набором пар, что и C#-тест, а список классик — с сидом
 * PopularBooksService, чтобы «витрина без бэкенда» не начала врать.
 */


export type PublicBookKind = 'classic' | 'story';

/** Формат ответа GET /api/catalog/books (см. PublicBookDto на бэкенде). */
export interface PublicBook {
  slug: string;
  title: string;
  author: string | null;
  cefrLevel: string | null;
  kind: PublicBookKind;
  description: string | null;
  /** null — объём неизвестен, а не «в книге ноль слов» */
  wordCount: number | null;
  coverUrl: string | null;
  gutenbergId: string | null;
  /** Короткое начало книги; null, если публичного текста нет */
  preview: string | null;
}

/** 'api' — пришли к бэкенду; 'seed' — отдаём зеркало сида (бэкенд недоступен). */
export type CatalogSource = 'api' | 'seed';

export interface PublicCatalog {
  books: PublicBook[];
  source: CatalogSource;
}

export const LIBRARY_PATH = '/library';

/** Полки каталога: ровно та шкала, что и на /test. */
export const SHELF_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Подпись полки. Формулировки те же, что показывает /test
 * (src/app/test/page.tsx): человек, пришедший с теста уровня, должен видеть на
 * библиотеке те же слова, а не новый перевод той же шкалы.
 */
export const LEVEL_NOTES: Record<string, string> = {
  A1: 'Отдельные слова и простые фразы',
  A2: 'Бытовые диалоги и адаптированные тексты',
  B1: 'Основная идея текста, разговор на знакомую тему',
  B2: 'Оригинал почти без напряжения',
  C1: 'Сложная проза, ирония, профессиональная лексика',
  C2: 'Любой текст, включая специализированный',
};

export const UNKNOWN_LEVEL_LABEL = 'Без уровня';

export function bookHref(slug: string): string {
  return `${LIBRARY_PATH}/${slug}`;
}

/**
 * Слаг из названия — зеркало правила PublicSlug на бэкенде. У копии одно
 * назначение: собрать адреса из зеркала сида, когда бэкенда нет под сборкой.
 * Боевые ссылки всегда приходят с сервера готовыми, и ни одна книга
 * пользователя через эту функцию не проходит.
 */
export function slugFromTitle(title: string): string {
  const text = title
    // «Brontë» → «Bronte»: диакритика снимается, а не превращается в мусор
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*&\s*/g, ' and ')
    // Апостроф выбрасывается: «Alice's» → «alices», а не «alice-s»
    .replace(/['’‘‛ʼ`´]/g, '')
    .replace(/[\s_\-–—/\\|:.+,!?()«»"'„“”]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (text.length === 0) return 'book';
  if (text.length <= 80) return text;

  // Обрезаем по границе слова, иначе у длинного названия появится хвост
  const cut = text.slice(0, 80);
  const hyphen = cut.lastIndexOf('-');
  const trimmed = (hyphen > 0 ? cut.slice(0, hyphen) : cut).replace(/-+$/g, '');

  return trimmed.length === 0 ? 'book' : trimmed;
}

export function levelOrder(level: string | null | undefined): number {
  const index = SHELF_LEVELS.indexOf((level ?? '').trim().toUpperCase());
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/** Порядок полки: уровень, затем название. Тот же, что собирает бэкенд. */
export function compareBooks(a: PublicBook, b: PublicBook): number {
  const byLevel = levelOrder(a.cefrLevel) - levelOrder(b.cefrLevel);
  if (byLevel !== 0) return byLevel;

  const byTitle = a.title.localeCompare(b.title, 'en');
  if (byTitle !== 0) return byTitle;

  return a.kind.localeCompare(b.kind);
}

export function sortCatalog(books: PublicBook[]): PublicBook[] {
  return [...books].sort(compareBooks);
}

export interface ShelfGroup {
  level: string;
  note: string | null;
  books: PublicBook[];
}

/**
 * Каталог раскладывается по полкам. Пустых полок нет: «A1 — 0 книг» уместно в
 * фильтре, но на витрине это выглядит как сломанный раздел.
 */
export function groupByLevel(books: PublicBook[]): ShelfGroup[] {
  const groups: ShelfGroup[] = [];

  for (const book of sortCatalog(books)) {
    const level = (book.cefrLevel ?? '').trim().toUpperCase() || UNKNOWN_LEVEL_LABEL;
    const last = groups[groups.length - 1];

    if (last && last.level === level) {
      last.books.push(book);
      continue;
    }

    groups.push({ level, note: LEVEL_NOTES[level] ?? null, books: [book] });
  }

  return groups;
}

/**
 * Обложка: у классики это абсолютный URL Open Library, у рассказа —
 * относительный путь к статике бэкенда (/uploads/covers/...).
 *
 * Относительный путь возвращается КАК ЕСТЬ, без склейки с apiBase.
 * Приклеивать адрес бэкенда нельзя: Next проксирует /uploads/* через
 * rewrite на тот же бэкенд (см. rewrites() в next.config.mjs), то есть
 * фронт отдаёт эту статику сам, с того же origin. Сборка же подставляет
 * в NEXT_PUBLIC_API_URL адрес, который в браузере НЕ совпадает с origin
 * страницы (стенд слушает 127.0.0.1, страница открыта как localhost).
 * Тогда картинка уходит кросс-доменным запросом, CORS-политика бэкенда
 * такой origin не разрешает — и вместо обложки читатель видит битую
 * иконку. Проверено на живом стенде: 10 из 11 обложек не грузились,
 * через относительный путь грузятся все.
 *
 * Чужие абсолютные ссылки остаются как есть.
 */
export function resolveCoverSrc(coverUrl: string | null, apiBase: string): string | null {
  // apiBase сохранён в подписи ради существующих вызовов (две витрины и
  // гостевой предпросмотр передают его позиционно). На результат не влияет:
  // см. объяснение выше — абсолютный адрес здесь и был дефектом.
  void apiBase;

  if (!coverUrl) return null;
  if (/^https?:\/\//i.test(coverUrl)) return coverUrl;
  if (!coverUrl.startsWith('/')) return null;

  return coverUrl;
}

/**
 * Защитный разбор ответа API: SSR-страница не имеет права падать из-за того,
 * что бэкенд вернул не тот тип. Запись без слага или названия — не запись.
 */
export function normalizeBook(value: unknown): PublicBook | null {
  if (typeof value !== 'object' || value === null) return null;

  const raw = value as Record<string, unknown>;
  const slug = asText(raw.slug);
  const title = asText(raw.title);

  if (!slug || !title) return null;

  return {
    slug,
    title,
    author: asText(raw.author),
    cefrLevel: asText(raw.cefrLevel)?.toUpperCase() ?? null,
    kind: raw.kind === 'story' ? 'story' : 'classic',
    description: asText(raw.description),
    wordCount: asPositiveInt(raw.wordCount),
    coverUrl: asText(raw.coverUrl),
    gutenbergId: asText(raw.gutenbergId),
    preview: asText(raw.preview),
  };
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * Классики из сида PopularBooksService — зеркало на случай недоступного бэкенда.
 * Обложек здесь нет намеренно: их ищет живым запросом Open Library, и выдумывать
 * URL из слага было бы враньём. Без обложки карточка рисует тайтл-заглушку.
 */
export const PUBLIC_CLASSICS: PublicBook[] = [
  classic('Pride and Prejudice', 'Jane Austen', 'B2', 'Classic romance novel', '1342'),
  classic('Moby-Dick', 'Herman Melville', 'C1', 'Adventure of Captain Ahab', '2701'),
  classic('Frankenstein', 'Mary Shelley', 'B1', 'Gothic science fiction', '84'),
  classic('Dracula', 'Bram Stoker', 'B1', 'Classic horror novel', '345'),
  classic('The Picture of Dorian Gray', 'Oscar Wilde', 'B2', 'Philosophical fiction', '174'),
  classic('Jane Eyre', 'Charlotte Brontë', 'B2', 'Gothic romance', '1260'),
  classic('Wuthering Heights', 'Emily Brontë', 'B2', 'Tragic love story', '768'),
  classic('Great Expectations', 'Charles Dickens', 'B2', 'Coming-of-age novel', '1400'),
  classic('The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 'B1', 'Detective stories', '1661'),
  classic("Alice's Adventures in Wonderland", 'Lewis Carroll', 'A2', 'Fantasy adventure', '11'),
];

function classic(
  title: string,
  author: string,
  cefrLevel: string,
  description: string,
  gutenbergId: string,
): PublicBook {
  return {
    slug: slugFromTitle(title),
    title,
    author,
    cefrLevel,
    kind: 'classic',
    description,
    // Объём в словах знает только бэкенд (его считает анализ EPUB),
    // поэтому в зеркале он остаётся неизвестным
    wordCount: null,
    coverUrl: null,
    gutenbergId,
    // Текст классики лежит в файле, а не в сиде: без бэкенда цитаты нет
    preview: null,
  };
}

/**
 * JSON-LD книги (schema.org Book). Только то, что мы действительно знаем: ни
 * aggregateRating, ни числа читателей — при отсутствии данных это была бы не
 * «богатая разметка», а ложь в индексе.
 */
export function bookJsonLd(book: PublicBook, url: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    // Рассказы пишет команда сервиса — это организация, а не человек
    author:
      book.kind === 'story'
        ? { '@type': 'Organization', name: book.author ?? 'Lexicon' }
        : { '@type': 'Person', name: book.author ?? 'Unknown' },
    inLanguage: 'en',
    isAccessibleForFree: true,
    genre: book.kind === 'story' ? 'Graded short story' : 'Classic literature',
    bookFormat: 'https://schema.org/EBook',
    url,
  };

  if (book.description) data.description = book.description;
  if (book.wordCount) data.numberOfWords = book.wordCount;
  if (book.gutenbergId) data.sameAs = `https://www.gutenberg.org/ebooks/${book.gutenbergId}`;

  return data;
}

/**
 * Содержимое <script type="application/ld+json">. Углы и амперсанд экранируются
 * в JSON-безопасные последовательности: заголовок вида `</script>` иначе закрыл
 * бы скрипт прямо в HTML публичной страницы — это XSS-поверхность на маршруте,
 * куда приходит краулер.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/*
 * Подпись объёма: «1 234 слова».
 *
 * Разбивка чисел и плюрализация здесь свои, а не импортом из src/lib/format.ts и
 * src/lib/plural.ts: этот модуль читают и серверный компонент, и юнит-тест,
 * который Node запускает по .ts напрямую. Node не резолвит импорты без
 * расширения, а Next не резолвит их с расширением .ts — единого варианта для
 * обоих нет. Одинаковость проверяет тест library.test.mjs: он вызывает и эти
 * функции, и оригиналы из format.ts / plural.ts.
 */
const NBSP = String.fromCharCode(160);

export function bookVolumeLabel(wordCount: number | null): string | null {
  if (!wordCount || wordCount <= 0) return null;

  const grouped = String(wordCount).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

  return `${grouped} ${pluralWordsForVolume(wordCount)}`;
}

/** «1 слово / 2 слова / 5 слов»: то же правило, что в src/lib/plural.ts. */
export function pluralWordsForVolume(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return 'слово';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'слова';

  return 'слов';
}

/*
 * ------------------------------------------------------------------
 * Зеркало сида: те же правила, что считает бэкенд.
 * ------------------------------------------------------------------
 */

/** Потолок превью — те же 150 слов, что у PublicCatalogService на бэкенде. */
export const PREVIEW_WORD_LIMIT = 150;

/**
 * Форма записи из Data/Seed/stories.json. Ключи camelCase: C#-сторона читает их
 * через PropertyNameCaseInsensitive, а JSON на диске — именно такой.
 *
 * PascalCase-дубли accepted намеренно: StorySeeder читает обе формы (он не
 * различает регистр), поэтому и зеркало обязано прочитать сид, независимо от
 * того, в каком регистре ключи лежат в файле или в ручной фикстуре. Держать
 * «только camelCase» означало бы, что витрина тихо теряет рассказы, если сид
 * пересоберут в PascalCase.
 */
export interface SeedStory {
  title?: string;
  Title?: string;
  author?: string;
  Author?: string;
  cefrLevel?: string;
  CefrLevel?: string;
  description?: string;
  Description?: string;
  paragraphs?: string[];
  Paragraphs?: string[];
}

function seedText(camel: string | undefined, pascal: string | undefined): string | null {
  return camel?.trim() || pascal?.trim() || null;
}

function seedParagraphs(camel?: string[], pascal?: string[]): string[] {
  const source = Array.isArray(camel) ? camel : Array.isArray(pascal) ? pascal : [];
  return source.filter((paragraph): paragraph is string => typeof paragraph === 'string');
}

/**
 * Зеркало PublicCatalogService.TakePreview: первые 150 слов, обрезка по границе
 * предложения, «…» на месте разрыва. Нужен только для зеркала сида — боевое
 * превью всегда приходит с бэкенда.
 */
export function takePreview(text: string): string {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return '';

  const take = Math.min(words.length, PREVIEW_WORD_LIMIT);
  let preview = words.slice(0, take).join(' ');

  if (take < words.length) {
    const start = Math.max(0, preview.length - 320);
    const boundary = Math.max(
      preview.lastIndexOf('.'),
      preview.lastIndexOf('!'),
      preview.lastIndexOf('?'),
    );

    preview = boundary >= start ? preview.slice(0, boundary + 1) : preview.trimEnd();
    preview += '…';
  }

  return preview.trim();
}

/**
 * Рассказ из сида -> запись полки. Индекс задаёт имя файла обложки: бэкенд
 * генерирует uploads/covers/story-{index}.svg тем же порядком, что и список в
 * stories.json, поэтому путь совпадает без запроса к API.
 *
 * Текст рассказа лежит в самом сиде и является нашим public domain, поэтому
 * превью здесь честное, а не придуманное.
 */
export function storyFromSeed(story: SeedStory, index: number): PublicBook | null {
  const title = seedText(story.title, story.Title);
  if (!title) return null;

  const text = seedParagraphs(story.paragraphs, story.Paragraphs)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text ? text.split(' ').filter(Boolean).length : null;

  return {
    slug: slugFromTitle(title),
    title,
    author: seedText(story.author, story.Author),
    cefrLevel: seedText(story.cefrLevel, story.CefrLevel)?.toUpperCase() ?? null,
    kind: 'story',
    description: seedText(story.description, story.Description),
    wordCount: words && words > 0 ? words : null,
    coverUrl: `/uploads/covers/story-${index}.svg`,
    gutenbergId: null,
    preview: text ? takePreview(text) : null,
  };
}

/**
 * Витрина из зеркал: классики + рассказы, отсортированные как бэкенд.
 *
 * Дубликат слага в зеркале невозможен по построению (названия сидов разные), но
 * убирать его всё равно надо: два одинаковых адреса на одной полке — это
 * тихая потеря книги в индексе. Суффиксы коллизий считаются на бэкенде, поэтому
 * зеркало просто оставляет первую запись и выбрасывает повтор.
 */
export function assembleShelf(classics: PublicBook[], stories: PublicBook[]): PublicBook[] {
  const seen = new Set<string>();

  return sortCatalog([...classics, ...stories]).filter((book) => {
    if (seen.has(book.slug)) return false;
    seen.add(book.slug);
    return true;
  });
}

/**
 * Что отдаёт витрина по сырому ответу API и зеркалу сида.
 *
 * Отдельная чистая функция потому, что решение «доверять ответу или нет» — это
 * единственное место, где SSR может упасть из-за чужого JSON. Разбор и выбор
 * источника проверяются тестом без сети; fetch-обёртка в
 * src/lib/library-catalog.ts остаётся тонкой.
 */
export function resolveCatalogPayload(payload: unknown, mirror: PublicBook[]): PublicCatalog {
  const list =
    typeof payload === 'object' && payload !== null && Array.isArray((payload as { books?: unknown }).books)
      ? ((payload as { books: unknown[] }).books.map(normalizeBook).filter((b): b is PublicBook => b !== null))
      : [];

  if (list.length > 0) {
    return { books: sortCatalog(list), source: 'api' };
  }

  // Пустой список от живого API означает, что сиды не дочитались, а не то, что
  // книг нет: витрина в этом случае остаётся с зеркалом сида
  return { books: mirror, source: 'seed' };
}
