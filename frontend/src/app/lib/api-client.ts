import { API_URL } from './api-url';

/**
 * Мини-клиент для API с in-memory кэшем.
 *
 * Зачем: раньше каждая страница при монтировании делала fetch и показывала
 * скелетон — при переключении вкладок это каждый раз давало «мигание» и
 * ожидание. Теперь ответы кэшируются, повторный заход на вкладку рисуется
 * мгновенно из кэша, а сеть обновляет данные в фоне.
 */

type CacheEntry = {
  data: unknown;
  at: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** Свежий кэш: столько миллисекунд данные считаются актуальными. */
export const DEFAULT_MAX_AGE_MS = 30_000;

export function cacheKey(path: string, token?: string | null): string {
  // Разные пользователи/сессии не должны видеть кэш друг друга.
  const scope = token ? token.slice(-24) : 'anon';
  return `${scope}:${path}`;
}

export function peekCache<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function cacheAge(key: string): number {
  const entry = cache.get(key);
  return entry ? Date.now() - entry.at : Number.POSITIVE_INFINITY;
}

export function writeCache(key: string, data: unknown): void {
  cache.set(key, { data, at: Date.now() });
}

/** Сбрасывает кэш целиком или только записи, содержащие `prefix`. */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.includes(prefix)) cache.delete(key);
  }
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiFetchOptions {
  token?: string | null;
  /** Сколько данных считаются свежими. 0 — всегда идти в сеть. */
  maxAgeMs?: number;
  /** Игнорировать кэш и обязательно сходить в сеть. */
  force?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_URL}${path}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `Ошибка запроса (${res.status})`;
    try {
      const json = JSON.parse(text);
      const message =
        json?.message || json?.title || json?.error || (Array.isArray(json) ? json[0]?.errorMessage : null);
      return message || `Ошибка запроса (${res.status})`;
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return `Ошибка запроса (${res.status})`;
  }
}

/**
 * GET с кэшем и дедупликацией параллельных запросов.
 */
export async function apiGet<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, maxAgeMs = DEFAULT_MAX_AGE_MS, force = false, signal } = options;
  const key = cacheKey(path, token);

  if (!force) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < maxAgeMs) {
      return cached.data as T;
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const res = await fetch(buildUrl(path), {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });

    if (!res.ok) {
      throw new ApiError(res.status, await readError(res));
    }

    const data = (await res.json()) as T;
    writeCache(key, data);
    return data;
  })();

  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

export interface ApiMutationOptions {
  token?: string | null;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Префиксы кэша, которые нужно сбросить после успешной мутации. */
  invalidate?: string[];
}

/** Запрос-мутация: не кэшируется, но умеет чистить связанный кэш. */
export async function apiMutate<T = unknown>(path: string, options: ApiMutationOptions = {}): Promise<T> {
  const { token, method = 'POST', body, headers, invalidate } = options;

  const res = await fetch(buildUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }

  if (invalidate?.length) {
    for (const prefix of invalidate) invalidateCache(prefix);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Фоновый прогрев кэша — используется при наведении на пункт меню. */
export function prefetchApi(paths: string[], token?: string | null): void {
  if (!token) return;
  for (const path of paths) {
    void apiGet(path, { token, maxAgeMs: DEFAULT_MAX_AGE_MS }).catch(() => {
      /* прогрев не должен ломать интерфейс */
    });
  }
}
