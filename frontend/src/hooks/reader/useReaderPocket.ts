'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deletePocketWord,
  getPocketWords,
  markPocketWordKnown,
  promotePocketWord,
  ReaderApiError,
  upsertPocketWord,
  type UpsertPocketPayload,
} from '@/lib/reader/api';
import {
  enqueuePocket,
  flushPocketQueue,
  removePocketFromQueue,
  type PocketQueueEntry,
} from '@/lib/reader/pocketQueue';
import type { ReaderPocketItem } from '@/lib/reader/types';

/**
 * Карман книги. Токена больше нет: `Authorization` ставит серверный прокси,
 * поэтому единственный гейт — сам факт, что читалка открыта (страница за
 * middleware). Без сессии прокси ответит 401, и карман просто останется пустым.
 */
export function useReaderPocket(bookId: number) {
  const [items, setItems] = useState<ReaderPocketItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getPocketWords(bookId);
      setItems(data.items);
    } catch {
      // карман — не блокирующее чтение
    } finally {
      setIsLoading(false);
    }
  }, [bookId]);

  const save = useCallback(
    async (payload: UpsertPocketPayload): Promise<ReaderPocketItem | null> => {
      const entry: PocketQueueEntry = {
        ...payload,
        bookId,
        createdAt: Date.now(),
      };
      enqueuePocket(entry);

      try {
        const item = await upsertPocketWord(bookId, payload, true);
        removePocketFromQueue(entry);
        setItems((current) => [
          item,
          ...current.filter(
            (existing) => existing.id !== item.id && existing.word.toLowerCase() !== item.word.toLowerCase()
          ),
        ]);
        return item;
      } catch (error) {
        if (error instanceof ReaderApiError && (error.status === 400 || error.status === 404)) {
          removePocketFromQueue(entry);
        }
        return null;
      }
    },
    [bookId]
  );

  const remove = useCallback(async (pocketId: number): Promise<boolean> => {
    try {
      await deletePocketWord(pocketId);
      setItems((current) => current.filter((item) => item.id !== pocketId));
      return true;
    } catch {
      return false;
    }
  }, []);

  const promote = useCallback(async (pocketId: number): Promise<boolean> => {
    try {
      await promotePocketWord(pocketId);
      setItems((current) => current.filter((item) => item.id !== pocketId));
      return true;
    } catch {
      return false;
    }
  }, []);

  const markKnown = useCallback(async (pocketId: number): Promise<boolean> => {
    try {
      await markPocketWordKnown(pocketId);
      setItems((current) => current.filter((item) => item.id !== pocketId));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    // Сначала досылаем то, что не успело уйти в прошлый раз. Записи чужих
    // книг остаются в очереди и отправятся при их открытии.
    void flushPocketQueue(
      async (entry) => {
        try {
          await upsertPocketWord(bookId, entry, true);
          return { ok: true };
        } catch (error) {
          if (error instanceof ReaderApiError && (error.status === 400 || error.status === 404)) {
            return { ok: false, drop: true };
          }
          return { ok: false };
        }
      },
      (entry) => entry.bookId === bookId
    );
  }, [bookId]);

  return {
    items,
    isLoading,
    refresh,
    save,
    remove,
    promote,
    markKnown,
  };
}
