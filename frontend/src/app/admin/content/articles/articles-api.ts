/*
 * Клиент админского API статей.
 *
 * Отдельный файл от `../api.ts`: тот исторически про книги и словарь, и
 * смешивать в нём две разные ручки — значит однажды перепутать путь при
 * правке. Ходим через тот же серверный прокси `/api/next/[...path]` и через тот
 * же класс ошибки: 401/403 здесь значит «сессия без роли Admin», а не «сеть
 * отвалилась», и экран должен показать именно это.
 *
 * Пути — БЕЗ второго `/api`: прокси сам дописывает `/api/`, и
 * `/api/next/api/articles` превратился бы в `/api/api/articles` → 404.
 */

// Расширения указаны намеренно: этот модуль импортирует юнит-тест через
// `node --test` напрямую, а там резолвер Node не подставляет `.ts` и не знает
// про алиасы tsconfig. Бандлер Next такие импорты принимает.
import { AdminForbiddenError } from '../api.ts';
import { toProxyUrl } from '../../../lib/proxy-path.ts';
import { articlesAdminPath, type ArticleInput } from '../../../../lib/articles.ts';

interface ApiError {
  message?: string;
  title?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Через toProxyUrl: тот же склейщик, что у остального фронта, и второго
  // `/api` в адресе физически быть не может.
  const response = await fetch(toProxyUrl(path), {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new AdminForbiddenError();
  }

  if (!response.ok) {
    // ProblemDetails: поле message или title.
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as ApiError;
      detail = body.message ?? body.title ?? detail;
    } catch {
      /* тело не JSON — оставляем код */
    }
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;
  // DELETE может ответить пустым телом с 200 — это не повод падать на json().
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

// ─────────────────────────────────────────────────────────────── типы

/**
 * Строка таблицы админки.
 *
 * Статус — так, как его прислал бэкенд: enum может приехать числом (0/1/2,
 * настройки ASP.NET по умолчанию) или строкой. Приводить его здесь к тексту
 * нельзя — normalizeArticleStatus знает оба варианта, а `String(0)` дал бы
 * «0», которого в словаре статусов нет.
 */
export interface AdminArticleRow {
  id: number;
  slug: string;
  title: string;
  status: string | number;
  sectionId: number | null;
  sectionName: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Черновик для формы: тело приходит markdown, а не HTML. */
export interface AdminArticleDetail {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  status: string | number;
  sectionId: number | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  revisionCount: number;
}

export interface AdminArticleList {
  items: AdminArticleRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminArticleSection {
  id: number;
  name: string;
  slug: string;
}

export interface ArticleSectionOption {
  id: number;
  name: string;
  slug: string;
}

// ─────────────────────────────────────────────────────── безопасные значения

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Статус без приведения: число остаётся числом, строка — строкой (см. AdminArticleRow). */
function asStatus(value: unknown): string | number {
  if (typeof value === 'number') return value;
  return asText(value) ?? '';
}

/**
 * Список статей из ответа. Форму проверяем здесь, а не в компоненте: битый
 * элемент без id/заголовка иначе дал бы строку «undefined» в таблице и ключ
 * `undefined` в React-массиве — то есть исчезающие друг за другом строки.
 */
export function toAdminArticleList(raw: unknown): AdminArticleList {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(body.items) ? body.items : [];
  const items: AdminArticleRow[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = asId(row.id);
    const title = asText(row.title);
    if (id === null || !title) continue;

    items.push({
      id,
      slug: asText(row.slug) ?? '',
      title,
      status: asStatus(row.status),
      sectionId: asId(row.sectionId),
      sectionName: asText(row.sectionName),
      publishedAt: asText(row.publishedAt),
      createdAt: asText(row.createdAt),
      updatedAt: asText(row.updatedAt),
    });
  }

  return {
    items,
    total: typeof body.total === 'number' ? body.total : items.length,
    page: typeof body.page === 'number' && body.page >= 1 ? body.page : 1,
    pageSize: typeof body.pageSize === 'number' && body.pageSize >= 1 ? body.pageSize : 20,
  };
}

/** Черновик для формы. Пустые поля — пустые строки: controlled input не любит null. */
export function toAdminArticleDetail(raw: unknown): AdminArticleDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const id = asId(body.id);
  const title = asText(body.title);
  if (id === null || !title) return null;

  return {
    id,
    slug: asText(body.slug) ?? '',
    title,
    summary: asText(body.summary),
    // Именно bodyMarkdown: bodyHtml сюда не приходит, и подставить его значило
    // бы отправить обратно HTML в поле markdown.
    bodyMarkdown: typeof body.bodyMarkdown === 'string' ? body.bodyMarkdown : '',
    status: asStatus(body.status),
    sectionId: asId(body.sectionId),
    publishedAt: asText(body.publishedAt),
    createdAt: asText(body.createdAt),
    updatedAt: asText(body.updatedAt),
    revisionCount: typeof body.revisionCount === 'number' ? body.revisionCount : 0,
  };
}

/** Разделы для <select>: без имени или slug раздел в списке бесполезен. */
export function toArticleSectionOptions(raw: unknown): ArticleSectionOption[] {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(body.items) ? body.items : [];
  const options: ArticleSectionOption[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const id = asId(item.id);
    const name = asText(item.name);
    if (id === null || !name) continue;
    options.push({ id, name, slug: asText(item.slug) ?? '' });
  }

  return options;
}

// ─────────────────────────────────────────────────────────────── запросы

/** Список для таблицы: фильтр по статусу, поиск, страница. */
export async function listArticles(query: {
  status?: string | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
} = {}): Promise<AdminArticleList> {
  return toAdminArticleList(await call(articlesAdminPath(query)));
}

/** Черновик по id. null — статьи нет (удалена между загрузкой списка и кликом). */
export async function getArticle(id: number): Promise<AdminArticleDetail | null> {
  return toAdminArticleDetail(await call(`/api/articles/admin/${id}`));
}

/** Создать черновик. Тело всегда создаёт черновик; публикация — отдельным вызовом. */
export function createArticle(input: ArticleInput): Promise<{ id: number; slug: string; status: string }> {
  return call('/api/articles/admin', { method: 'POST', body: JSON.stringify(input) });
}

export function updateArticle(
  id: number,
  input: ArticleInput
): Promise<{ id: number; slug: string; status: string; updatedAt: string }> {
  return call(`/api/articles/admin/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function publishArticle(id: number): Promise<unknown> {
  return call(`/api/articles/admin/${id}/publish`, { method: 'POST' });
}

export function archiveArticle(id: number): Promise<unknown> {
  return call(`/api/articles/admin/${id}/archive`, { method: 'POST' });
}

export function deleteArticle(id: number): Promise<unknown> {
  return call(`/api/articles/admin/${id}`, { method: 'DELETE' });
}

export function restoreArticle(id: number): Promise<unknown> {
  return call(`/api/articles/admin/${id}/restore`, { method: 'POST' });
}

/** Разделы для выпадающего списка. Читаем публичной ручкой — она же нужна витрине. */
export async function listArticleSections(): Promise<ArticleSectionOption[]> {
  return toArticleSectionOptions(await call('/api/articles/sections'));
}
