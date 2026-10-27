'use client';

import { useCallback, useEffect, useRef } from 'react';
import { saveReaderPosition } from '@/lib/reader/api';
import type { ReaderAnchor } from '@/lib/reader/types';

interface PendingPosition {
  chapterId: string;
  sentenceId: string;
  charOffset: number;
}

/**
 * Сохраняет место с задержкой и копит реальное время чтения. Секунды
 * прибавляются только при видимой вкладке, а при уходе со страницы позиция
 * всё равно уходит (keepalive), даже если минута ещё не набежала.
 *
 * Токена у хука нет: `Authorization` подставляет серверный прокси, поэтому
 * отвалидировать «есть ли сессия» здесь нечем — 401 придёт ответом, и время
 * вернётся в счётчик, как и при любом сетевом сбое.
 */
export function useProgressSync(bookId: number) {
  const pendingRef = useRef<PendingPosition | null>(null);
  const secondsRef = useRef(0);
  const lastTickRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addVisibleTime = useCallback(() => {
    const now = Date.now();
    if (lastTickRef.current === 0) {
      lastTickRef.current = now;
      return;
    }

    const elapsed = Math.min(45, Math.max(0, (now - lastTickRef.current) / 1000));
    lastTickRef.current = now;
    if (typeof document !== 'undefined' && !document.hidden) {
      secondsRef.current += elapsed;
    }
  }, []);

  const flush = useCallback(
    (keepalive = false) => {
      const pending = pendingRef.current;
      if (!pending) return;

      addVisibleTime();
      const seconds = Math.floor(secondsRef.current);
      if (seconds < 1 && !keepalive) return;

      secondsRef.current -= seconds;
      void saveReaderPosition(
        bookId,
        {
          ...pending,
          activeSeconds: seconds,
        },
        keepalive
      ).catch(() => {
        // не теряем накопленное время: следующий тик попробует снова
        secondsRef.current += seconds;
      });
    },
    [addVisibleTime, bookId]
  );

  const schedule = useCallback(
    (anchor: ReaderAnchor, chapterId: string) => {
      addVisibleTime();
      pendingRef.current = {
        chapterId,
        sentenceId: anchor.sentenceId,
        charOffset: anchor.charOffset,
      };

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flush(false), 1200);
    },
    [addVisibleTime, flush]
  );

  useEffect(() => {
    lastTickRef.current = Date.now();

    const onVisibilityChange = () => {
      if (document.hidden) {
        flush(true);
      } else {
        lastTickRef.current = Date.now();
      }
    };

    const interval = setInterval(addVisibleTime, 15_000);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
      flush(true);
    };
  }, [addVisibleTime, flush]);

  return { schedule, flush };
}
