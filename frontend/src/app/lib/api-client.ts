// Расширение указано намеренно: этот модуль импортируют юнит-тесты через
// `node --test` напрямую (.mjs), а там резолвер Node не подставляет `.ts`
// и не знает про алиасы tsconfig. Бандлер Next такое расширение допускает.
import { toProxyUrl } from './proxy-path.ts';

/**
 * Мини-клиент для API с in-memory кэшем.
 *
 * Зачем: раньше каждая страница при монтировании делала fetch и показывала
 * скелетон — при переключении вкладок это каждый раз давало «мигание» и
 * ожидание. Теперь ответы кэшируются, повторный заход на вкладку рисуется
 * мгновенно из кэша, а сеть обновляет данные в фоне.
 *
 * Токена здесь нет: браузер ходит только своим origin'ом на `/api/next/<путь>`,
 * а `Authorization` подставляет серверный прокси (`src/app/api/next/[...path]`)
 * из httpOnly-куки. Поэтому и ключ кэша — чистый путь: скоуп «свой/чужой»
 * держит сервер, а не строка в JS.
 */

type CacheEntry = {
  data: unknown;
  at: number;
};

/**
 * Предел числа записей. Без него Map рос всю сессию: каждая посещённая
 * страница добавляла 3–6 записей, и на телефоне это заметная память.
 * 100 покрывает текущий набор запросов с запасом.
 */
export const MAX_CACHE_ENTRIES = 100;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** Свежий кэш: столько миллисекунд данные считаются актуальными. */
export const DEFAULT_MAX_AGE_MS = 30_000;

export function cacheKey(path: string): string {
  return path;
}

export function peekCache<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function cacheAge(key: string): number {
  const entry = cache.get(key);
  return entry ? Date.now() - entry.at : Number.POSITIVE_INFINITY;
}

/**
 * Какие ключи вытеснить, если записей больше предела. Чистая функция, чтобы
 * правило «первым уходит самое старое `at`» проверялось тестом без настоящего Map.
 */
export function evictedKeys(
  entries: readonly { key: string; at: number }[],
  limit: number = MAX_CACHE_ENTRIES
): string[] {
  if (entries.length <= limit) return [];
  return [...entries]
    .sort((left, right) => left.at - right.at)
    .slice(0, entries.length - limit)
    .map((entry) => entry.key);
}

function trimCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const entries = Array.from(cache, ([key, entry]) => ({ key, at: entry.at }));
  for (const key of evictedKeys(entries)) cache.delete(key);
}

export function writeCache(key: string, data: unknown): void {
  // delete + set перемещает ключ в конец и обновляет `at`: повторная запись
  // по тому же ключу не занимает в Map второе место.
  cache.delete(key);
  cache.set(key, { data, at: Date.now() });
  trimCache();
}

