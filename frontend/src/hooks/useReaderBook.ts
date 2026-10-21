'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '@/app/lib/api-url';
import type {
  Book,
  BookContent,
  BookDifficulty,
  Bookmark,
  TocItem,
} from '@/components/reader/types';

interface UseReaderBookOptions {
  bookId: string;
  token?: string;
  onBookOpened?: (title?: string) => void;
}

/**
 * Данные книги и всё, что подгружается к ней при открытии: страница,
 * оглавление, закладки, сложность и знакомые слова. Любая из
 * дополнительных частей может не прийти — чтение остаётся рабочим.
 */
export function useReaderBook({ bookId, token, onBookOpened }: UseReaderBookOptions) {
  const [book, setBook] = useState<Book | null>(null);
  const [content, setContent] = useState<BookContent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [difficulty, setDifficulty] = useState<BookDifficulty | null>(null);
  const [knownWords, setKnownWords] = useState<Set<string>>(new Set());
  const [knownBusy, setKnownBusy] = useState(false);

  const pageRequestRef = useRef(0);
  const readerDataLoadedRef = useRef(false);
  const onBookOpenedRef = useRef(onBookOpened);

  useEffect(() => {
    onBookOpenedRef.current = onBookOpened;
  });

  const loadBook = useCallback(async () => {
    try {
      if (!token) return; // ждём готовности сессии — эффект перезапустится сам
      const res = await fetch(`${API_URL}/api/books/${bookId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Book load error:', res.status, errorText);
        throw new Error(`Ошибка загрузки книги: ${res.status}`);
      }

      const data = await res.json();
      setBook(data);
      setError('');
      setIsLoading(false);
      onBookOpenedRef.current?.(data?.title);
    } catch (err) {
      console.error('Load book error:', err);
      setError(err instanceof Error ? err.message : 'Ошибка загрузки книги');
      setIsLoading(false);
    }
  }, [token, bookId]);

  const loadPage = useCallback(async (page: number) => {
    // Защита от гонки: при быстром перелистывании применяем только последний ответ
    const requestId = ++pageRequestRef.current;
    try {
      if (!token) return;
      const res = await fetch(`${API_URL}/api/books/${bookId}/content?page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Page load error:', res.status, errorText);
        throw new Error(`Ошибка загрузки страницы: ${res.status}`);
      }

      const data = await res.json();
      if (requestId !== pageRequestRef.current) return;
      const totalWords = Number(data?.totalWords) || 0;
      const wordsRead = Number(data?.wordsRead) || 0;
      setContent({
        ...data,
        progress: totalWords > 0 ? Math.round((wordsRead / totalWords) * 100) : 0,
      });
      setError('');
    } catch (err) {
      if (requestId !== pageRequestRef.current) return;
      console.error('Load page error:', err);
      setError(err instanceof Error ? err.message : 'Ошибка загрузки страницы');
    }
  }, [token, bookId]);

  useEffect(() => {
    void loadBook();
  }, [loadBook]);

  // Оглавление, закладки и доля знакомых слов — одним пакетом при открытии книги.
  useEffect(() => {
    if (!token || !book || readerDataLoadedRef.current) return;
    readerDataLoadedRef.current = true;

    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}` };

    (async () => {
      setTocLoading(true);
      try {
        const [tocRes, diffRes, bookmarkRes, knownRes] = await Promise.all([
          fetch(`${API_URL}/api/books/${bookId}/toc`, { headers }),
          fetch(`${API_URL}/api/books/${bookId}/difficulty`, { headers }),
          fetch(`${API_URL}/api/books/${bookId}/bookmarks`, { headers }),
          fetch(`${API_URL}/api/known-words`, { headers }),
        ]);

        if (cancelled) return;

        if (tocRes.ok) {
          const data = await tocRes.json();
          setTocItems(Array.isArray(data?.items) ? data.items : []);
        }

        if (diffRes.ok) {
          setDifficulty(await diffRes.json());
        }

        if (bookmarkRes.ok) {
          const data = await bookmarkRes.json();
          setBookmarks(Array.isArray(data?.items) ? data.items : []);
        }

        if (knownRes.ok) {
          const data = await knownRes.json();
          const texts: string[] = (data?.items ?? []).map((item: { text: string }) => item.text);
          setKnownWords(new Set(texts.map((text) => text.toLowerCase())));
        }
      } catch {
        // без оглавления и бейджа читалка остаётся рабочей
      } finally {
        if (!cancelled) setTocLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [book, bookId, token]);

  // Deep-link (например, из «С возвращением!»): /reader/{id}?page=N открывает нужную страницу
  useEffect(() => {
    const page = Number(new URLSearchParams(window.location.search).get('page'));
    if (Number.isInteger(page) && page > 1) {
      setCurrentPage(page);
    }
  }, []);

  useEffect(() => {
    if (book) {
      void loadPage(currentPage);
    }
  }, [currentPage, book, loadPage]);

  const goToPage = useCallback((page: number) => {
    const total = content?.totalPages ?? 1;
    const next = Math.min(total, Math.max(1, page));
    setCurrentPage((prev) => (prev === next ? prev : next));
  }, [content?.totalPages]);

  const currentPageDifficulty = useMemo(
    () => difficulty?.pages.find((page) => page.page === content?.currentPage) ?? null,
    [difficulty, content?.currentPage]
  );

  const currentBookmark = useMemo(
    () => bookmarks.find((item) => item.page === currentPage) ?? null,
    [bookmarks, currentPage]
  );

  const refreshBookmarks = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/books/${bookId}/bookmarks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBookmarks(Array.isArray(data?.items) ? data.items : []);
      }
    } catch {
      // список обновится при следующем заходе
    }
  }, [bookId, token]);

  const toggleBookmark = useCallback(async () => {
    if (!token) return;

    try {
      if (currentBookmark) {
        await fetch(`${API_URL}/api/books/${bookId}/bookmarks/${currentBookmark.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await fetch(`${API_URL}/api/books/${bookId}/bookmarks`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: currentPage }),
        });
      }

      await refreshBookmarks();
    } catch {
      // закладка не сохранилась — не блокируем чтение
    }
  }, [bookId, currentBookmark, currentPage, refreshBookmarks, token]);

  const toggleKnownWord = useCallback(async (selectedWord: string) => {
    const word = selectedWord.trim().toLowerCase();
    if (!token || !word || knownBusy) return;

    setKnownBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/known-words/toggle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: word }),
      });

      if (res.ok) {
        const data = await res.json();
        setKnownWords((prev) => {
          const next = new Set(prev);
          if (data?.known) next.add(word);
          else next.delete(word);
          return next;
        });

        // Сервер сбросил кэш сложности — пересчитываем бейдж
        const diffRes = await fetch(`${API_URL}/api/books/${bookId}/difficulty`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (diffRes.ok) setDifficulty(await diffRes.json());
      }
    } catch {
      // отметка не сохранилась — слово останется «новым»
    } finally {
      setKnownBusy(false);
    }
  }, [bookId, knownBusy, token]);

  return {
    book,
    content,
    currentPage,
    isLoading,
    error,
    tocItems,
    tocLoading,
    bookmarks,
    knownWords,
    knownBusy,
    currentPageDifficulty,
    currentBookmark,
    loadBook,
    refreshBookmarks,
    toggleBookmark,
    toggleKnownWord,
    goToPage,
  };
}
