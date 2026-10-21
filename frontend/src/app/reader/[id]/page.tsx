'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import { API_URL } from '@/app/lib/api-url';
import { useTrack } from '@/app/lib/analytics';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import ReaderDrawer from '@/components/reader/ReaderDrawer';
import ReaderSkeleton from '@/components/reader/ReaderSkeleton';
import ReaderText from '@/components/reader/ReaderText';
import ReaderTutorial from '@/components/reader/ReaderTutorial';
import ReaderToolbar from '@/components/reader/ReaderToolbar';
import FinishReadingDialog from '@/components/reader/FinishReadingDialog';
import NotesPopover from '@/components/reader/NotesPopover';
import Pagination from '@/components/reader/Pagination';
import ParallelText from '@/components/reader/ParallelText';
import TranslationPanel from '@/components/reader/TranslationPanel';
import {
  AI_MODE_STORAGE_KEY,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_WIDTH,
  FONT_SIZE_STORAGE_KEY,
  LINE_WIDTH_STORAGE_KEY,
  MAX_FONT_SIZE,
  MAX_LINE_WIDTH,
  MIN_FONT_SIZE,
  MIN_LINE_WIDTH,
  SWIPE_DIRECTION_RATIO,
  SWIPE_MIN_DISTANCE,
  TOOLTIP_DELAY,
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  getSentenceContext,
} from '@/components/reader/types';
import type {
  Book,
  BookContent,
  BookDifficulty,
  Bookmark,
  CollectedWord,
  FinishResult,
  ParallelChunk,
  TocItem,
  TooltipData,
  TranslationResult,
  WordToken,
} from '@/components/reader/types';

