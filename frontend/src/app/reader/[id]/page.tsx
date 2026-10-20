'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import { useTrack } from '@/app/lib/analytics';

interface Book {
  id: number;
  title: string;
  author?: string;
  language?: string;
}

interface KeyWord {
  wordText: string;
  cefrLevel?: string;
}

interface BookContent {
  text: string;
  currentPage: number;
  totalPages: number;
  totalWords: number;
  wordsRead: number;
  progress: number;
  keyWords?: KeyWord[];
}

interface TranslationResult {
  translation: string;
  alternatives?: string[];
  partOfSpeech?: string;
  source?: string;
  examples?: { english: string; translation: string }[];
}

interface WordToken {
  word: string;
  start: number;
  end: number;
}

interface TooltipData {
  word: string;
  cefrLevel?: string;
  translationRu?: string;
  freqRank?: number;
  translation?: string;
}

interface CollectedWord {
  text: string;
  page: number;
  sentence: string;
}

interface QuizQuestion {
  wordText: string;
  options: string[];
  correctIndex: number;
}

interface FinishResult {
  added: number;
  minutes: number;
  quiz?: { questions: QuizQuestion[] };
}

interface ParallelChunk {
  en: string;
  ru: string | null;
}

const SENTENCE_ENDINGS = '.!?…';

function getSentenceContext(text: string, start: number, end: number): string {
  let s = start - 1;
  while (s >= 0 && !SENTENCE_ENDINGS.includes(text[s])) s--;
  let e = end;
  while (e < text.length && !SENTENCE_ENDINGS.includes(text[e])) e++;
  if (e < text.length) e++;
  return text.slice(s + 1, e).trim();
}

const TOOLTIP_DELAY = 250;

const TUTORIAL_STORAGE_KEY = 'reader_tutorial_seen';
const AI_MODE_STORAGE_KEY = 'reader_ai_mode';
const FONT_SIZE_STORAGE_KEY = 'reader_font_size';
const LINE_WIDTH_STORAGE_KEY = 'reader_line_width';

const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 20;
const MIN_LINE_WIDTH = 45;
const MAX_LINE_WIDTH = 90;
const DEFAULT_LINE_WIDTH = 65;

// Свайп должен быть заметно горизонтальным, иначе это скролл или тап по слову
const SWIPE_MIN_DISTANCE = 60;
const SWIPE_DIRECTION_RATIO = 1.5;

