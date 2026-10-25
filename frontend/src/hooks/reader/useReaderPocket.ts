'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useReaderPocket(bookId: number, token?: string) {
  const [items, setItems] = useState<ReaderPocketItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const tokenRef = useRef(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) return;
    setIsLoading(true);
    try {
      const data = await getPocketWords(bookId, tokenRef.current);
      setItems(data.items);
    } catch {
      // карман — не блокирующее чтение
    } finally {
      setIsLoading(false);
    }
  }, [bookId]);

  const save = useCallback(
    async (payload: UpsertPocketPayload): Promise<ReaderPocketItem | null> => {
      const authToken = tokenRef.current;
      if (!authToken) return null;

      const entry: PocketQueueEntry = {
        ...payload,
        bookId,
        createdAt: Date.now(),
      };
      enqueuePocket(entry);

      try {
        const item = await upsertPocketWord(bookId, authToken, payload, true);
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

  const remove = useCallback(
    async (pocketId: number): Promise<boolean> => {
      if (!tokenRef.current) return false;
      try {
        await deletePocketWord(pocketId, tokenRef.current);
        setItems((current) => current.filter((item) => item.id !== pocketId));
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const promote = useCallback(
    async (pocketId: number): Promise<boolean> => {
      if (!tokenRef.current) return false;
      try {
        await promotePocketWord(pocketId, tokenRef.current);
        setItems((current) => current.filter((item) => item.id !== pocketId));
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const markKnown = useCallback(
    async (pocketId: number): Promise<boolean> => {
      if (!tokenRef.current) return false;
      try {
        await markPocketWordKnown(pocketId, tokenRef.current);
        setItems((current) => current.filter((item) => item.id !== pocketId));
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  useEffect(() => {
    if (!token) return;

    // Сначала досылаем то, что не успело уйти в прошлый раз. Записи чужих
    // книг остаются в очереди и отправятся при их открытии.
    void flushPocketQueue(
      async (entry) => {
        try {
          await upsertPocketWord(bookId, token, entry, true);
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
  }, [bookId, token]);

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
