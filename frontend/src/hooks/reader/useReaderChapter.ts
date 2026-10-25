'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getReaderChapter, ReaderApiError } from '@/lib/reader/api';
import type { ReaderChapter } from '@/lib/reader/types';

export function useReaderChapter(bookId: number, chapterId: string | null, token?: string) {
  const [chapter, setChapter] = useState<ReaderChapter | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const cacheRef = useRef(new Map<string, ReaderChapter>());
  const requestRef = useRef(0);
  const bookRef = useRef(bookId);

  useEffect(() => {
    if (bookRef.current !== bookId) {
      bookRef.current = bookId;
      cacheRef.current.clear();
    }
  }, [bookId]);

  const load = useCallback(
    async (id: string) => {
      if (!token) return;
      const cached = cacheRef.current.get(id);
      if (cached) {
        setChapter(cached);
        setError('');
        setIsLoading(false);
        return;
      }

      const requestId = ++requestRef.current;
      setIsLoading(true);
      try {
        const data = await getReaderChapter(bookId, id, token);
        if (requestId !== requestRef.current) return;
        cacheRef.current.set(id, data);
        setChapter(data);
        setError('');
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setError(
          err instanceof ReaderApiError
            ? err.status === 404
              ? 'Глава не найдена в этой книге.'
              : err.message
            : 'Не удалось загрузить главу. Проверьте соединение.'
        );
      } finally {
        if (requestId === requestRef.current) setIsLoading(false);
      }
    },
    [bookId, token]
  );

  useEffect(() => {
    if (!chapterId) return;
    void load(chapterId);
  }, [chapterId, load]);

  const prefetch = useCallback(
    async (id: string) => {
      if (!token || !id || cacheRef.current.has(id)) return;
      try {
        const data = await getReaderChapter(bookId, id, token);
        cacheRef.current.set(id, data);
      } catch {
        // предзагрузка не должна влиять на чтение
      }
    },
    [bookId, token]
  );

  const reload = useCallback(() => {
    if (chapterId) {
      cacheRef.current.delete(chapterId);
      void load(chapterId);
    }
  }, [chapterId, load]);

  return { chapter, isLoading, error, prefetch, reload };
}