const TUTORIAL_STEPS: {
  text: string;
  circle: { top: string; left: string; size: number };
  card: { top: string; left: string };
}[] = [
  {
    text: 'Кликните на любое слово — получите мгновенный перевод',
    circle: { top: '48%', left: '40%', size: 110 },
    card: { top: '62%', left: '40%' },
  },
  {
    text: 'Слова с ✦ — маркеры: кликните, чтобы собрать в конспект. В конце чтения — мини-тест',
    circle: { top: '56%', left: '44%', size: 110 },
    card: { top: '70%', left: '44%' },
  },
  {
    text: 'Включите RU — увидите параллельный перевод страницы',
    circle: { top: '13%', left: '76%', size: 90 },
    card: { top: '22%', left: '70%' },
  },
  {
    text: 'Здесь ваш конспект. Завершите чтение — и получите тест + новые слова в словарь',
    circle: { top: '13%', left: '86%', size: 90 },
    card: { top: '22%', left: '80%' },
  },
];

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

  const renderTooltip = (idx: number) => {
    if (!tooltip || tooltip.idx !== idx) return null;
    const t = tooltip.data;
    const translationText = t ? (t.translationRu ?? t.translation) : null;
    const isCollected = collectedRef.current.has(tooltip.word.toLowerCase());

    return (
      <div
        data-word-tooltip
        // На телефоне карточка прижата к низу экрана — так она не уезжает за край
        className={`fixed inset-x-4 bottom-4 z-[60] rounded-xl border border-[var(--color-hairline-strong)] bg-white p-3 shadow-lg md:absolute md:inset-x-auto md:left-0 md:w-[240px] ${
          tooltip.below
            ? 'md:top-full md:mt-1 md:bottom-auto'
            : 'md:bottom-full md:mb-1 md:top-auto'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-semibold break-words text-[var(--color-ink)]">
              {t?.word ?? tooltip.word}
            </span>
            {t?.cefrLevel && (
              <span className="px-1.5 py-0.5 bg-[var(--color-tint-mint)] text-[var(--color-primary)] text-[10px] rounded-full shrink-0">
                {t.cefrLevel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setTooltip(null)}
            aria-label="Закрыть подсказку"
            className="-mr-1 -mt-1 shrink-0 p-1 text-lg leading-none text-[var(--color-slate)] transition-colors hover:text-[var(--color-ink)]"
          >
            ×
          </button>
        </div>

        {tooltip.loading || !t ? (
          <div className="space-y-2 animate-pulse mt-2">
            <div className="h-3 w-2/3 bg-[var(--color-tint-mint)] rounded"></div>
            <div className="h-3 w-1/3 bg-[var(--color-tint-mint)] rounded"></div>
            <div className="h-3 w-1/2 bg-[var(--color-tint-mint)] rounded"></div>
          </div>
        ) : (
          <>
            {translationText ? (
              <p className="mt-1 text-sm text-[var(--color-ink)]">{translationText}</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-slate)] italic">перевод появится позже</p>
            )}
            {readingSessionId && (
              <button
                type="button"
                onClick={() => toggleCollected(tooltip.word, wordTokens[tooltip.idx])}
                className={`mt-2 w-full rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  isCollected
                    ? 'bg-[rgba(249,231,159,0.60)] text-[var(--color-ink)]'
                    : 'bg-[var(--color-tint-mint)] text-[var(--color-primary)]'
                }`}
              >
                {isCollected ? '✓ В конспекте' : '+ В конспект'}
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  const renderText = () => {
    if (!content?.text) return null;

    return (
      <div>
        {wordTokens.map((token, idx) => {
          const cleanWord = token.word.replace(/[^a-zA-Z']/g, '');
          const lower = cleanWord.toLowerCase();
          const isClickable = cleanWord.length >= 2;
          const isSelected = idx === selectedWordIndex;
          const isMarker = isClickable && keyWordsSet.has(lower);
          const isCollected = collectedRef.current.has(lower);

          if (isMarker) {
            return (
              <span
                key={idx}
                data-marker-word
                className="relative inline-block mr-1"
                onMouseEnter={() => handleMarkerEnter(idx, lower)}
                onMouseLeave={handleMarkerLeave}
                onBlur={(e) => {
                  // Фокус ушёл за пределы слова и карточки — закрываем подсказку
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setTooltip(null);
                  }
                }}
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`${lower}: перевод и добавление в конспект`}
                  aria-expanded={tooltip?.idx === idx}
                  onClick={() => handleMarkerClick(idx, lower, token)}
                  onKeyDown={(e) => handleMarkerKeyDown(e, lower, token)}
                  onFocus={() => showTooltip(idx, lower)}
                  className={`inline-block rounded px-0.5 border-b border-dashed border-[var(--color-primary-pressed)] cursor-pointer transition-colors hover:bg-[rgba(249,231,159,0.20)] ${
                    isCollected ? 'bg-[rgba(249,231,159,0.60)] text-[var(--color-ink)]' : ''
                  }`}
                >
                  {token.word}
                  <span className="text-[var(--color-primary-pressed)] text-xs ml-0.5 select-none">
                    {isCollected ? '✓' : '✦'}
                  </span>
                </span>
                {renderTooltip(idx)}
              </span>
            );
          }

          return (
            <span
              key={idx}
              onClick={() => isClickable && handleWordClick(idx)}
              className={`inline-block mr-1 rounded px-0.5 transition-colors ${
                isSelected
                  ? 'bg-[var(--color-tint-yellow-bold)] text-[var(--color-ink)]'
                  : isClickable
                    ? 'cursor-pointer hover:bg-[rgba(249,231,159,0.20)]'
                    : 'text-[var(--color-slate)]'
              }`}
            >
              {token.word}
            </span>
          );
        })}
      </div>
    );
  };

  const renderParallelText = () => {
    if (parallelLoading) {
      return (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start">
          {[95, 88, 92, 70].map((w, i) => (
            <Fragment key={i}>
              <div className="h-5 rounded bg-[var(--color-tint-mint)] animate-pulse" style={{ width: `${w}%` }}></div>
              <div
                className="h-4 mt-1 rounded bg-[rgba(217,243,225,0.60)] animate-pulse"
                style={{ width: `${Math.max(40, w - 25)}%` }}
              ></div>
            </Fragment>
          ))}
        </div>
      );
    }

    if (parallelError) {
      return (
        <div className="text-center py-10">
          <p className="text-sm text-[var(--color-error)] mb-4">Не удалось загрузить перевод</p>
          <button
            onClick={() => loadParallel(currentPage, true)}
            className="btn-secondary text-sm py-2 px-4"
          >
            Повторить
          </button>
        </div>
      );
    }

    const chunks = parallelPages[currentPage] ?? [];

    return (
      <div>
        {showParallelHint && (
          <p className="text-xs text-[var(--color-slate)] italic mb-4">
            Кликайте по словам в обычном режиме EN
          </p>
        )}
        {/* Две колонки: слева EN, справа RU; на узких экранах складываются в одну */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start">
          {chunks.map((chunk, i) => (
            <Fragment key={i}>
              <p className="text-[var(--color-ink)]">{chunk.en}</p>
              <p className="text-base leading-relaxed text-[var(--color-slate)]">{chunk.ru ?? ''}</p>
            </Fragment>
          ))}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <AppLayout fullWidth>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !book) {
    return (
      <AppLayout fullWidth>
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgba(217,45,32,0.10)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-[var(--color-error)] mb-2">{error || 'Книга не найдена'}</p>
          <p className="text-sm text-[var(--color-slate)] mb-6">ID книги: {bookId}</p>
          <button onClick={() => router.push('/books')} className="btn-primary">
            ← Назад к книгам
          </button>
        </div>
      </AppLayout>
    );
  }

  const isTyping = !!translation && displayedTranslation.length < translation.translation.length;
  const quizQuestions = finishResult?.quiz?.questions ?? [];
  const quizCurrent = quizQuestions[quizIndex];

  const renderFinishModal = () => {
    if (!finishResult) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,29,35,0.50)] p-4">
        <div className="card max-w-md w-full p-8 text-center max-h-[90vh] overflow-y-auto">
          <h2 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Отличная работа! 🎉</h2>
          <p className="text-[var(--color-slate)] mb-1">Добавлено {finishResult.added} слов в словарь</p>
          <p className="text-[var(--color-slate)] mb-6">Время чтения: {finishResult.minutes} мин</p>

          {quizQuestions.length > 0 && !quizDone && quizCurrent ? (
            <div className="text-left">
              <p className="text-xs text-[var(--color-slate)] mb-3 text-center">
                Вопрос {quizIndex + 1} из {quizQuestions.length}
              </p>
              <p className="text-3xl font-bold text-[var(--color-ink)] text-center mb-6 break-words">
                {quizCurrent.wordText}
              </p>
              <div className="space-y-2 mb-4">
                {quizCurrent.options.map((opt, i) => {
                  let cls = 'bg-white border-[var(--color-hairline-strong)] hover:bg-[var(--color-tint-mint)]';
                  if (quizAnswer !== null) {
                    if (i === quizCurrent.correctIndex) {
                      cls = 'bg-[var(--color-tint-mint)] border-[var(--color-primary)] text-[var(--color-primary)]';
                    } else if (i === quizAnswer) {
                      cls = 'bg-[rgba(217,45,32,0.10)] border-[var(--color-error)] text-[var(--color-error)]';
                    } else {
                      cls = 'bg-white border-[var(--color-hairline-strong)] opacity-60';
                    }
                  }
                  return (
                    <button
                      key={i}
                      disabled={quizAnswer !== null}
                      onClick={() => {
                        setQuizAnswer(i);
                        if (i === quizCurrent.correctIndex) setQuizScore(s => s + 1);
                      }}
                      className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors ${cls}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {quizAnswer !== null && (
                <button
                  onClick={() => {
                    if (quizIndex + 1 < quizQuestions.length) {
                      setQuizIndex(i => i + 1);
                      setQuizAnswer(null);
                    } else {
                      setQuizDone(true);
                    }
                  }}
                  className="w-full btn-primary"
                >
                  {quizIndex + 1 < quizQuestions.length ? 'Далее' : 'Показать результат'}
                </button>
              )}
            </div>
          ) : quizQuestions.length > 0 && quizDone ? (
            <div>
              <p className="text-xl font-semibold text-[var(--color-primary)] mb-2">
                Результат: {quizScore} из {quizQuestions.length}
              </p>
              <p className="text-sm text-[var(--color-slate)] mb-6">
                Слова уже в вашем словаре — система подстроит повторения
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setFinishResult(null)} className="btn-primary">
                  Читать дальше
                </button>
                <button onClick={() => router.push('/dictionary')} className="btn-secondary">
                  К словарю
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 justify-center">
              <button onClick={() => setFinishResult(null)} className="btn-primary">
                Читать дальше
              </button>
              <button onClick={() => router.push('/dictionary')} className="btn-secondary">
                К словарю
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AppLayout fullWidth>
      {/* Шапка книги */}
      <div className="mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[var(--color-ink)] sm:text-2xl">{book.title}</h1>
            {book.author && <p className="text-[var(--color-slate)]">{book.author}</p>}
          </div>

          {content && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="w-full sm:w-48">
                <div className="flex justify-between text-xs text-[var(--color-slate)] mb-1">
                  <span>{content.progress}%</span>
                  <span>{content.wordsRead.toLocaleString()} / {content.totalWords.toLocaleString()}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${content.progress}%` }}></div>
                </div>
              </div>
              <span className="text-sm tabular-nums text-[var(--color-slate)]">
                {content.currentPage} / {content.totalPages}
              </span>

              {/* Настройки текста: кегль и ширина строки */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTextSettings(v => !v)}
                  aria-label="Настройки текста"
                  aria-expanded={showTextSettings}
                  title="Настройки текста"
                  className="h-10 w-10 rounded-full border border-[var(--color-hairline-strong)] bg-white text-sm font-semibold text-[var(--color-slate)] shadow-md transition-colors hover:bg-[var(--color-tint-mint)]"
                >
                  Aa
                </button>

                {showTextSettings && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowTextSettings(false)}
                      aria-hidden="true"
                    />
                    <div className="card fixed left-4 right-4 top-24 z-50 p-4 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Текст</h2>
                        <button
                          type="button"
                          onClick={() => setShowTextSettings(false)}
                          aria-label="Закрыть настройки текста"
                          className="p-1 text-lg leading-none text-[var(--color-slate)] transition-colors hover:text-[var(--color-ink)]"
                        >
                          ×
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-[var(--color-slate)]">Размер</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => changeFontSize(-1)}
                            disabled={fontSize <= MIN_FONT_SIZE}
                            aria-label="Уменьшить текст"
                            className="h-8 w-8 rounded-lg border border-[var(--color-hairline-strong)] bg-white text-sm font-semibold transition-colors hover:bg-[var(--color-tint-mint)] disabled:opacity-40"
                          >
                            A−
                          </button>
                          <span className="w-8 text-center text-sm tabular-nums">{fontSize}</span>
                          <button
                            type="button"
                            onClick={() => changeFontSize(1)}
                            disabled={fontSize >= MAX_FONT_SIZE}
                            aria-label="Увеличить текст"
                            className="h-8 w-8 rounded-lg border border-[var(--color-hairline-strong)] bg-white text-sm font-semibold transition-colors hover:bg-[var(--color-tint-mint)] disabled:opacity-40"
                          >
                            A+
                          </button>
                        </div>
                      </div>

                      <label className="mt-4 block">
                        <span className="mb-1 flex items-center justify-between text-sm text-[var(--color-slate)]">
                          <span>Ширина строки</span>
                          <span className="tabular-nums">{lineWidth}</span>
                        </span>
                        <input
                          type="range"
                          min={MIN_LINE_WIDTH}
                          max={MAX_LINE_WIDTH}
                          value={lineWidth}
                          onChange={(e) => changeLineWidth(Number(e.target.value))}
                          className="w-full accent-[var(--color-primary)]"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={resetTextSettings}
                        className="mt-3 text-xs text-[var(--color-slate)] underline decoration-[var(--color-hairline-strong)] underline-offset-2 transition-colors hover:text-[var(--color-ink)]"
                      >
                        Сбросить
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={toggleParallelMode}
                title="Параллельный перевод"
                aria-pressed={parallelMode}
                className={`h-10 px-3.5 rounded-full text-sm font-semibold shadow-md transition-colors ${
                  parallelMode
                    ? 'bg-[var(--color-tint-yellow-bold)] text-[var(--color-ink)] hover:bg-[#E3BF5F]'
                    : 'bg-white border border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:bg-[var(--color-tint-mint)]'
                }`}
              >
                {parallelMode ? 'RU ⇄' : 'EN'}
              </button>

              {/* Свернуть/развернуть панель перевода — только на десктопе */}
              {!parallelMode && (
                <button
                  type="button"
                  onClick={() => setPanelOpen(v => !v)}
                  title={panelOpen ? 'Свернуть перевод' : 'Показать перевод'}
                  aria-label={panelOpen ? 'Свернуть панель перевода' : 'Показать панель перевода'}
                  aria-expanded={panelOpen}
                  className="hidden h-10 w-10 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] bg-white text-[var(--color-slate)] shadow-md transition-colors hover:bg-[var(--color-tint-mint)] md:inline-flex"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={panelOpen ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
                  </svg>
                </button>
              )}

              {readingSessionId && (
                <button
                  onClick={() => setShowNotes(v => !v)}
                  className="relative h-10 min-w-10 rounded-full bg-[var(--color-tint-yellow-bold)] px-2 text-[var(--color-ink)] font-semibold shadow-md hover:shadow-lg transition-shadow"
                  title="Конспект"
                  aria-label={`Конспект, слов: ${collectedKeys.length}`}
                  aria-expanded={showNotes}
                >
                  ✦ {collectedKeys.length}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Поповер конспекта */}
      {showNotes && readingSessionId && (
        <div className="card fixed inset-x-4 top-20 z-40 flex max-h-[70vh] flex-col p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-8 sm:top-32 sm:w-80">
          <h3 className="font-semibold text-[var(--color-ink)] mb-3">Конспект ✦ {collectedKeys.length}</h3>
          <div className="overflow-y-auto space-y-2 mb-3 flex-1">
            {collectedKeys.length === 0 ? (
              <p className="text-sm text-[var(--color-slate)]">Нажимайте на маркерные слова (✦), чтобы собрать их в конспект.</p>
            ) : (
              collectedKeys.map(key => {
                const item = collectedRef.current.get(key)!;
                return (
                  <div key={key} className="p-2 bg-[var(--color-surface)] rounded-lg border border-[var(--color-hairline-strong)] flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-ink)] break-words">{item.text}</p>
                      {item.sentence && (
                        <p className="text-xs text-[var(--color-slate)] mt-0.5 line-clamp-2 break-words">{item.sentence}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeCollected(key)}
                      className="text-[var(--color-error)] hover:text-[#8F4343] text-lg leading-none shrink-0"
                      title="Удалить"
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <button
            onClick={finishReading}
            disabled={isFinishing}
            className="w-full btn-primary disabled:opacity-50"
          >
            {isFinishing ? 'Завершаем…' : 'Завершить чтение'}
          </button>
        </div>
      )}

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
              className="animate-page-in mx-auto font-serif text-[var(--color-ink)]"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.8, maxWidth: `${lineWidth}ch` }}
            >
              {parallelMode ? renderParallelText() : renderText()}
            </div>
          </div>

          {/* Пагинация */}
          {content && content.totalPages > 1 && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Предыдущая страница"
                className="btn-secondary"
              >
                <span className="hidden sm:inline">← Назад</span>
                <span aria-hidden="true" className="sm:hidden">←</span>
              </button>

              <div className="flex items-center gap-1.5 sm:gap-2">
                {Array.from({ length: Math.min(5, content.totalPages) }, (_, i) => {
                  let pageNum;
                  if (content.totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= content.totalPages - 2) {
                    pageNum = content.totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => goToPage(pageNum)}
                      aria-label={`Страница ${pageNum}`}
                      aria-current={pageNum === currentPage ? 'page' : undefined}
                      className={`h-9 w-9 rounded-lg text-sm transition-colors sm:h-10 sm:w-10 ${
                        pageNum === currentPage
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-white border border-[var(--color-hairline-strong)] hover:bg-[var(--color-tint-mint)]'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === content.totalPages}
                aria-label="Следующая страница"
                className="btn-secondary"
              >
                <span className="hidden sm:inline">Вперёд →</span>
                <span aria-hidden="true" className="sm:hidden">→</span>
              </button>
            </div>
          )}

          {content && content.totalPages > 1 && (
            <p className="mt-3 text-center text-xs text-[var(--color-slate)] md:hidden">
              Свайп влево и вправо листает страницы
            </p>
          )}
        </div>

        {/* Панель перевода — скрыта в режиме параллельного перевода.
            На телефоне это bottom-sheet, на десктопе — сворачиваемая колонка. */}
        {!parallelMode && (
        <>
          {/* Затемнение под bottom-sheet, только мобильные */}
          <div
            className={`fixed inset-0 z-40 bg-[rgba(11,37,69,0.35)] transition-opacity duration-300 md:hidden ${
              panelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setPanelOpen(false)}
            aria-hidden="true"
          />

          <div
            data-translation-panel
            className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 md:static md:z-auto md:w-72 md:shrink-0 md:translate-y-0 ${
              panelOpen ? 'translate-y-0' : 'translate-y-full md:hidden'
            }`}
          >
            <div className="card max-h-[72vh] overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:sticky md:top-8 md:max-h-none md:rounded-b-lg md:p-5">
              {/* Ручка bottom-sheet и заголовок панели */}
              <div className="mb-3">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--color-hairline-strong)] md:hidden" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-slate)]">
                    Перевод
                  </span>
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    aria-label="Свернуть панель перевода"
                    className="rounded p-1 text-lg leading-none text-[var(--color-slate)] transition-colors hover:text-[var(--color-ink)] md:text-base"
                  >
                    <span aria-hidden="true" className="md:hidden">×</span>
                    <span aria-hidden="true" className="hidden md:inline">→</span>
                  </button>
                </div>
              </div>

            {selectedWord ? (
              <>
                <div className="flex items-start justify-between mb-4 pb-3 border-b border-[var(--color-hairline-strong)]">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-bold text-[var(--color-ink)] break-words">{selectedWord}</h2>
                    {translation?.partOfSpeech && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-[var(--color-tint-mint)] text-[var(--color-primary)] text-xs rounded-full">
                        {translation.partOfSpeech}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => speak(selectedWord)}
                    className="p-2 text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors shrink-0"
                    title="Произнести"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  </button>
                </div>

                {isTranslating ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" style={{ animationDelay: '200ms' }}></span>
                      <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" style={{ animationDelay: '400ms' }}></span>
                    </div>
                    {aiMode && (
                      <p className="text-sm text-[var(--color-slate)]">ИИ анализирует контекст…</p>
                    )}
                  </div>
                ) : translationError ? (
                  <div className="text-center py-6">
                    <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-[rgba(217,45,32,0.10)] flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 21a9 9 0 100-18 9 9 000 18z" />
                      </svg>
                    </div>
                    <p className="text-sm text-[var(--color-error)] mb-4">Не удалось перевести.<br />Попробуйте ещё раз</p>
                    <button
                      onClick={() => selectedWordIndex !== null && handleWordClick(selectedWordIndex)}
                      className="btn-secondary text-sm py-2 px-4"
                    >
                      Повторить
                    </button>
                  </div>
                ) : translation ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xl text-[var(--color-primary)] font-medium min-h-[2rem]">
                        {displayedTranslation}
                        {isTyping && (
                          <span className="inline-block w-0.5 h-5 bg-[var(--color-primary)] ml-1 typing-cursor align-middle"></span>
                        )}
                      </p>
                      {!isTyping && translation.source && (
                        <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-[var(--color-slate)]">
                          {translation.source}
                        </span>
                      )}
                    </div>

                    {!isTyping && translation.alternatives && translation.alternatives.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium text-[var(--color-slate)] mb-2">Варианты</h3>
                        <div className="flex flex-wrap gap-2">
                          {translation.alternatives.map((alt, idx) => (
                            <span key={idx} className="px-2 py-1 bg-[var(--color-tint-mint)] text-[var(--color-ink)] text-xs rounded-lg">
                              {alt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isTyping && translation.examples && translation.examples.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium text-[var(--color-slate)] mb-2">Примеры</h3>
                        <div className="space-y-2">
                          {translation.examples.slice(0, 2).map((ex, idx) => (
                            <div key={idx} className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-hairline-strong)]">
                              <button
                                onClick={() => speak(ex.english)}
                                className="text-left w-full group"
                              >
                                <p className="text-sm text-[var(--color-ink)] group-hover:text-[var(--color-primary)] font-medium">
                                  {ex.english}
                                </p>
                                <p className="text-xs text-[var(--color-slate)] mt-1">{ex.translation}</p>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={addToDictionary}
                      disabled={isTyping || addedToDict}
                      className={`w-full text-sm py-2 rounded-lg transition-colors ${
                        addedToDict
                          ? 'bg-[var(--color-tint-mint)] text-[var(--color-primary)] cursor-default'
                          : 'btn-primary'
                      }`}
                    >
                      {addedToDict ? '✓ Добавлено' : '+ В словарь'}
                    </button>

                    {readingSessionId && (
                      <button
                        onClick={() => toggleCollected(selectedWord)}
                        disabled={isTyping || collectedRef.current.has(selectedWord)}
                        className={`w-full text-sm py-2 rounded-lg transition-colors ${
                          collectedRef.current.has(selectedWord)
                            ? 'bg-[rgba(249,231,159,0.40)] text-[var(--color-ink)] cursor-default'
                            : 'btn-secondary'
                        }`}
                      >
                        {collectedRef.current.has(selectedWord) ? '✓ В конспекте' : '✎ В конспект'}
                      </button>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-center py-8">
                <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-[var(--color-tint-mint)] flex items-center justify-center">
                  <svg className="w-5 h-5 text-[var(--color-slate)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                </div>
                <p className="text-sm text-[var(--color-slate)]">Нажми на слово<br />для перевода</p>
              </div>
            )}

            {/* Переключатель ИИ-перевода с контекстом */}
            <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-[var(--color-hairline-strong)] pt-3">
              <input
                type="checkbox"
                checked={aiMode}
                onChange={(e) => toggleAiMode(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--color-ink)]">✨ ИИ-перевод с контекстом</span>
                <span className="block text-xs text-[var(--color-slate)]">Медленнее, но понимает смысл в контексте</span>
              </span>
            </label>
            </div>
          </div>
        </>
        )}
      </div>

      {/* Туториал для новичка */}
      {tutorialStep !== null && TUTORIAL_STEPS[tutorialStep] && (
        <div className="fixed inset-0 z-[60]">
          {(() => {
            const step = TUTORIAL_STEPS[tutorialStep];
            const isLast = tutorialStep === TUTORIAL_STEPS.length - 1;
            return (
              <>
                {/* «Прожектор» — круглое отверстие в тёмном оверлее */}
                <div
                  className="absolute rounded-full transition-opacity duration-300"
                  style={{
                    top: step.circle.top,
                    left: step.circle.left,
                    width: step.circle.size,
                    height: step.circle.size,
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
                    opacity: tutorialVisible ? 1 : 0,
                  }}
                />
                {/* Карточка с текстом шага */}
                <div
                  className="absolute w-80 max-w-[90vw] bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5 shadow-2xl transition-all duration-200"
                  style={{
                    top: step.card.top,
                    left: step.card.left,
                    transform: `translateX(-50%) scale(${tutorialVisible ? 1 : 0.95})`,
                    opacity: tutorialVisible ? 1 : 0,
                  }}
                >
                  <p className="text-xs font-semibold text-[var(--color-primary)] mb-2">
                    Шаг {tutorialStep + 1} из {TUTORIAL_STEPS.length}
                  </p>
                  <p className="text-sm text-[var(--color-ink)] leading-relaxed mb-4">{step.text}</p>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={finishTutorial}
                      className="text-xs text-[var(--color-slate)] hover:text-[var(--color-ink)] transition-colors"
                    >
                      Пропустить
                    </button>
                    <button
                      onClick={() =>
                        isLast
                          ? finishTutorial()
                          : setTutorialStep(s => (s === null ? null : s + 1))
                      }
                      className="btn-primary text-sm py-2 px-5"
                    >
                      {isLast ? 'Начать читать' : 'Далее'}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {renderFinishModal()}
    </AppLayout>
  );
}
