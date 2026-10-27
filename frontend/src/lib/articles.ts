/*
 * Статьи: адреса, статусы и форма — без React.
 *
 * Всё, что можно проверить без браузера, живёт здесь, а не в компонентах:
 * адреса ручек, перевод статуса в слово и тон плашки, сборку тела формы и
 * генерацию slug. Причина простая — каждая из этих функций уже ломала
 * интерфейс молча (двойной `/api` в адресе, «undefined» вместо статуса,
 * пустая строка вместо правки slug), и ловить это подключением к бэкенду
 * дороже, чем юнит-тестом.
 *
 * Файл не тянет React: его импортируют и клиентские компоненты, и .mjs-тест
 * через `node --test`.
 */

// ─────────────────────────────────────────────────────────────────── адреса

/*
 * Пути идут БЕЗ префикса прокси: `/api/next/...` допишет toProxyUrl.
 * Записать здесь `/api/next/api/articles` — значит получить
 * `/api/next/api/api/articles` и 404 (тот же баг уже ловили на книгах).
 */

/** Размер страницы ленты по умолчанию. Дюжина карточек на экран — предел. */
export const ARTICLE_PAGE_SIZE = 20;

export interface ArticlesFeedQuery {
  /** slug раздела (`grammar`, `phrasal-verbs`). Пусто — все разделы. */
  section?: string | null;
  page?: number | null;
  pageSize?: number | null;
}

export interface ArticlesAdminQuery {
  status?: string | null;
  search?: string | null;
  page?: number | null;
  pageSize?: number | null;
}

/**
 * Число из адреса или состояния в безопасное положительное целое.
 * `Number.isInteger` вместо голого `> 0`: 2.7 дал бы `page=2.7`, и сервер
 * посчитал бы смещение с дробью.
 */
function positiveInt(raw: number | null | undefined, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const value = Math.floor(raw);
  return value >= 1 ? value : fallback;
}

/** Адрес публичной ленты: `GET /api/articles?section=&page=&pageSize=`. */
export function articlesFeedPath(query: ArticlesFeedQuery = {}): string {
  const params = new URLSearchParams();

  // Порядок как в контракте ручки: section → page → pageSize.
  const section = typeof query.section === 'string' ? query.section.trim() : '';
  if (section) params.set('section', section);

  params.set('page', String(positiveInt(query.page, 1)));
  params.set('pageSize', String(positiveInt(query.pageSize, ARTICLE_PAGE_SIZE)));

  return `/api/articles?${params.toString()}`;
}

/** Адрес админского списка: фильтр по статусу, поиск, страница. */
export function articlesAdminPath(query: ArticlesAdminQuery = {}): string {
  const params = new URLSearchParams();
  params.set('page', String(positiveInt(query.page, 1)));
  params.set('pageSize', String(positiveInt(query.pageSize, ARTICLE_PAGE_SIZE)));

  const status = typeof query.status === 'string' ? query.status.trim() : '';
  if (status) params.set('status', status);

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) params.set('search', search);

  return `/api/articles/admin?${params.toString()}`;
}

/**
 * Публичный адрес статьи. Пустой slug даёт пустую строку, а не `/articles/`:
 * ссылка на корень раздела выглядит рабочей, но ведёт не туда.
 */
export function articlePublicPath(slug: string | null | undefined): string {
  const value = typeof slug === 'string' ? slug.trim() : '';
  if (!value) return '';
  return `/articles/${encodeURIComponent(value)}`;
}

// ──────────────────────────────────────────────────────────────── статусы

/** Статусы статьи в порядке жизненного цикла: черновик → публикация → архив. */
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** Тон плашки статуса совпадает с Tone из ui/Badge. */
export type ArticleStatusTone = 'warning' | 'success' | 'neutral';

/*
 * Enum от бэкенда может приехать и строкой (`"Draft"`, настройки JSON), и
 * числом (по умолчанию ASP.NET сериализует enum числом). Ждать одного
 * варианта — значит показать «undefined» в половине случаев.
 */
const STATUS_BY_INDEX: readonly ArticleStatus[] = ['draft', 'published', 'archived'];

