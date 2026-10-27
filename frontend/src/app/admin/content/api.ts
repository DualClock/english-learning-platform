/*
 * Клиент админского API.
 *
 * Все запросы идут через серверный прокси /api/next/[...path]: он подставляет
 * access-токен из httpOnly-куки NextAuth. Браузер токена не видит и передать
 * его напрямую на бэкенд не может.
 *
 * 403 здесь — не «ошибка сети», а «сессия без роли Admin». Отдельный класс
 * ошибки нужен, чтобы экран показал честное сообщение, а не «попробуйте ещё раз».
 */

// Относительные пути с расширением: этот модуль косвенно импортирует
// articles-admin.test.mjs через `node --test`, а там резолвер Node не знает
// про алиас `@/` и не подставляет `.ts` (см. тот же приём в articles-api.ts).
import { toProxyUrl } from '../../lib/proxy-path.ts';
import { importRequestPath } from '../../../lib/word-import.ts';

export class AdminForbiddenError extends Error {
  constructor() {
    super('Нужны права администратора.');
    this.name = 'AdminForbiddenError';
  }
}

interface ApiError {
  message?: string;
  title?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/next${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401) {
    throw new AdminForbiddenError();
  }
  if (response.status === 403) {
    throw new AdminForbiddenError();
  }

  if (!response.ok) {
    // Бэкенд отвечает ProblemDetails с полем message или title.
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as ApiError;
      detail = body.message ?? body.title ?? detail;
    } catch {
      // тело не JSON — оставляем код
    }
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ─────────────────────────────────────────────────────────────── типы

export interface AdminWord {
  id: number;
  english: string;
  translation: string;
  transcription: string | null;
  example: string | null;
  /** Загруженная картинка: /uploads/word-images/<guid>.webp или null. */
  imageUrl: string | null;
  deletedAt: string | null;
}

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  deletedAt: string | null;
  words: AdminWord[];
}

export interface AdminBook {
  id: number;
  title: string;
  author: string | null;
  cefrLevel: string | null;
  coverUrl: string | null;
  uploadedByUserId: string | null;
  deletedAt: string | null;
  isPublic: boolean;
}

export interface CategoryInput {
  name: string;
  slug?: string;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
}

export interface WordInput {
  english: string;
  translation: string;
  transcription?: string | null;
  example?: string | null;
}

// ──────────────────────────────────────────────────────────── категории

export function listCategories(includeDeleted = false): Promise<AdminCategory[]> {
  return call(`/admin/content/categories?includeDeleted=${includeDeleted}`);
}

export function createCategory(input: CategoryInput): Promise<{ id: number; slug: string }> {
  return call('/admin/content/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCategory(id: number, input: CategoryInput): Promise<{ id: number }> {
  return call(`/admin/content/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteCategory(id: number): Promise<{ id: number }> {
  return call(`/admin/content/categories/${id}`, { method: 'DELETE' });
}

export function restoreCategory(id: number): Promise<{ id: number }> {
  return call(`/admin/content/categories/${id}/restore`, { method: 'POST' });
}

// ───────────────────────────────────────────────────────────────── слова

export function createWord(categoryId: number, input: WordInput): Promise<{ id: number }> {
  return call(`/admin/content/categories/${categoryId}/words`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateWord(id: number, input: WordInput): Promise<{ id: number }> {
  return call(`/admin/content/words/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteWord(id: number): Promise<{ id: number }> {
  return call(`/admin/content/words/${id}`, { method: 'DELETE' });
}

export function restoreWord(id: number): Promise<{ id: number }> {
  return call(`/admin/content/words/${id}/restore`, { method: 'POST' });
}

// ──────────────────────────────────────────────────────────── картинка слова

/**
 * Загрузить картинку слову.
 *
 * Отдельный путь, а не `call`: здесь FormData, и Content-Type выставляет
 * браузер (с boundary). Если поставить `application/json`, сервер не разберёт
 * multipart и ответит 415.
 */
export async function uploadWordImage(id: number, file: File): Promise<{ imageUrl: string }> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`/api/next/admin/content/words/${id}/image`, {
    method: 'POST',
    body,
    cache: 'no-store',
  });

  if (response.status === 401 || response.status === 403) {
    throw new AdminForbiddenError();
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as ApiError;
      detail = data.message ?? data.title ?? detail;
    } catch {
      /* тело не JSON */
    }
    throw new Error(detail);
  }

  return (await response.json()) as { imageUrl: string };
}

export function deleteWordImage(id: number): Promise<{ imageUrl: null }> {
  return call(`/admin/content/words/${id}/image`, { method: 'DELETE' });
}

// ─────────────────────────────────────────────────────────────── импорт слов

/**
 * Импорт слов из CSV/JSON.
 *
 * Не через `call`: здесь FormData, и Content-Type выставляет браузер (с
 * boundary). Явный `application/json` сломал бы разбор multipart на сервере.
 *
 * Ответ и ошибки разбирает вызывающий код — через readImportResponse и
 * describeImportHttpError из @/lib/word-import. Этот клиент отдаёт сырые тело и
 * статус: 400/409/413 нужно перевести в текст, который зависит от того, что
 * именно вернул сервер, а не только от кода.
 *
 * 401/403 здесь, как и в остальных ручках админки, — отсутствие роли Admin.
 * Бросаем AdminForbiddenError, чтобы экран показал честное «нужны права»,
 * а не «файл не подошёл».
 */
export async function importWords(
  categoryId: number,
  file: File,
  dryRun: boolean,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; body: unknown }> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(toProxyUrl(importRequestPath(categoryId, dryRun)), {
    method: 'POST',
    body,
    cache: 'no-store',
  });

  if (response.status === 401 || response.status === 403) {
    throw new AdminForbiddenError();
  }

  // Тело читаем один раз и терпим не-JSON: у 413 от прокси или nginx тело
  // бывает HTML, и падение на json() скрыло бы сам код ответа.
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return response.ok ? { ok: true, body: parsed } : { ok: false, status: response.status, body: parsed };
}

// ─────────────────────────────────────────────────────────────── загрузка EPUB

/**
 * Загрузить EPUB в общий каталог.
 *
 * В отличие от загрузки из «Библиотеки», владельца у книги не будет: она
 * сразу публичная и видна на гостевой витрине.
 */
export async function uploadBook(file: File): Promise<{ id: number; title: string }> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch('/api/next/admin/content/books/upload', {
    method: 'POST',
    body,
    cache: 'no-store',
  });

  if (response.status === 401 || response.status === 403) {
    throw new AdminForbiddenError();
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as ApiError;
      detail = data.message ?? data.title ?? detail;
    } catch {
      /* тело не JSON */
    }
    throw new Error(detail);
  }

  return (await response.json()) as { id: number; title: string };
}

// ────────────────────────────────────────────────────────────────── книги

export function listBooks(includeDeleted = false): Promise<AdminBook[]> {
  return call(`/admin/content/books?includeDeleted=${includeDeleted}`);
}

export function publishBook(id: number): Promise<{ id: number }> {
  return call(`/admin/content/books/${id}/publish`, { method: 'POST' });
}

export function deleteBook(id: number): Promise<{ id: number }> {
  return call(`/admin/content/books/${id}`, { method: 'DELETE' });
}

export function restoreBook(id: number): Promise<{ id: number }> {
  return call(`/admin/content/books/${id}/restore`, { method: 'POST' });
}
