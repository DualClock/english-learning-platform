/*
 * Данные публичного раздела /articles — только для серверных компонентов.
 *
 * Почему сервер, а не клиентский fetch. У раздела та же задача, что была у
 * /library: статью должны открыть и краулер, и человек из ссылки в Telegram,
 * без сессии и без ожидания JavaScript. Клиентский fetch дал бы в HTML
 * спиннер и пустой <title>.
 *
 * Авторизации здесь нет: ручки /api/articles публичные (`[AllowAnonymous]` на
 * бэкенде), поэтому запрос идёт напрямую на API, а не через прокси — прокси
 * существует ради подстановки токена из куки, а тут подставлять нечего.
 *
 * Таймаут обязателен: если API молчит, страница отдаёт «не загрузилось», а не
 * висит до таймаута краулера.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5226';

/** Сколько ждать API при рендере страницы. Меньше — и медленный API станет «ошибкой». */
const FETCH_TIMEOUT_MS = 4000;

/** Лента меняется при публикации статьи: минута — разумный компромисс. */
const REVALIDATE_SECONDS = 60;

// ──────────────────────────────────────────────────────────────────── типы

/*
 * Поля названы как в JSON-ответе (camelCase, настройки ASP.NET по умолчанию).
 * bodyHtml приходит уже санитизированным на сервере — разметку здесь никто не
 * собирает и не чистит.
 */

export interface ArticleListItem {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  /** ISO-8601. Строкой, а не Date: JSON приходит строкой. */
  publishedAt: string | null;
  sectionName: string | null;
  sectionSlug: string | null;
}

export interface ArticleDetail {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  bodyHtml: string;
  sectionName: string | null;
  sectionSlug: string | null;
  /** Не входит в обязательный контракт ручки — читаем, если сервер пришлёт. */
  publishedAt?: string | null;
}

export type ArticleSection = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
};

export interface ArticleFeedPage {
  items: ArticleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ────────────────────────────────────────────────────────────── нормализация

/** Строка или null: сервер может прислать пустую строку вместо отсутствия. */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Один элемент ленты из сырого JSON. Запись без slug и заголовка бесполезна. */
export function toArticleListItem(raw: unknown): ArticleListItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const slug = asText(item.slug);
  const title = asText(item.title);
  if (!slug || !title) return null;

  return {
    id: asNumber(item.id),
    slug,
    title,
    summary: asText(item.summary),
    publishedAt: asText(item.publishedAt),
    sectionName: asText(item.sectionName),
    sectionSlug: asText(item.sectionSlug),
  };
}

/** Страница ленты: массив элементов и числа пагинации с безопасными значениями. */
export function toArticleFeedPage(raw: unknown): ArticleFeedPage {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(body.items) ? body.items : [];

  const items: ArticleListItem[] = [];
  for (const entry of list) {
    const parsed = toArticleListItem(entry);
    if (parsed) items.push(parsed);
  }

  return {
    items,
    total: Math.max(0, asNumber(body.total, items.length)),
    page: Math.max(1, asNumber(body.page, 1)),
    pageSize: Math.max(1, asNumber(body.pageSize, items.length || 1)),
  };
}

/** Разделы: без пустого slug — на такой раздел нет ссылки. */
export function toArticleSections(raw: unknown): ArticleSection[] {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(body.items) ? body.items : [];
  const sections: ArticleSection[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const slug = asText(item.slug);
    const name = asText(item.name);
    if (!slug || !name) continue;
    sections.push({
      id: asNumber(item.id),
      name,
      slug,
      description: asText(item.description),
      sortOrder: asNumber(item.sortOrder),
    });
  }

  return sections.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
}

// ────────────────────────────────────────────────────────────  запросы

async function getJson(path: string): Promise<unknown> {
  const url = `${API_BASE.replace(/\/+$/, '')}${path}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!response.ok) throw new Error(`articles responded ${response.status}`);
  return response.json();
}

/**
 * Лента опубликованных статей. Бросает при недоступном API — вызывающий
 * решает, показать «не загрузилось» или пустую полку.
 */
export async function loadArticleFeed(options: {
  section?: string | null;
  page?: number;
  pageSize?: number;
} = {}): Promise<ArticleFeedPage> {
  const params = new URLSearchParams();
  const section = typeof options.section === 'string' ? options.section.trim() : '';
  if (section) params.set('section', section);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));

  const query = params.toString();
  return toArticleFeedPage(await getJson(`/api/articles${query ? `?${query}` : ''}`));
}

/** Разделы статей. Пустой список при недоступном API: раздел без навигации ещё работает. */
export async function loadArticleSections(): Promise<ArticleSection[]> {
  try {
    return toArticleSections(await getJson('/api/articles/sections'));
  } catch (error) {
    console.warn(
      '[articles] разделы недоступны:',
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

/**
 * Статья по slug. `null` — статьи нет или она снята с публикации; страница
 * превращает это в 404, а не в пустую вёрстку.
 */
export async function loadArticle(slug: string): Promise<ArticleDetail | null> {
  const wanted = typeof slug === 'string' ? slug.trim() : '';
  if (!wanted) return null;

  let raw: unknown;
  try {
    raw = await getJson(`/api/articles/${encodeURIComponent(wanted)}`);
  } catch (error) {
    console.warn(
      '[articles] статья недоступна:',
      error instanceof Error ? error.message : error
    );
    return null;
  }

  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const resolvedSlug = asText(item.slug) ?? wanted;
  const title = asText(item.title);
  if (!title) return null;

  return {
    id: asNumber(item.id),
    slug: resolvedSlug,
    title,
    summary: asText(item.summary),
    // Пустое тело — не повод падать: страница покажет только заголовок.
    bodyHtml: typeof item.bodyHtml === 'string' ? item.bodyHtml : '',
    sectionName: asText(item.sectionName),
    sectionSlug: asText(item.sectionSlug),
    publishedAt: asText(item.publishedAt),
  };
}
