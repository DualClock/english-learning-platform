/*
 * Клиент ручек AI-ассистента.
 *
 * Ручки живут на бэкенде: `/api/admin/assistant/status|article|word-examples`
 * (все требуют роль Admin). Ходим, как и весь остальной фронт, через серверный
 * прокси `/api/next/[...path]` и через `toProxyUrl` — второй `/api` в адресе
 * иначе превратился бы в `/api/api/...` и 404.
 *
 * Ошибку отдаём объектом `{status, data}`, а не `Error`: для ассистента важен
 * КОД ответа (429 «лимит» и 503 «выключен» — разные советы человеку), а в
 * `Error` он бы потерялся. Текст разбирает `normalizeAssistantError` из
 * `src/lib/assistant.ts` — там же его правила проверяются тестами.
 */

import { toProxyUrl } from '../../../lib/proxy-path.ts';
import type { ArticleDraft, ArticleDraftRequest } from '../../../../lib/assistant.ts';

/** Тело ошибки, как его прислал сервер: контракт — поле `error`. */
export type AssistantErrorBody =
  | { error?: string; message?: string; title?: string }
  | string
  | null;

/**
 * Успешный ответ или ошибка с кодом. Проверяющий код смотрит `ok`; так один
 * тип покрывает оба исхода и не требует try/catch ради разбора текста.
 */
export type AssistantResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: AssistantErrorBody };

async function post<T>(path: string, body?: unknown): Promise<AssistantResult<T>> {
  let response: Response;
  try {
    response = await fetch(toProxyUrl(path), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // Сеть не отвечает: статуса нет. 0 — сигнал «проверь связь», а не «сервер ругается».
    return { ok: false, status: 0, data: null };
  }

  const text = await response.text().catch(() => '');
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Не-JSON тело (страница ошибки прокси) — отдаём как есть, чтобы админ
      // увидел хоть что-то осмысленное вместо «HTTP 502».
      payload = text;
    }
  }

  if (!response.ok) {
    return { ok: false, status: response.status, data: payload as AssistantErrorBody };
  }

  return { ok: true, status: response.status, data: payload as T };
}

async function get<T>(path: string): Promise<AssistantResult<T>> {
  let response: Response;
  try {
    response = await fetch(toProxyUrl(path), { cache: 'no-store' });
  } catch {
    return { ok: false, status: 0, data: null };
  }

  const text = await response.text().catch(() => '');
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    return { ok: false, status: response.status, data: payload as AssistantErrorBody };
  }
  return { ok: true, status: response.status, data: payload as T };
}

/** Остаток дневного лимита и включённость ассистента. */
export function getAssistantStatus(): Promise<AssistantResult<unknown>> {
  return get('/api/admin/assistant/status');
}

/**
 * Черновик статьи. Тело уже собрано чистой функцией: пустая тема до сервера
 * не дойдёт (иначе вызов лимита списывается, а черновик пустой).
 */
export function generateArticleDraft(
  request: ArticleDraftRequest
): Promise<AssistantResult<ArticleDraft>> {
  return post('/api/admin/assistant/article', request);
}

export interface WordExample {
  sentence: string;
  translation: string;
}

/** Примеры предложений к слову словаря. */
export function generateWordExamples(input: {
  word: string;
  translation?: string;
  level?: string;
  count?: number;
}): Promise<AssistantResult<{ examples: WordExample[] }>> {
  return post('/api/admin/assistant/word-examples', input);
}
