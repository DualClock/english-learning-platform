/*
 * Гостевой режим чтения (R2): чистые функции страницы /reader/preview/<slug>.
 *
 * Здесь нет ни fetch, ни React, ни node:fs — поэтому модуль одинаково читают
 * серверный компонент, клиентский GuestReaderView и юнит-тест, который Node
 * запускает прямо по .ts. Всё, что можно решить без сети и без DOM, решается
 * здесь и покрывается guest-reader.test.mjs: адреса API, разбор слов,
 * подписи и текст CTA.
 *
 * Почему разбор слов свой, а не импорт wordAtPoint.ts: тот работает по
 * координатам тапа (caretRangeFromPoint) и живёт только в браузере. Гостю нужен
 * тап, который работает и с клавиатуры, и в e2e, поэтому слова размечаются
 * явно — каждый кликабельный токен это <button> с data-word. Правило
 * «какое слово под пальцем» (буквы, дефис, апостроф, без краевой пунктуации)
 * при этом повторяет regex из wordAtPoint, чтобы в гостевом превью и в
 * читалке под пальцем оказывалось одно и то же слово.
 */

import type { PublicBook } from './library.ts';

/*
 * Куда гость ходит за данными.
 *
 * НЕ через `/api/next/*`. Тот прокси существует для авторизованных запросов:
 * он достаёт access-токен из httpOnly-куки NextAuth и без сессии честно
 * отвечает 401. Гость сессии не имеет по определению — и его запрос через
 * прокси падал с «Не удалось получить перевод», хотя API отдавал правильный
 * ответ. Нашёл это e2e на живом стенде, а не юнит-тесты: те проверяли чистые
 * функции, а не путь браузер → прокси → API.
 *
 * Поэтому гостевые адреса абсолютные и смотрят прямо на API. Эндпоинты
 * `/api/guest/*` закрыты `[AllowAnonymous]` и лимитом по IP (`guest-reader`,
 * 90/мин) — это их собственная защита, и CORS бэкенда разрешает origin фронта.
 */
export const GUEST_API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226').replace(/\/+$/, '');

export const GUEST_API_PREFIX = `${GUEST_API_BASE}/api/guest`;

export const GUEST_PREVIEW_BASE = '/reader/preview';

/** Сколько глав открыто без аккаунта. Одна, всегда первая. */
export const GUEST_CHAPTERS_AVAILABLE = 1;

/** Код отказа бэкенда, когда гость просит главу после первой. */
export const GUEST_ONLY_FIRST_CHAPTER = 'guest_only_first_chapter';

/** Куда ведёт «сохранить слово»: форма регистрации, а не API-запись. */
export const GUEST_SIGNUP_PATH = '/onboarding';

export const GUEST_BANNER_TEXT =
  'Это глава 1. Остальные главы и сохранение слов — с аккаунтом.';

export function guestPreviewHref(slug: string): string {
  return `${GUEST_PREVIEW_BASE}/${encodeURIComponent(slug)}`;
}

export function guestBooksUrl(): string {
  return `${GUEST_API_PREFIX}/books`;
}

export function guestBookUrl(slug: string): string {
  return `${GUEST_API_PREFIX}/books/${encodeURIComponent(slug)}`;
}

export function guestChapterUrl(slug: string, chapterId: string): string {
  return `${guestBookUrl(slug)}/chapters/${encodeURIComponent(chapterId)}`;
}

export function guestWordUrl(slug: string, word: string): string {
  return `${guestBookUrl(slug)}/words/${encodeURIComponent(word)}`;
}

/** Абсолютный адрес бэкенда: только для серверных компонентов (см. guest-reader.server.ts). */
export function absoluteApiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/**
 * Условие «есть ли перевод» — единственное место, где это решает фронт.
 * Пустая строка из API значит то же, что null: показывать «перевод: » вместо
 * перевода хуже, чем честный CTA.
 */
export function hasTranslation(translation: string | null | undefined): boolean {
  return typeof translation === 'string' && translation.trim().length > 0;
}

export interface WordCtaCopy {
  /** Что написано под словом вместо перевода. */
  body: string;
  /** Текст кнопки. */
  action: string;
}

/**
 * Подпись панели перевода по состоянию. Три состояния, а не два: ошибка сети
 * — это не «перевода нет», и предлагать регистрацию вместо «попробуйте ещё
 * раз» нечестно.
 */
export function wordCtaCopy(state: {
  translation: string | null | undefined;
  loading?: boolean;
  failed?: boolean;
}): WordCtaCopy {
  if (state.failed) {
    return {
      body: 'Не удалось получить перевод. Проверьте связь и попробуйте ещё раз.',
      action: 'Повторить',
    };
  }

  if (state.loading) {
    return { body: 'Ищем перевод…', action: 'Сохранить в словарь' };
  }

  if (hasTranslation(state.translation)) {
    return {
      body: 'С аккаунтом это слово уйдёт в словарь и вернётся на повторение само.',
      action: 'Сохранить в словарь',
    };
  }

  return {
    body: 'Перевод незнакомых слов — с аккаунтом: словарь и повторения бесплатны.',
    action: 'Сохранить в словарь',
  };
}

