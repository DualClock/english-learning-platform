'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getReaderManifest, ReaderApiError } from '@/lib/reader/api';
import type { ReaderBookmark, ReaderManifest } from '@/lib/reader/types';

export function useReaderSession(bookId: number) {
  const [manifest, setManifest] = useState<ReaderManifest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = ++requestRef.current;
    setIsLoading(true);
    try {
      const data = await getReaderManifest(bookId);
      if (requestId !== requestRef.current) return;
      setManifest(data);
      setError('');
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const message =
        err instanceof ReaderApiError
          ? err.status === 404
            ? 'Книга не найдена или ещё не разобрана. Попробуйте открыть её из библиотеки.'
            : err.message
          : 'Не удалось открыть книгу. Проверьте соединение.';
      setError(message);
    } finally {
      inFlightRef.current = false;
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBookmarks = useCallback((next: ReaderBookmark[]) => {
    setManifest((current) => (current ? { ...current, bookmarks: next } : current));
  }, []);

  const setPocketCount = useCallback((count: number) => {
    setManifest((current) => (current ? { ...current, pocketCount: Math.max(0, count) } : current));
  }, []);

  return {
    manifest,
    isLoading,
    error,
    reload: load,
    updateBookmarks,
    setPocketCount,
  };
}
