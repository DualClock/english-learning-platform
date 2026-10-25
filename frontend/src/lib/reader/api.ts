import { API_URL } from '@/app/lib/api-url';
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

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ReaderApiError';
    this.status = status;
  }
}

interface RequestOptions extends RequestInit {
  keepalive?: boolean;
}

async function request<T>(path: string, token: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string; detail?: string };
      message = body.message || body.error || body.detail || message;
    } catch {
      // тело не JSON — оставляем код
    }
    throw new ReaderApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getReaderManifest(bookId: number, token: string): Promise<ReaderManifest> {
  return request<ReaderManifest>(`/api/reader/books/${bookId}`, token);
}

export function getReaderChapter(
  bookId: number,
  chapterId: string,
  token: string
): Promise<ReaderChapter> {
  return request<ReaderChapter>(
    `/api/reader/books/${bookId}/chapters/${encodeURIComponent(chapterId)}`,
    token
  );
}

export function saveReaderPosition(
  bookId: number,
  token: string,
  body: {
    chapterId: string;
    sentenceId: string;
    charOffset: number;
    activeSeconds: number;
  },
  keepalive = false
): Promise<ReaderPositionResponse> {
  return request<ReaderPositionResponse>(`/api/reader/books/${bookId}/position`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
    keepalive,
  });
}

export function getWordLookup(bookId: number, word: string, token: string): Promise<ReaderWordLookup> {
  return request<ReaderWordLookup>(
    `/api/reader/books/${bookId}/words/${encodeURIComponent(word)}`,
    token
  );
}

export function getSpeechManifest(
  bookId: number,
  chapterId: string,
  token: string,
  sentenceIds?: string[]
): Promise<ReaderSpeechManifest> {
  return request<ReaderSpeechManifest>(
    `/api/reader/books/${bookId}/chapters/${encodeURIComponent(chapterId)}/speech`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ sentenceIds: sentenceIds ?? [] }),
    }
  );
}

export function markBookFinished(
  bookId: number,
  token: string,
  chapterId: string
): Promise<ReaderPositionResponse> {
  return request<ReaderPositionResponse>(`/api/reader/books/${bookId}/finished`, token, {
    method: 'POST',
    body: JSON.stringify({ chapterId }),
  });
}

export function translateWord(
  word: string,
  token: string,
  context?: string
): Promise<ReaderWordLookup> {
  return request<ReaderWordLookup>('/api/ai/translate', token, {
    method: 'POST',
    body: JSON.stringify({
      word,
      context: context || undefined,
      targetLanguage: 'ru',
    }),
  });
}

export function translateSentence(text: string, token: string): Promise<ReaderSentenceTranslation> {
  return request<ReaderSentenceTranslation>('/api/ai/translate-sentence', token, {
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
  token: string,
  body: UpsertPocketPayload,
  keepalive = false
): Promise<ReaderPocketItem> {
  return request<ReaderPocketItem>(`/api/reader/books/${bookId}/pocket`, token, {
    method: 'POST',
    body: JSON.stringify(body),
    keepalive,
  });
}

export function deletePocketWord(pocketId: number, token: string): Promise<void> {
  return request<void>(`/api/reader/pocket/${pocketId}`, token, { method: 'DELETE' });
}

export function getPocketWords(bookId: number, token: string): Promise<ReaderPocketListResponse> {
  return request<ReaderPocketListResponse>(`/api/reader/books/${bookId}/pocket`, token);
}

export function getChapterReview(
  bookId: number,
  chapterId: string,
  token: string,
  limit = 8
): Promise<ReaderReviewResponse> {
  return request<ReaderReviewResponse>(
    `/api/reader/books/${bookId}/chapters/${encodeURIComponent(chapterId)}/review?limit=${limit}`,
    token
  );
}

export function promotePocketWord(
  pocketId: number,
  token: string
): Promise<{ added: boolean; word: string }> {
  return request<{ added: boolean; word: string }>(
    `/api/reader/pocket/${pocketId}/promote`,
    token,
    { method: 'POST' }
  );
}

export function markPocketWordKnown(
  pocketId: number,
  token: string
): Promise<{ known: boolean; word: string }> {
  return request<{ known: boolean; word: string }>(
    `/api/reader/pocket/${pocketId}/known`,
    token,
    { method: 'POST' }
  );
}

export function addReaderBookmark(
  bookId: number,
  token: string,
  body: { chapterId: string; sentenceId: string; charOffset: number; note?: string }
): Promise<ReaderBookmark> {
  return request<ReaderBookmark>(`/api/books/${bookId}/bookmarks`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteReaderBookmark(
  bookId: number,
  bookmarkId: number,
  token: string
): Promise<void> {
  return request<void>(`/api/books/${bookId}/bookmarks/${bookmarkId}`, token, {
    method: 'DELETE',
  });
}

export function resolveApiAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${API_URL}${url}`;
}