/** Куда ведёт «Сохранить в словарь» из панели слова. */
export function signupHrefForWord(word: string): string {
  return `${GUEST_SIGNUP_PATH}?next=reader&word=${encodeURIComponent(word)}`;
}

/** Человеческая подпись уровня: «A2 — бытовые диалоги» вместо голого кода. */
export function formatLevel(level: string | null | undefined, note?: string | null): string | null {
  const code = (level ?? '').trim().toUpperCase();
  if (!code) return null;

  return note ? `${code} — ${note}` : code;
}

/**
 * Заголовки для скелетона страницы: у книги без доступного текста честнее
 * сказать «текст ещё не выложен», чем показывать пустую колонку с мигающими
 * полосками.
 */
export interface PreviewNotice {
  title: string;
  body: string;
}

export function previewNotice(input: {
  hasText: boolean;
  backendError?: boolean;
  chaptersCount?: number;
}): PreviewNotice | null {
  if (input.backendError) {
    return {
      title: 'Текст не загрузился',
      body: 'Сервер чтения сейчас не отвечает. Обновите страницу — книга откроется.',
    };
  }

  if (!input.hasText) {
    return {
      title: 'Текст этой книги ещё не выложен',
      body: 'Полный текст откроется в читалке после регистрации.',
    };
  }

  return null;
}

// ------------------------------------------------------------------ разбор слов

export interface WordToken {
  /** Слово в том виде, в каком его увидел человек: «Don't», «well-known». */
  text: string;
  /** Нормализованная форма для запроса: lowercase, без краевой пунктуации. */
  lookup: string;
  /** Позиция в исходной строке — нужна, чтобы тест сверял разметку с текстом. */
  start: number;
}

export type ChapterSegment =
  | { kind: 'word'; token: WordToken }
  | { kind: 'space'; text: string };

/*
 * Тот же алфавит, что у wordAtPoint.wordAtOffset: слово начинается с буквы,
 * дальше буквы, апостроф и дефис. Цифры в слово не входят намеренно — «3.14»
 * и «1984» не переводят кликом.
 */
const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]*/g;

/** Отбрасываем краевые дефисы и апострофы: «—word—» и «'tis» → «word», «tis». */
function trimWordEdges(word: string): string {
  return word.replace(/^[-'’-]+|[-'’-]+$/g, '');
}

/**
 * Слова строки с позициями. Пустая строка, строка из пробелов и строка без
 * латиницы дают пустой массив — страница в этом случае показывает текст как
 * есть, без разметки.
 */
export function tokenizeWords(text: string | null | undefined): WordToken[] {
  if (!text) return [];

  const tokens: WordToken[] = [];
  WORD_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    const lookup = trimWordEdges(raw).toLowerCase();

    // Односимвольные слова («a», «I») не запрашиваем: справочник начинается с
    // двух символов, и кнопка, которая всегда отвечает «недоступно», — обман.
    if (lookup.length < 2) continue;

    tokens.push({ text: raw, lookup, start: match.index });
  }

  return tokens;
}

/**
 * Строка → чередование слов и промежутков между ними. Промежутки выводятся
 * как есть (пробелы, запятые, кавычки), слова становятся кнопками. Так текст
 * на странице выглядит так же, как в книге, но каждое слово кликабельно и
 * доступно с клавиатуры.
 */
export function segmentChapterText(text: string | null | undefined): ChapterSegment[] {
  if (!text) return [];

  const tokens = tokenizeWords(text);
  if (tokens.length === 0) {
    return text ? [{ kind: 'space', text }] : [];
  }

  const segments: ChapterSegment[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ kind: 'space', text: text.slice(cursor, token.start) });
    }

    segments.push({ kind: 'word', token });
    cursor = token.start + token.text.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'space', text: text.slice(cursor) });
  }

  return segments;
}

/**
 * Сколько глав закрыто: подпись «ещё N глав с аккаунтом». Ноль — не пишем
 * ничего (у одноглавой книги обещание «ещё 0 глав» выглядит издевательством).
 */
export function lockedChapterCount(totalChapters: number | null | undefined): number {
  const total = Math.max(0, Math.trunc(totalChapters ?? 0));
  return Math.max(0, total - GUEST_CHAPTERS_AVAILABLE);
}

export function lockedChaptersLabel(totalChapters: number | null | undefined): string | null {
  const locked = lockedChapterCount(totalChapters);
  if (locked === 0) return null;

  const mod10 = locked % 10;
  const mod100 = locked % 100;
  const noun =
    mod10 === 1 && mod100 !== 11
      ? 'глава'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'главы'
        : 'глав';

  return `С аккаунтом откроется ещё ${locked} ${noun}`;
}

/** description для metadata: только то, что мы знаем, без выдуманных рейтингов. */
export function previewDescription(book: PublicBook): string {
  const parts = [
    book.author ?? 'Lexicon',
    formatLevel(book.cefrLevel),
    book.description,
    'Первая глава — без регистрации',
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);

  return parts.join(' · ');
}