export default function ReaderPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const bookId = params.id as string;
  const trackEvent = useTrack();

  const [book, setBook] = useState<Book | null>(null);
  const [content, setContent] = useState<BookContent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Перевод
  const [selectedWord, setSelectedWord] = useState('');
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(false);
  const [displayedTranslation, setDisplayedTranslation] = useState('');
  const [addedToDict, setAddedToDict] = useState(false);

  // ИИ-перевод с контекстом (медленный) — по умолчанию выключен, храним в localStorage
  const [aiMode, setAiMode] = useState(false);

  // Кегль и ширина строки — настраиваются и запоминаются
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [lineWidth, setLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const [showTextSettings, setShowTextSettings] = useState(false);

  // Панель перевода: на десктопе сворачивается, на мобильных — bottom-sheet
  const [panelOpen, setPanelOpen] = useState(true);

  const requestIdRef = useRef(0);
  const pageRequestRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Маркерные слова текущей страницы (lower-case)
  const keyWordsSet = useMemo(() => {
    const set = new Set<string>();
    content?.keyWords?.forEach(kw => set.add(kw.wordText.toLowerCase()));
    return set;
  }, [content?.keyWords]);

  // Сессия чтения и конспект
  const [readingSessionId, setReadingSessionId] = useState<string | null>(null);
  const collectedRef = useRef<Map<string, CollectedWord>>(new Map());
  const [collectedKeys, setCollectedKeys] = useState<string[]>([]);

  // Тултип
  const tooltipCacheRef = useRef<Map<string, TooltipData | Promise<TooltipData | null>>>(new Map());
  const [tooltip, setTooltip] = useState<{ idx: number; word: string; data: TooltipData | null; loading: boolean; below: boolean } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Поповер конспекта и завершение
  const [showNotes, setShowNotes] = useState(false);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizDone, setQuizDone] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Параллельный перевод
  const [parallelMode, setParallelMode] = useState(false);
  const [parallelPages, setParallelPages] = useState<Record<number, ParallelChunk[]>>({});
  const [parallelLoading, setParallelLoading] = useState(false);
  const [parallelError, setParallelError] = useState(false);
  const [showParallelHint, setShowParallelHint] = useState(false);
  const parallelHintShownRef = useRef(false);
  const parallelHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Туториал для новичка
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const tutorialCheckRef = useRef(false);

  // Reader 2.0: оглавление, закладки, доля знакомых слов
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'toc' | 'bookmarks'>('toc');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [difficulty, setDifficulty] = useState<BookDifficulty | null>(null);
  const [knownWords, setKnownWords] = useState<Set<string>>(new Set());
  const [knownBusy, setKnownBusy] = useState(false);
  const readerDataLoadedRef = useRef(false);

  // Восстановление ИИ-режима перевода слов
  useEffect(() => {
    try {
      setAiMode(window.localStorage.getItem(AI_MODE_STORAGE_KEY) === '1');
    } catch {
      // localStorage недоступен — работаем с быстрым переводом по умолчанию
    }
  }, []);

  const toggleAiMode = useCallback((next: boolean) => {
    setAiMode(next);
    try {
      window.localStorage.setItem(AI_MODE_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // игнорируем — режим просто не переживёт перезагрузку
    }
  }, []);

  // Восстановление кегля и ширины строки
  useEffect(() => {
    try {
      const savedFontSize = Number(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY));
      if (savedFontSize >= MIN_FONT_SIZE && savedFontSize <= MAX_FONT_SIZE) {
        setFontSize(savedFontSize);
      }
      const savedLineWidth = Number(window.localStorage.getItem(LINE_WIDTH_STORAGE_KEY));
      if (savedLineWidth >= MIN_LINE_WIDTH && savedLineWidth <= MAX_LINE_WIDTH) {
        setLineWidth(savedLineWidth);
      }
    } catch {
      // localStorage недоступен — остаются значения по умолчанию
    }
  }, []);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize(prev => {
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, prev + delta));
      try {
        window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(next));
      } catch {
        // настройка не сохранится — не критично
      }
      return next;
    });
  }, []);

  const changeLineWidth = useCallback((next: number) => {
    const clamped = Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, next));
    setLineWidth(clamped);
    try {
      window.localStorage.setItem(LINE_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // настройка не сохранится — не критично
    }
  }, []);

  const resetTextSettings = useCallback(() => {
    setFontSize(DEFAULT_FONT_SIZE);
    setLineWidth(DEFAULT_LINE_WIDTH);
    try {
      window.localStorage.removeItem(FONT_SIZE_STORAGE_KEY);
      window.localStorage.removeItem(LINE_WIDTH_STORAGE_KEY);
    } catch {
      // игнорируем
    }
  }, []);

  const loadBook = useCallback(async () => {
    try {
      const token = session?.accessToken;
      if (!token) return; // ждём готовности сессии — useEffect перезапустится сам
      const res = await fetch(`${API_URL}/api/books/${bookId}`, {
        headers: { Authorization: `Bearer ${token}` }
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
      trackEvent('book_opened', data?.title);
    } catch (err) {
      console.error('Load book error:', err);
      setError(err instanceof Error ? err.message : 'Ошибка загрузки книги');
      setIsLoading(false);
    }
  }, [session, bookId]);

  const loadPage = useCallback(async (page: number) => {
    // Защита от гонки: при быстром перелистывании применяем только последний ответ
    const requestId = ++pageRequestRef.current;
    try {
      const token = session?.accessToken;
      if (!token) return;
      const res = await fetch(`${API_URL}/api/books/${bookId}/content?page=${page}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Page load error:', res.status, errorText);
        throw new Error(`Ошибка загрузки страницы: ${res.status}`);
      }

      const data = await res.json();
      if (requestId !== pageRequestRef.current) return;
      setContent(data);
      setError('');
    } catch (err) {
      if (requestId !== pageRequestRef.current) return;
      console.error('Load page error:', err);
      setError(err instanceof Error ? err.message : 'Ошибка загрузки страницы');
    }
  }, [session, bookId]);

  useEffect(() => {
    loadBook();
  }, [loadBook]);

  // Оглавление, закладки и доля знакомых слов — одним пакетом при открытии книги.
  // Любая из этих частей может не прийти: читалка всё равно должна работать.
  useEffect(() => {
    const token = session?.accessToken;
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
          setKnownWords(new Set(texts.map(text => text.toLowerCase())));
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
  }, [book, bookId, session?.accessToken]);

  const currentPageDifficulty = useMemo(
    () => difficulty?.pages.find(page => page.page === content?.currentPage) ?? null,
    [difficulty, content?.currentPage]
  );

  const currentBookmark = useMemo(
    () => bookmarks.find(item => item.page === currentPage) ?? null,
    [bookmarks, currentPage]
  );

  const refreshBookmarks = useCallback(async () => {
    const token = session?.accessToken;
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
  }, [bookId, session?.accessToken]);

  const toggleBookmark = useCallback(async () => {
    const token = session?.accessToken;
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
  }, [bookId, currentBookmark, currentPage, refreshBookmarks, session?.accessToken]);

  const toggleKnownWord = useCallback(async () => {
    const token = session?.accessToken;
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
        setKnownWords(prev => {
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
  }, [bookId, knownBusy, selectedWord, session?.accessToken]);

  // Туториал — только при первом заходе в читалку
  useEffect(() => {
    if (!book || tutorialCheckRef.current) return;
    tutorialCheckRef.current = true;
    try {
      if (!window.localStorage.getItem(TUTORIAL_STORAGE_KEY)) {
        setTutorialStep(0);
      }
    } catch {
      // localStorage недоступен — туториал просто не показываем
    }
  }, [book]);

  // Анимация появления шага туториала (fade/scale)
  useEffect(() => {
    if (tutorialStep === null) return;
    setTutorialVisible(false);
    const t = setTimeout(() => setTutorialVisible(true), 30);
    return () => clearTimeout(t);
  }, [tutorialStep]);

  const finishTutorial = useCallback(() => {
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
    } catch {
      // игнорируем — флаг не критичен
    }
    setTutorialStep(null);
  }, []);

  // Deep-link (например, из «С возвращением!»): /reader/{id}?page=N открывает книгу сразу на нужной странице
  useEffect(() => {
    const page = Number(new URLSearchParams(window.location.search).get('page'));
    if (Number.isInteger(page) && page > 1) {
      setCurrentPage(page);
    }
  }, []);

  useEffect(() => {
    if (book) {
      loadPage(currentPage);
    }
  }, [currentPage, book, loadPage]);

  const goToPage = useCallback((page: number) => {
    const total = content?.totalPages ?? 1;
    const next = Math.min(total, Math.max(1, page));
    setCurrentPage(prev => (prev === next ? prev : next));
  }, [content?.totalPages]);

  // Стрелки ←/→ листают страницы; в полях ввода и модалках не перехватываем
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'Escape') {
        if (showTextSettings) setShowTextSettings(false);
        if (tooltip) setTooltip(null);
        return;
      }

      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        showTextSettings ||
        showNotes ||
        finishResult ||
        tutorialStep !== null
      ) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPage(currentPage - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToPage(currentPage + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, goToPage, finishResult, showNotes, showTextSettings, tutorialStep, tooltip]);

  // Свайп влево — следующая страница, вправо — предыдущая
  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !content || content.totalPages <= 1) return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Слишком короткое или вертикальное движение — это не перелистывание
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) {
      return;
    }

    goToPage(currentPage + (dx < 0 ? 1 : -1));
  };

  // Создание сессии чтения один раз на mount (при готовности сессии)
  useEffect(() => {
    const token = session?.accessToken;
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/reading/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ bookId: Number(bookId) })
        });
        if (!res.ok) {
          console.warn('Reading session not created:', res.status);
          return;
        }
        const data = await res.json();
        if (!cancelled && data?.sessionId) {
          setReadingSessionId(data.sessionId);
        }
      } catch (err) {
        // Без сессии чтение работает, просто без конспекта
        console.warn('Reading session error:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [session, bookId]);

  // Сброс выделения при смене страницы
  useEffect(() => {
    requestIdRef.current++;
    setSelectedWord('');
    setSelectedWordIndex(null);
    setTranslation(null);
    setDisplayedTranslation('');
    setIsTranslating(false);
    setTranslationError(false);
    setAddedToDict(false);
    setTooltip(null);
    // На телефоне смена страницы закрывает bottom-sheet, чтобы не закрывать текст
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setPanelOpen(false);
    }
  }, [currentPage]);

  // Эффект печатания перевода: cleanup отменяет таймер при смене перевода
  useEffect(() => {
    if (!translation || isTranslating) return;
    const fullText = translation.translation;
    setDisplayedTranslation('');

    let index = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const typeNextChar = () => {
      if (cancelled) return;
      if (index < fullText.length) {
        index++;
        setDisplayedTranslation(fullText.slice(0, index));
        timer = setTimeout(typeNextChar, 30);
      }
    };

    typeNextChar();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [translation, isTranslating]);

  // ---- Параллельный перевод ----

  const loadParallel = useCallback(async (page: number, force = false) => {
    if (!force && parallelPages[page]) return;
    const token = session?.accessToken;
    if (!token) return;
    setParallelLoading(true);
    setParallelError(false);
    try {
      const res = await fetch(`${API_URL}/api/books/${bookId}/parallel?page=${page}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Parallel load error:', res.status, errorText);
        throw new Error(`Ошибка загрузки перевода: ${res.status}`);
      }
      const data = await res.json();
      setParallelPages(prev => ({ ...prev, [page]: Array.isArray(data?.chunks) ? data.chunks : [] }));
    } catch (err) {
      console.error('Load parallel error:', err);
      setParallelError(true);
    } finally {
      setParallelLoading(false);
    }
  }, [session, bookId, parallelPages]);

  // Автозагрузка перевода при включении режима и при смене страницы в режиме ON
  useEffect(() => {
    if (parallelMode && !parallelPages[currentPage]) {
      loadParallel(currentPage);
    }
  }, [parallelMode, currentPage, parallelPages, loadParallel]);

  const toggleParallelMode = useCallback(() => {
    const next = !parallelMode;
    setParallelMode(next);
    if (next && !parallelHintShownRef.current) {
      parallelHintShownRef.current = true;
      setShowParallelHint(true);
      if (parallelHintTimerRef.current) clearTimeout(parallelHintTimerRef.current);
      parallelHintTimerRef.current = setTimeout(() => setShowParallelHint(false), 7000);
    }
  }, [parallelMode]);

  const wordTokens = useMemo<WordToken[]>(() => {
    if (!content?.text) return [];
    const tokens: WordToken[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content.text)) !== null) {
      tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    }
    return tokens;
  }, [content?.text]);

  const handleWordClick = useCallback(async (wordIndex: number) => {
    const token = wordTokens[wordIndex];
    if (!token || !content?.text) return;

    const cleanWord = token.word.replace(/[^a-zA-Z']/g, '').toLowerCase();
    if (!cleanWord || cleanWord.length < 2) return;

    const requestId = ++requestIdRef.current;
    const sentence = getSentenceContext(content.text, token.start, token.end);

    setSelectedWord(cleanWord);
    setSelectedWordIndex(wordIndex);
    setPanelOpen(true);
    setShowTextSettings(false);
    setTooltip(null);
    setIsTranslating(true);
    setTranslation(null);
    setDisplayedTranslation('');
    setTranslationError(false);
    setAddedToDict(false);

    try {
      const authToken = session?.accessToken;
      const res = await fetch(`${API_URL}/api/ai/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(
          aiMode
            ? { word: cleanWord, context: sentence || undefined, targetLanguage: 'ru' }
            : { word: cleanWord, targetLanguage: 'ru' }
        )
      });

      const data = res.ok ? await res.json().catch(() => null) : null;

      if (requestId !== requestIdRef.current) return;

      if (data && typeof data.translation === 'string' && data.translation.trim().length > 0) {
        setTranslation({ ...data, translation: data.translation.trim() });
        trackEvent('word_translated', cleanWord);
      } else {
        setTranslationError(true);
      }
    } catch (err) {
      console.error('Translation error:', err);
      if (requestId === requestIdRef.current) {
        setTranslationError(true);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsTranslating(false);
      }
    }
  }, [session, content, wordTokens, aiMode]);

  const addToDictionary = async () => {
    if (!translation || !selectedWord || addedToDict) return;

    try {
      const token = session?.accessToken;
      const res = await fetch(`${API_URL}/api/dictionary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          text: selectedWord,
          definition: translation.translation,
          partOfSpeech: translation.partOfSpeech
        })
      });

      if (res.ok) {
        setAddedToDict(true);
        trackEvent('word_learned', selectedWord);
      }
    } catch (err) {
      console.error('Error adding word:', err);
    }
  };

  // ---- Конспект ----

  const syncCollected = useCallback(() => {
    setCollectedKeys(Array.from(collectedRef.current.keys()));
  }, []);

  const toggleCollected = useCallback(async (rawText: string, token?: WordToken) => {
    if (!readingSessionId || !content?.text) return;
    const text = rawText.toLowerCase();
    const authToken = session?.accessToken;
    if (!authToken) return;

    if (collectedRef.current.has(text)) {
      collectedRef.current.delete(text);
      syncCollected();
      try {
        await fetch(`${API_URL}/api/reading/sessions/${readingSessionId}/words/${encodeURIComponent(text)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` }
        });
      } catch (err) {
        console.error('Error removing collected word:', err);
      }
      return;
    }

    const sentence = token
      ? getSentenceContext(content.text, token.start, token.end)
      : '';
    collectedRef.current.set(text, { text, page: currentPage, sentence });
    syncCollected();
    try {
      await fetch(`${API_URL}/api/reading/sessions/${readingSessionId}/words`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ text, page: currentPage, contextSentence: sentence || undefined })
      });
      trackEvent('word_learned', text);
    } catch (err) {
      console.error('Error collecting word:', err);
    }
  }, [readingSessionId, content, currentPage, session, syncCollected]);

  const removeCollected = useCallback(async (text: string) => {
    if (!readingSessionId) return;
    const authToken = session?.accessToken;
    collectedRef.current.delete(text.toLowerCase());
    syncCollected();
    try {
      await fetch(`${API_URL}/api/reading/sessions/${readingSessionId}/words/${encodeURIComponent(text.toLowerCase())}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });
    } catch (err) {
      console.error('Error removing collected word:', err);
    }
  }, [readingSessionId, session, syncCollected]);

  // ---- Тултип ----

  const fetchTooltip = useCallback((word: string): Promise<TooltipData | null> => {
    const cached = tooltipCacheRef.current.get(word);
    if (cached) {
      if (cached instanceof Promise) return cached;
      return Promise.resolve(cached);
    }
    const token = session?.accessToken;
    const promise = fetch(
      `${API_URL}/api/books/${bookId}/word-tooltip?word=${encodeURIComponent(word)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then(res => (res.ok ? res.json().catch(() => null) : null))
      .then(data => {
        if (data) tooltipCacheRef.current.set(word, data as TooltipData);
        else tooltipCacheRef.current.delete(word);
        return data as TooltipData | null;
      })
      .catch(err => {
        tooltipCacheRef.current.delete(word);
        console.error('Tooltip error:', err);
        return null;
      });
    tooltipCacheRef.current.set(word, promise);
    return promise;
  }, [session, bookId]);

  const showTooltip = useCallback((idx: number, cleanWord: string) => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip({ idx, word: cleanWord, data: null, loading: true, below: idx < 12 });
    fetchTooltip(cleanWord).then(data => {
      setTooltip(prev =>
        prev && prev.idx === idx && prev.word === cleanWord
          ? { ...prev, data, loading: false }
          : prev
      );
    });
  }, [fetchTooltip]);

  const handleMarkerEnter = useCallback((idx: number, cleanWord: string) => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => showTooltip(idx, cleanWord), TOOLTIP_DELAY);
  }, [showTooltip]);

  const handleMarkerLeave = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip(null);
  }, []);

  // На тач-устройствах hover нет: тап открывает карточку, а не сразу добавляет
  // слово в конспект — добавить можно кнопкой внутри карточки.
  const handleMarkerClick = useCallback((idx: number, cleanWord: string, token: WordToken) => {
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    if (isCoarsePointer) {
      setPanelOpen(false);
      showTooltip(idx, cleanWord);
      return;
    }

    void toggleCollected(cleanWord, token);
  }, [showTooltip, toggleCollected]);

  // Фокус с клавиатуры показывает тултип; Enter/Space — в конспект
  const handleMarkerKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLSpanElement>,
    cleanWord: string,
    token: WordToken
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void toggleCollected(cleanWord, token);
    }
  }, [toggleCollected]);

  // Тап мимо слова или карточки закрывает тултип
  useEffect(() => {
    if (!tooltip) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-word-tooltip]') || target?.closest('[data-marker-word]')) {
        return;
      }
      setTooltip(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [tooltip]);

  // ---- Завершение чтения ----

  const finishReading = useCallback(async () => {
    if (!readingSessionId || isFinishing) return;
    setIsFinishing(true);
    try {
      const authToken = session?.accessToken;
      const res = await fetch(`${API_URL}/api/reading/sessions/${readingSessionId}/finish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) {
        console.error('Finish error:', res.status);
        return;
      }
      const data: FinishResult = await res.json();
      setFinishResult(data);
      trackEvent('session_finished', book?.title);
      setQuizIndex(0);
      setQuizAnswer(null);
      setQuizScore(0);
      setQuizDone(false);
      setShowNotes(false);
    } catch (err) {
      console.error('Finish reading error:', err);
    } finally {
      setIsFinishing(false);
    }
  }, [readingSessionId, isFinishing, session]);

  const speak = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  if (isLoading) {
    return (
      <AppLayout width="full">
        <ReaderSkeleton />
      </AppLayout>
    );
  }

  if (error || !book) {
    return (
      <AppLayout width="full">
        <ErrorState
          title="Книга не открылась"
          description={error || 'Книга с этим адресом не найдена в библиотеке.'}
          onRetry={() => void loadBook()}
          action={
            <Button href="/books" variant="primary">
              Назад к книгам
            </Button>
          }
        />
      </AppLayout>
    );
  }

  const isTyping = !!translation && displayedTranslation.length < translation.translation.length;
  const quizQuestions = finishResult?.quiz?.questions ?? [];
  const quizCurrent = quizQuestions[quizIndex];

  // Настройки чтения живут в токенах --reader-*: их читает класс .reader-text,
  // поэтому размер строки не превращается в набор inline-правил.
  const readerVars = {
    '--reader-size': `${fontSize}px`,
    '--reader-leading': 1.75,
    '--reader-measure': `${lineWidth}ch`,
  } as CSSProperties;

  return (
    <AppLayout width="full">
      <PageHeader
        title={book.title}
        subtitle={book.author || undefined}
        actions={
          content ? (
            <ReaderToolbar
              content={content}
              pageDifficulty={currentPageDifficulty}
              hasBookmark={Boolean(currentBookmark)}
              parallelMode={parallelMode}
              panelOpen={panelOpen}
              notesVisible={showNotes}
              notesCount={collectedKeys.length}
              canCollect={Boolean(readingSessionId)}
              textSettings={{
                open: showTextSettings,
                onToggle: () => setShowTextSettings((v) => !v),
                fontSize,
                lineWidth,
                onFontSizeChange: changeFontSize,
                onLineWidthChange: changeLineWidth,
                onReset: resetTextSettings,
              }}
              onOpenDrawer={() => {
                setDrawerTab('toc');
                setDrawerOpen(true);
              }}
              onToggleBookmark={() => void toggleBookmark()}
              onToggleParallel={toggleParallelMode}
              onTogglePanel={() => setPanelOpen((v) => !v)}
              onToggleNotes={() => setShowNotes((v) => !v)}
            />
          ) : null
        }
      />

      {/* Поповер конспекта */}
      <AnimatePresence>
        {showNotes && readingSessionId && (
          <NotesPopover
            key="notes"
            items={collectedKeys.map((key) => collectedRef.current.get(key)!)}
            isFinishing={isFinishing}
            onRemove={(word) => void removeCollected(word)}
            onFinish={() => void finishReading()}
          />
        )}
      </AnimatePresence>

      {/* Drawer: оглавление и закладки */}
      <AnimatePresence>
        {drawerOpen && (
          <ReaderDrawer
            key="drawer"
            tab={drawerTab}
            onTabChange={setDrawerTab}
            onClose={() => setDrawerOpen(false)}
            tocItems={tocItems}
            tocLoading={tocLoading}
            bookmarks={bookmarks}
            onPage={goToPage}
            onDeleteBookmark={async (id) => {
              const token = session?.accessToken;
              if (!token) return;
              await fetch(`${API_URL}/api/books/${bookId}/bookmarks/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              await refreshBookmarks();
            }}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* Текст книги */}
        <div className="min-w-0 flex-1">
          <div
            className="card p-4 sm:p-6 lg:p-8"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* key по номеру страницы: при перелистывании блок перемонтируется и текст мягко проявляется */}
            <div
              key={currentPage}
              data-reader-text
              className="reader-text animate-page-in"
              style={readerVars}
            >
              {parallelMode ? (
                <ParallelText
                  chunks={parallelPages[currentPage] ?? []}
                  loading={parallelLoading}
                  error={parallelError}
                  showHint={showParallelHint}
                  onRetry={() => void loadParallel(currentPage, true)}
                />
              ) : (
                <ReaderText
                  tokens={wordTokens}
                  keyWords={keyWordsSet}
                  selectedWordIndex={selectedWordIndex}
                  tooltip={tooltip}
                  readingSessionId={readingSessionId}
                  isCollected={(word) => collectedRef.current.has(word)}
                  onWordClick={(idx) => void handleWordClick(idx)}
                  onMarkerEnter={handleMarkerEnter}
                  onMarkerLeave={handleMarkerLeave}
                  onMarkerFocus={showTooltip}
                  onMarkerClick={(idx, word, token) => handleMarkerClick(idx, word, token)}
                  onMarkerKeyDown={handleMarkerKeyDown}
                  onCloseTooltip={() => setTooltip(null)}
                  onCollect={(word, token) => void toggleCollected(word, token)}
                />
              )}
            </div>
          </div>

          {/* Пагинация */}
          {content && content.totalPages > 1 && (
            <Pagination page={currentPage} total={content.totalPages} onPage={goToPage} />
          )}

          {content && content.totalPages > 1 && (
            <p className="mt-3 text-center text-caption text-slate md:hidden">
              Свайп влево и вправо листает страницы
            </p>
          )}
        </div>

        {/* Панель перевода — скрыта в режиме параллельного перевода.
            На телефоне это bottom-sheet, на десктопе — сворачиваемая колонка. */}
        {!parallelMode && (
          <TranslationPanel
            open={panelOpen}
            word={selectedWord}
            translation={translation}
            displayed={displayedTranslation}
            isTyping={isTyping}
            isLoading={isTranslating}
            hasError={translationError}
            aiMode={aiMode}
            addedToDictionary={addedToDict}
            isKnown={knownWords.has(selectedWord.trim().toLowerCase())}
            knownBusy={knownBusy}
            isInNotes={collectedRef.current.has(selectedWord)}
            notesAvailable={Boolean(readingSessionId)}
            onCollapse={() => setPanelOpen(false)}
            onRetry={() => {
              if (selectedWordIndex !== null) void handleWordClick(selectedWordIndex);
            }}
            onSpeak={speak}
            onAddToDictionary={() => void addToDictionary()}
            onToggleKnown={() => void toggleKnownWord()}
            onToggleAiMode={toggleAiMode}
            onCollect={(word) => void toggleCollected(word)}
          />
        )}
      </div>

      {/* Туториал для новичка */}
      <AnimatePresence>
        {tutorialStep !== null && (
          <ReaderTutorial
            key="tutorial"
            step={tutorialStep}
            visible={tutorialVisible}
            onAdvance={() => {
              if (tutorialStep === TUTORIAL_STEPS.length - 1) finishTutorial();
              else setTutorialStep((s) => (s === null ? null : s + 1));
            }}
            onSkip={finishTutorial}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {finishResult && (
          <FinishReadingDialog
            key="finish"
            result={finishResult}
            questions={quizQuestions}
            index={quizIndex}
            answer={quizAnswer}
            score={quizScore}
            done={quizDone}
            onAnswer={(choice) => {
              setQuizAnswer(choice);
              if (choice === quizCurrent?.correctIndex) setQuizScore((s) => s + 1);
            }}
            onNext={() => {
              if (quizIndex + 1 < quizQuestions.length) {
                setQuizIndex((i) => i + 1);
                setQuizAnswer(null);
              } else {
                setQuizDone(true);
              }
            }}
            onClose={() => setFinishResult(null)}
            onGoToDictionary={() => router.push('/dictionary')}
          />
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
