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
import BetaPulse from '@/components/feedback/BetaPulse';
import ReaderDrawer from '@/components/reader/ReaderDrawer';
import ReaderFooter from '@/components/reader/ReaderFooter';
import ReaderRail from '@/components/reader/ReaderRail';
import ReaderSkeleton from '@/components/reader/ReaderSkeleton';
import ReaderText from '@/components/reader/ReaderText';
import ReaderTutorial from '@/components/reader/ReaderTutorial';
import ReaderToolbar from '@/components/reader/ReaderToolbar';
import FinishReadingDialog from '@/components/reader/FinishReadingDialog';
import ParallelText from '@/components/reader/ParallelText';
import TranslationPanel from '@/components/reader/TranslationPanel';
import { useReaderBook } from '@/hooks/useReaderBook';
import { useWordTooltip } from '@/hooks/useWordTooltip';
import { useReaderShortcuts } from '@/hooks/useReaderShortcuts';
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
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  getSentenceContext,
  stripRepeatedLeadingPhrase,
} from '@/components/reader/types';
import type {
  CollectedWord,
  FinishResult,
  ParallelChunk,
  ReaderRailTab,
  TocItem,
  TranslationResult,
  WordToken,
} from '@/components/reader/types';

/** Текущая глава — последний заголовок, который начался до открытой страницы. */
function chapterTitleFor(tocItems: TocItem[], page: number): string {
  let title = '';
  for (const item of tocItems) {
    if (item.page <= page) title = item.title;
    else break;
  }
  return title || (tocItems[0]?.title ?? 'Начало книги');
}

// Служебные строки EPUB: обложка, титул, оглавление. В книжной полке они не нужны.
const SERVICE_TOC_TITLE = /^(contents?|table of contents|оглавление|содержание|cover|обложка|title page|титульный лист|copyright)$/i;