/** Статус из ответа бэкенда в наш словарь. Неизвестное — null, а не «черновик». */
export function normalizeArticleStatus(raw: unknown): ArticleStatus | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return STATUS_BY_INDEX[raw] ?? null;
  }
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return (ARTICLE_STATUSES as readonly string[]).includes(value)
    ? (value as ArticleStatus)
    : null;
}

/** Человеческое слово для таблицы и плашки. */
export function statusLabel(raw: unknown): string {
  switch (normalizeArticleStatus(raw)) {
    case 'draft':
      return 'Черновик';
    case 'published':
      return 'Опубликовано';
    case 'archived':
      return 'Архив';
    default:
      return 'Неизвестно';
  }
}

/**
 * Тон плашки. Черновик — предупреждение (его не видно читателю), архив —
 * нейтральный, публикация — успех.
 */
export function articleStatusTone(raw: unknown): ArticleStatusTone {
  switch (normalizeArticleStatus(raw)) {
    case 'draft':
      return 'warning';
    case 'published':
      return 'success';
    default:
      return 'neutral';
  }
}

// ──────────────────────────────────────────────────────────────────── slug

/** Длина slug: бэкенд режет длинные значения, обрезаем заранее и осмысленно. */
const MAX_SLUG_LENGTH = 80;

/**
 * Slug из заголовка: латиница в нижнем регистре, цифры, одиночные дефисы.
 *
 * Кириллица выпадает целиком — и это не потеря: сервер в таком случае
 * генерирует slug сам, а «транслит на глазок» дал бы адрес, который никто не
 * угадает по ссылке в браузере.
 */
export function slugFromTitle(title: string | null | undefined): string {
  const raw = typeof title === 'string' ? title : '';
  const slug = raw
    .normalize('NFKD')
    // Диакритика (é → e) отделяется комбинирующими знаками — убираем их.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  // Обрезка по дефису: «...-word-» с висящим дефисом сервер отверг бы.
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Годится ли slug, набранный руками. Пустая строка — «не годен». */
export function isValidArticleSlug(raw: string | null | undefined): boolean {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

// ──────────────────────────────────────────────────────────── форма статьи

export interface ArticleFormState {
  title: string;
  slug: string;
  summary: string;
  /** Значение <select>: строка из option. Пустая — «без раздела». */
  sectionId: string | number | null | undefined;
  bodyMarkdown: string;
}

/** Тело запроса POST/PUT /api/articles/admin. */
export interface ArticleInput {
  title: string;
  slug: string | null;
  summary: string | null;
  sectionId: number | null;
  bodyMarkdown: string | null;
}

/** Строка после trim или null. Пустая строка и пробелы считаются пустотой. */
export function textOrNull(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value ? value : null;
}

/**
 * Тело формы → тело запроса.
 *
 * Правила, которые лучше держать в одном месте:
 *  - slug уезжает только валидным. Битая строка иначе дойдёт до сервера,
 *    получит 400, и админ будет чинить её вслепую; без slug сервер сгенерирует
 *    свой;
 *  - sectionId превращается в число или null: из <select> приходит строка;
 *  - пустые текст-поля — null, а не `''`: сервер считает `''` значением, и
 *    «очистить анонс» не сработало бы.
 */
export function articleFormInput(form: ArticleFormState): ArticleInput {
  const slug = typeof form.slug === 'string' ? form.slug.trim() : '';
  return {
    title: (form.title ?? '').trim(),
    slug: isValidArticleSlug(slug) ? slug : null,
    summary: textOrNull(form.summary),
    sectionId: sectionIdOrNull(form.sectionId),
    bodyMarkdown: textOrNull(form.bodyMarkdown),
  };
}

/** id раздела из <select> (строка) или числа. Невалидное — null. */
export function sectionIdOrNull(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

// ───────────────────────────────────────────────────────────────────  дата

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Дата по-русски: «5 октября», для другого года — «5 октября 2025».
 *
 * `toLocaleDateString('ru-RU')` не используется: Node и браузер дают разный
 * формат, и Next ругается на гидратацию. Пустое или битое значение — пустая
 * строка: «undefined» в карточке выглядит как поломка вёрстки.
 */
export function formatArticleDate(
  iso: string | null | undefined,
  now: Date = new Date()
): string {
  if (typeof iso !== 'string' || !iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  return date.getFullYear() === now.getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${date.getFullYear()}`;
}