/** Сбрасывает кэш целиком или только записи, начинающиеся с `prefix`. */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  // Именно startsWith: `includes` сносил соседние разделы — `/api/books`
  // стирал `/api/bookmarks`, и после сохранения закладки пропадал кэш книг.
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Только для юнит-тестов: кэш живёт в замыкании модуля. */
export function __resetCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export class ApiError extends Error {
  status: number;
  /** Машинный код из тела ответа (`email_confirmation_required`), если он есть. */
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ParsedApiError {
  message: string;
  code: string | null;
}

/**
 * Код ошибки — машинный идентификатор, а не фраза для человека. Регэксп отсекает
 * `{ error: 'Сервис недоступен' }`: иначе фронт искал бы ветку по фразе.
 */
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

function asErrorCode(value: unknown): string | null {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : null;
}

/**
 * Разбор тела ошибки бэкенда. Вынесен из `Response`, чтобы правило «где живёт
 * код» проверялось юнит-тестом на реальных телах ASP.NET: `{ error, message }`,
 * ProblemDetails `{ title, code }`, массив ошибок валидации и не-JSON текст.
 */
export function parseApiErrorBody(text: string, status: number): ParsedApiError {
  const fallback = `Ошибка запроса (${status})`;
  if (!text) return { message: fallback, code: null };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200), code: null };
  }

  if (Array.isArray(json)) {
    const first = json[0] as { errorMessage?: unknown } | undefined;
    const message = typeof first?.errorMessage === 'string' ? first.errorMessage : '';
    return { message: message || fallback, code: null };
  }

  if (!json || typeof json !== 'object') return { message: text.slice(0, 200), code: null };

  const body = json as { message?: unknown; title?: unknown; error?: unknown; code?: unknown };

  // `error` в этом API — и машинный код (`email_confirmation_required`), и
  // иногда человеческая фраза. Кодом считаем только похожее на код; явное
  // поле `code` важнее.
  const code = asErrorCode(body.code) ?? asErrorCode(body.error);
  const humanMessage =
    (typeof body.message === 'string' && body.message) ||
    (typeof body.title === 'string' && body.title) ||
    (typeof body.error === 'string' && !asErrorCode(body.error) && body.error) ||
    '';

  return { message: humanMessage || fallback, code };
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = parseApiErrorBody(await res.text().catch(() => ''), res.status);
  return new ApiError(res.status, parsed.message, parsed.code);
}

export interface ApiFetchOptions {
  /** Сколько данных считаются свежими. 0 — всегда идти в сеть. */
  maxAgeMs?: number;
  /** Игнорировать кэш и обязательно сходить в сеть. */
  force?: boolean;
  signal?: AbortSignal;
}

/**
 * 401 от API — это не выход из аккаунта: сессия NextAuth может быть жива,
 * а access-токен уже истёк. AppLayout по этому событию просит NextAuth
 * обновить токен; на /login уводит только собственная проверка сессии.
 */
function notifyUnauthorized(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lexicon:unauthorized'));
}

const ACHIEVEMENT_MUTATION_PATHS = [
  /^\/api\/review\//,
  /^\/api\/dictionary/,
  /^\/api\/categories\//,
  /^\/api\/grammar\//,
  /^\/api\/practice\//,
  /^\/api\/writing/,
  /^\/api\/quiz/,
  /^\/api\/reading\//,
  /^\/api\/wordlists\//,
  /^\/api\/books\//,
];

/**
 * Действие могло открыть достижение. Слушатель в AppLayout проверит прогресс
 * и покажет неблокирующий тост; здесь не знаем, что именно открылось.
 */
function notifyProgressChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lexicon:progress-changed'));
}

/**
 * GET с кэшем и дедупликацией параллельных запросов.
 */
export async function apiGet<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, force = false, signal } = options;
  const key = cacheKey(path);

  if (!force) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < maxAgeMs) {
      return cached.data as T;
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const res = await fetch(toProxyUrl(path), { signal });

    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      throw await toApiError(res);
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
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Префиксы кэша, которые нужно сбросить после успешной мутации. */
  invalidate?: string[];
}

/** Запрос-мутация: не кэшируется, но умеет чистить связанный кэш. */
export async function apiMutate<T = unknown>(path: string, options: ApiMutationOptions = {}): Promise<T> {
  const { method = 'POST', body, headers, invalidate } = options;

  // FormData (загрузка EPUB, аватара) уходит как есть: Content-Type с boundary
  // ставит браузер, а собранный вручную заголовок ломает разбор тела на сервере.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const res = await fetch(toProxyUrl(path), {
    method,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    throw await toApiError(res);
  }

  if (invalidate?.length) {
    for (const prefix of invalidate) invalidateCache(prefix);
  }

  if (ACHIEVEMENT_MUTATION_PATHS.some((pattern) => pattern.test(path))) {
    notifyProgressChanged();
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
export function prefetchApi(paths: string[]): void {
  for (const path of paths) {
    void apiGet(path, { maxAgeMs: DEFAULT_MAX_AGE_MS }).catch(() => {
      /* прогрев не должен ломать интерфейс */
    });
  }
}
