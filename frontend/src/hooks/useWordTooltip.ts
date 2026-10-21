'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '@/app/lib/api-url';
import { TOOLTIP_DELAY } from '@/components/reader/types';
import type { TooltipData, TooltipState } from '@/components/reader/types';

interface UseWordTooltipOptions {
  bookId: string;
  token?: string;
}

/** Карточка слова в тексте: кеш ответов, задержка наведения и закрытие по тапу мимо. */
export function useWordTooltip({ bookId, token }: UseWordTooltipOptions) {
  const cacheRef = useRef<Map<string, TooltipData | Promise<TooltipData | null>>>(new Map());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTooltip = useCallback((word: string): Promise<TooltipData | null> => {
    const cached = cacheRef.current.get(word);
    if (cached) {
      if (cached instanceof Promise) return cached;
      return Promise.resolve(cached);
    }
    const promise = fetch(
      `${API_URL}/api/books/${bookId}/word-tooltip?word=${encodeURIComponent(word)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then((res) => (res.ok ? res.json().catch(() => null) : null))
      .then((data) => {
        if (data) cacheRef.current.set(word, data as TooltipData);
        else cacheRef.current.delete(word);
        return data as TooltipData | null;
      })
      .catch((err) => {
        cacheRef.current.delete(word);
        console.error('Tooltip error:', err);
        return null;
      });
    cacheRef.current.set(word, promise);
    return promise;
  }, [bookId, token]);

  const showTooltip = useCallback((idx: number, cleanWord: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTooltip({ idx, word: cleanWord, data: null, loading: true, below: idx < 12 });
    fetchTooltip(cleanWord).then((data) => {
      setTooltip((prev) =>
        prev && prev.idx === idx && prev.word === cleanWord
          ? { ...prev, data, loading: false }
          : prev
      );
    });
  }, [fetchTooltip]);

  const hideTooltip = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTooltip(null);
  }, []);

  const handleMarkerEnter = useCallback((idx: number, cleanWord: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => showTooltip(idx, cleanWord), TOOLTIP_DELAY);
  }, [showTooltip]);

  // Тап мимо слова или карточки закрывает тултип
  useEffect(() => {
    if (!tooltip) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-word-tooltip]') || target?.closest('[data-marker-word]')) {
        return;
      }
      hideTooltip();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [tooltip, hideTooltip]);

  return {
    tooltip,
    showTooltip,
    hideTooltip,
    handleMarkerEnter,
    handleMarkerLeave: hideTooltip,
  };
}
