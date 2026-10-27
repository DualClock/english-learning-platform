import { toProxyUrl } from '@/app/lib/proxy-path';
import type {
  ReaderBookmark,
  ReaderChapter,
  ReaderManifest,
  ReaderPocketItem,
  ReaderPocketListResponse,
  ReaderPositionResponse,
  ReaderReviewResponse,
  ReaderSentenceTranslation,
  ReaderSpeechManifest,
  ReaderWordLookup,
} from './types';

export class ReaderApiError extends Error {
  readonly status: number;
  /** Машинный код из тела ответа, если сервер его прислал. */
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'ReaderApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions extends RequestInit {
  keepalive?: boolean;
}

/**
 * Запрос читалки. `Authorization` здесь не ставится намеренно: токен живёт
 * только в httpOnly-куке, а подставляет его серверный прокси `/api/next/*`.
 * Пока заголовок собирался в JS, любой XSS забирал аккаунт на неделю.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(toProxyUrl(path), {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    let code: string | null = null;
    try {
      const body = (await response.json()) as {
        message?: string;
        error?: string;
        detail?: string;
        code?: string;
      };
      message = body.message || body.error || body.detail || message;
      code = typeof body.code === 'string' ? body.code : null;
    } catch {
      // тело не JSON — оставляем код
    }
    throw new ReaderApiError(response.status, message, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getReaderManifest(bookId: number): Promise<ReaderManifest> {
  return request<ReaderManifest>(`/api/reader/books/${bookId}`);
}

export function getReaderChapter(bookId: number, chapterId: string): Promise<ReaderChapter> {
  return request<ReaderChapter>(
    `/api/reader/books/${bookId}/chapters/${encodeURIComponent(chapterId)}`
  );
}

export function saveReaderPosition(
  bookId: number,
  body: {
    chapterId: string;
    sentenceId: string;
    charOffset: number;
    activeSeconds: number;
  },
  keepalive = false
): Promise<ReaderPositionResponse> {
  return request<ReaderPositionResponse>(`/api/reader/books/${bookId}/position`, {
    method: 'PUT',
    body: JSON.stringify(body),
    keepalive,
  });
}

export function getWordLookup(bookId: number, word: string): Promise<ReaderWordLookup> {
  return request<ReaderWordLookup>(
    `/api/reader/books/${bookId}/words/${encodeURIComponent(word)}`
  );
}

export function getSpeechManifest(
  bookId: number,
  chapterId: string,
  sentenceIds?: string[]
): Promise<ReaderSpeechManifest> {
  return request<ReaderSpeechManifest>(
    `/api/reader/books/${bookId}/chapters/${encodeURIComponent(chapterId)}/speech`,
    {
      method: 'POST',
      body: JSON.stringify({ sentenceIds: sentenceIds ?? [] }),
    }
  );
}

export function markBookFinished(bookId: number, chapterId: string): Promise<ReaderPositionResponse> {
  return request<ReaderPositionResponse>(`/api/reader/books/${bookId}/finished`, {
    method: 'POST',
    body: JSON.stringify({ chapterId }),
  });
}

export function translateWord(word: string, context?: string): Promise<ReaderWordLookup> {
  return request<ReaderWordLookup>('/api/ai/translate', {
    method: 'POST',
    body: JSON.stringify({
      word,
      context: context || undefined,
      targetLanguage: 'ru',
    }),
  });
}

export function translateSentence(text: string): Promise<ReaderSentenceTranslation> {
  return request<ReaderSentenceTranslation>('/api/ai/translate-sentence', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export interface UpsertPocketPayload {
  word: string;
  chapterId: string;
  sentenceId: string;
  translation?: string | null;
  partOfSpeech?: string | null;
}

export function upsertPocketWord(
  bookId: number,
  body: UpsertPocketPayload,
  keepalive = false
): Promise<ReaderPocketItem> {
  return request<ReaderPocketItem>(`/api/reader/books/${bookId}/pocket`, {
    method: 'POST',
    body: JSON.stringify(body),
    keepalive,
  });
}

export function deletePocketWord(pocketId: number): Promise<void> {
  return request<void>(`/api/reader/pocket/${pocketId}`, { method: 'DELETE' });
}

export function getPocketWords(bookId: number): Promise<ReaderPocketListResponse> {
  return request<ReaderPocketListResponse>(`/api/reader/books/${bookId}/pocket`);
}

export function getChapterReview(
  bookId: number,
  chapterId: string,
  limit = 8
): Promise<ReaderReviewResponse> {
  return request<ReaderReviewResponse>(
    `/api/reader/books/${bookId}/chapters/${encodeURIComponent(chapterId)}/review?limit=${limit}`
  );
}

export function promotePocketWord(pocketId: number): Promise<{ added: boolean; word: string }> {
  return request<{ added: boolean; word: string }>(
    `/api/reader/pocket/${pocketId}/promote`,
    { method: 'POST' }
  );
}

export function markPocketWordKnown(pocketId: number): Promise<{ known: boolean; word: string }> {
  return request<{ known: boolean; word: string }>(
    `/api/reader/pocket/${pocketId}/known`,
    { method: 'POST' }
  );
}

export function addReaderBookmark(
  bookId: number,
  body: { chapterId: string; sentenceId: string; charOffset: number; note?: string }
): Promise<ReaderBookmark> {
  return request<ReaderBookmark>(`/api/books/${bookId}/bookmarks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteReaderBookmark(bookId: number, bookmarkId: number): Promise<void> {
  return request<void>(`/api/books/${bookId}/bookmarks/${bookmarkId}`, {
    method: 'DELETE',
  });
}

/**
 * Адрес картинки/звука из ответа бэкенда.
 *
 * Относительный путь уходит в прокси только если это API-путь: статику Next
 * (`/illustrations/...`) прокси сломал бы, отправив её на бэкенд.
 */
export function resolveApiAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/api/') ? toProxyUrl(url) : url;
}
