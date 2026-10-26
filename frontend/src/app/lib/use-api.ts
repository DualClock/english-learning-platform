'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, ApiError, cacheKey, peekCache, DEFAULT_MAX_AGE_MS } from './api-client';

export interface UseApiQueryOptions {
  /** Сколько миллисекунд кэш считается свежим (0 — всегда обновлять в фоне). */
  maxAgeMs?: number;
  enabled?: boolean;
}

export interface UseApiQueryResult<T> {
  data: T | undefined;
  error: string | null;
  /** Машинный код ошибки (`email_confirmation_required`), если сервер его прислал. */
  errorCode: string | null;
  isLoading: boolean;
  refresh: () => void;
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось загрузить данные';
}

function toErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/**
 * GET-запрос с мгновенной отдачей из кэша.
 *
 * Поведение при переходе на вкладку:
 *  1. если данные уже есть в кэше — они рисуются сразу, без скелетона;
 *  2. свежий кэш (< maxAgeMs) вообще не ходит в сеть;
 *  3. устаревший кэш обновляется в фоне, интерфейс не мигает.
 *
 * Токена у хука нет: `Authorization` ставит серверный прокси из httpOnly-куки.
 * Гейт остаётся только по пути и `enabled` — «ещё не авторизован» и «пустой
 * путь» теперь неразличимы, и это не страшно: без сессии прокси ответит 401,
 * и хук покажет ошибку, а не пустые данные.
 */
export function useApiQuery<T>(
  path: string | null | undefined,
  options: UseApiQueryOptions = {}
): UseApiQueryResult<T> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const enabled = options.enabled !== false;

  const key = path ? cacheKey(path) : null;

  const [data, setData] = useState<T | undefined>(() => (key ? peekCache<T>(key) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => !(key && peekCache(key) !== undefined));
  const [tick, setTick] = useState(0);
  const forceRef = useRef(false);

  useEffect(() => {
    if (!path || !enabled) return;

    // Путь мог появиться уже после монтирования: начальный стейт считался по
    // null-ключу и остался бы `isLoading: true` без единого запроса.
    const cached = peekCache<T>(cacheKey(path));

    if (cached !== undefined) {
      setData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    let cancelled = false;
    const force = forceRef.current;
    forceRef.current = false;

    apiGet<T>(path, { maxAgeMs, force })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setErrorCode(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(toMessage(err));
        setErrorCode(toErrorCode(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, enabled, maxAgeMs, tick]);

  const refresh = useCallback(() => {
    forceRef.current = true;
    setTick((value) => value + 1);
  }, []);

  return { data, error, errorCode, isLoading, refresh };
}