export default function ReaderPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const bookId = params.id as string;
  const trackEvent = useTrack();

  const {
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
  } = useReaderBook({
    bookId,
    token: session?.accessToken,
    onBookOpened: (title) => trackEvent('book_opened', title),
  });

  // Перевод
  const [selectedWord, setSelectedWord] = useState('');
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  const [selectedContext, setSelectedContext] = useState('');
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

  // Панель перевода: на десктопе сворачивается, на мобильных — bottom-sheet.
  // По умолчанию закрыта: бумага должна дышать, пока читатель не выбрал слово.
  const [panelOpen, setPanelOpen] = useState(false);

  const requestIdRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const desktopRailRef = useRef<HTMLDivElement>(null);

  const { tooltip, showTooltip, hideTooltip, handleMarkerEnter, handleMarkerLeave } =
    useWordTooltip({ bookId, token: session?.accessToken });

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

  const collectedItems = useMemo(
    () => collectedKeys
      .map((key) => collectedRef.current.get(key))
      .filter((item): item is CollectedWord => Boolean(item)),
    [collectedKeys]
  );

  const visibleTocItems = useMemo(() => {
    const filtered = tocItems.filter((item) => !SERVICE_TOC_TITLE.test(item.title.trim()));
    // Если фильтр снял всё (книга-одностраничник), лучше показать исходное оглавление.
    return filtered.length > 0 ? filtered : tocItems;
  }, [tocItems]);

  const chapterTitle = useMemo(
    () => chapterTitleFor(visibleTocItems, currentPage),
    [visibleTocItems, currentPage]
  );

  // Активация беты: «первая открытая глава». Через неделю по этому событию видно,
  // какой канал привёл читающих людей, а не просто регистрации.
  // Отправляется один раз на монтирование читалки, а однократность на пользователя
  // гарантирует сервер (AnalyticsController + частичный уникальный индекс),
  // поэтому повторные заходы и перезапуски браузера безопасны.
  const firstChapterTrackedRef = useRef(false);

  useEffect(() => {
    if (firstChapterTrackedRef.current) return;
    if (!session?.accessToken || !content) return;

    firstChapterTrackedRef.current = true;
    trackEvent('chapter_opened_first', chapterTitle || book?.title);
  }, [session, content, chapterTitle, book, trackEvent]);

  // Завершение чтения
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

  // Книжная полка: на десктопе постоянная, на телефоне — drawer
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<ReaderRailTab>('toc');

  // На телефоне постоянной полки нет: не держим её «открытой» за кадром,
  // иначе кнопка конспекта наверху остаётся подсвеченной без открытого drawer.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const sync = () => {
      if (query.matches) setRailOpen(false);
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

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

  const closeTransientLayers = useCallback(() => {
    setShowTextSettings(false);
    setDrawerOpen(false);
    setPanelOpen(false);
    hideTooltip();
  }, [hideTooltip]);

  useReaderShortcuts({
    currentPage,
    onPage: goToPage,
    blocked: Boolean(showTextSettings || drawerOpen || finishResult || tutorialStep !== null),
    onEscape: closeTransientLayers,
  });

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
    hideTooltip();
    // На телефоне смена страницы закрывает bottom-sheet, чтобы не закрывать текст
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setPanelOpen(false);
    }
  }, [currentPage, hideTooltip]);

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
      const chunks: ParallelChunk[] = Array.isArray(data?.chunks) ? data.chunks : [];
      // На первой странице переведённый кусок часто начинается с названия дважды.
      const cleaned =
        page === 1 && chunks.length > 0
          ? [
              {
                ...chunks[0],
                en: stripRepeatedLeadingPhrase(chunks[0].en),
                ru: chunks[0].ru ? stripRepeatedLeadingPhrase(chunks[0].ru) : null,
              },
              ...chunks.slice(1),
            ]
          : chunks;
      setParallelPages(prev => ({ ...prev, [page]: cleaned }));
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
    setSelectedContext(sentence);
    setPanelOpen(true);
    // На 1024–1279 px полка и панель перевода вместе съедают строку:
    // уступаем место переводу, полку можно вернуть той же кнопкой.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 1024px) and (max-width: 1279px)').matches
    ) {
      setRailOpen(false);
    }
    setShowTextSettings(false);
    hideTooltip();
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
  }, [session, content, wordTokens, aiMode, hideTooltip]);

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
          partOfSpeech: translation.partOfSpeech,
          source: 'reader',
          context: selectedContext || undefined
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

  const openMobileDrawer = useCallback((tab: ReaderRailTab) => {
    setDrawerTab(tab);
    setRailOpen(false);
    setDrawerOpen(true);
  }, []);

  // На десктопе конспект — вкладка постоянной полки, на телефоне — drawer.
  const openNotes = useCallback(() => {
    setDrawerTab('notes');
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
    if (isDesktop) setRailOpen(true);
    else {
      setRailOpen(false);
      setDrawerOpen(true);
    }
  }, []);

  // Свёрнутая полка остаётся в DOM ради анимации ширины, но не должна
  // ловить фокус с клавиатуры: у неё нулевая ширина и обрезанное содержимое.
  useEffect(() => {
    const rail = desktopRailRef.current;
    if (rail) (rail as HTMLDivElement & { inert: boolean }).inert = !railOpen;
  }, [railOpen]);

  const renderRail = (onClose?: () => void) => (
    <ReaderRail
      book={book!}
      content={content!}
      currentPage={currentPage}
      pageDifficulty={currentPageDifficulty}
      tocItems={visibleTocItems}
      tocLoading={tocLoading}
      bookmarks={bookmarks}
      tab={drawerTab}
      onTabChange={setDrawerTab}
      collected={collectedItems}
      canCollect={Boolean(readingSessionId)}
      isFinishing={isFinishing}
      onPage={(page) => {
        goToPage(page);
        onClose?.();
      }}
      onDeleteBookmark={(id) => {
        const token = session?.accessToken;
        if (!token) return;
        void fetch(`${API_URL}/api/books/${bookId}/bookmarks/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).then(() => refreshBookmarks());
      }}
      onRemoveCollected={(word) => void removeCollected(word)}
      onFinish={() => {
        onClose?.();
        void finishReading();
      }}
      onClose={onClose}
    />
  );

  if (isLoading) {
    return (
      <AppLayout immersive>
        <ReaderSkeleton />
      </AppLayout>
    );
  }

  if (error || !book) {
    return (
      <AppLayout immersive>
        <div className="reader-room flex min-h-[100dvh] items-center justify-center px-5 py-10">
          <div className="w-full max-w-md">
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
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!content) {
    return (
      <AppLayout immersive>
        <ReaderSkeleton />
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
    '--reader-leading': 1.85,
    '--reader-measure': `${lineWidth}ch`,
  } as CSSProperties;

  return (
    <AppLayout immersive>
      <div className="reader-room flex h-[100dvh] w-full overflow-hidden">
        {/* Постоянная книжная полка — только на десктопе */}
        <div
          className={`hidden shrink-0 overflow-hidden transition-[width] duration-base ease-soft motion-reduce:transition-none lg:block ${
            railOpen ? 'w-[288px]' : 'w-0'
          }`}
        >
          <div
            ref={desktopRailRef}
            aria-hidden={!railOpen}
            className="h-full w-[288px]"
          >
            {renderRail()}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <ReaderToolbar
            bookTitle={book.title}
            chapterTitle={chapterTitle}
            hasBookmark={Boolean(currentBookmark)}
            parallelMode={parallelMode}
            panelOpen={panelOpen}
            notesVisible={drawerTab === 'notes' && (railOpen || drawerOpen)}
            notesCount={collectedKeys.length}
            canCollect={Boolean(readingSessionId)}
            railOpen={railOpen}
            textSettings={{
              open: showTextSettings,
              onToggle: () => setShowTextSettings((v) => !v),
              fontSize,
              lineWidth,
              onFontSizeChange: changeFontSize,
              onLineWidthChange: changeLineWidth,
              onReset: resetTextSettings,
            }}
            onOpenDrawer={() => openMobileDrawer('toc')}
            onToggleRail={() => setRailOpen((v) => !v)}
            onToggleBookmark={() => void toggleBookmark()}
            onToggleParallel={toggleParallelMode}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            onToggleNotes={openNotes}
          />

          <div className="flex min-h-0 flex-1">
            <main className="reader-paper relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <div
                className="reader-scroll flex-1 overflow-y-auto"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {/* flex-col вместо row: под текстом страницы живёт ровно один
                    дополнительный слой — inline-вопрос pulse (W4.1). В column
                    горизонталь режет items-center вместо justify-center, а
                    текст по-прежнему прижат к верху: раскладка, кегль и
                    перелистывание не затронуты, у блока та же measure-сетка,
                    что у текста. */}
                <div className="flex min-h-full flex-col items-center px-5 pb-16 pt-9 sm:px-8 sm:pt-12 lg:px-12 lg:pt-16">
                  {/* key по номеру страницы: при перелистывании блок перемонтируется и текст мягко проявляется */}
                  <div
                    key={currentPage}
                    data-reader-text
                    data-parallel={parallelMode ? 'true' : undefined}
                    lang={parallelMode ? undefined : 'en'}
                    className="reader-text reader-page-enter w-full"
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
                        onCloseTooltip={hideTooltip}
                        onCollect={(word, token) => void toggleCollected(word, token)}
                      />
                    )}
                  </div>

                  {/* Микроопрос беты: один вопрос под текстом, без слоя поверх
                      чтения. Сам блок решает «показывать ли» через сервер
                      (/api/analytics/pulse/eligible), поэтому здесь он просто
                      стоит в колонке. */}
                  <BetaPulse
                    userId={session?.user?.id ?? null}
                    accessToken={session?.accessToken ?? null}
                    page={currentPage}
                  />
                </div>
              </div>

              {/* Мягкий край страницы: строка, уходящая под подвал, тает, а не режется */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-14 h-8 bg-gradient-to-t from-[var(--reader-paper)] to-transparent"
              />

              <ReaderFooter
                page={currentPage}
                total={content.totalPages}
                chapterTitle={chapterTitle}
                progress={content.progress}
                onPage={goToPage}
              />
            </main>

            {/* Панель перевода — тихая страница справа, на телефоне bottom-sheet */}
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
                onToggleKnown={() => void toggleKnownWord(selectedWord)}
                onToggleAiMode={toggleAiMode}
                onCollect={(word) => void toggleCollected(word)}
              />
            )}
          </div>
        </div>

        {/* Мобильная книжная полка */}
        <AnimatePresence>
          {drawerOpen && (
            <ReaderDrawer key="drawer" onClose={() => setDrawerOpen(false)}>
              {renderRail(() => setDrawerOpen(false))}
            </ReaderDrawer>
          )}
        </AnimatePresence>

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
      </div>
    </AppLayout>
  );
}
