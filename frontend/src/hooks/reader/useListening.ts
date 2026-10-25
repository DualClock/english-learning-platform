'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpeechManifest, resolveApiAssetUrl } from '@/lib/reader/api';
import type { ReaderChapter, ReaderSentence } from '@/lib/reader/types';

export type ListeningStatus = 'idle' | 'loading' | 'playing' | 'paused';
export type ListeningProvider = 'azure' | 'browser';

interface Options {
  bookId: number;
  chapter: ReaderChapter | null;
  token?: string;
  /** Текущее предложение — читалка подсвечивает его и перелистывает страницу. */
  onSentenceChange?: (sentence: ReaderSentence, index: number) => void;
  onEnd?: () => void;
}

interface ListeningResult {
  status: ListeningStatus;
  provider: ListeningProvider;
  index: number;
  total: number;
  activeSentenceId: string | null;
  error: string | null;
  toggle: () => void;
  start: (sentenceId?: string) => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
}

const PRELOAD_AHEAD = 3;

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Озвучка главы. Звук идёт с сервера (Azure, AriaNeural) по предложениям:
 * пока читатель слушает одну фразу, следующие две-три уже качаются. Если
 * ключа нет, лимит исчерпан или провайдер ответил ошибкой — та же кнопка
 * продолжает читать голосом браузера, без отдельного режима и без тишины.
 */
export function useListening({
  bookId,
  chapter,
  token,
  onSentenceChange,
  onEnd,
}: Options): ListeningResult {
  const [status, setStatus] = useState<ListeningStatus>('idle');
  const [provider, setProvider] = useState<ListeningProvider>('azure');
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sentences = chapter ? chapter.blocks.flatMap((block) => block.sentences) : [];
  const sentencesRef = useRef<ReaderSentence[]>(sentences);
  const indexRef = useRef(0);
  const statusRef = useRef<ListeningStatus>('idle');
  const providerRef = useRef<ListeningProvider>('azure');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  const preloadRef = useRef<HTMLAudioElement[]>([]);
  const runIdRef = useRef(0);
  const chapterIdRef = useRef<string | null>(chapter?.id ?? null);
  const callbacksRef = useRef({ onSentenceChange, onEnd });

  sentencesRef.current = sentences;
  callbacksRef.current = { onSentenceChange, onEnd };

  const setStatusSafe = useCallback((next: ListeningStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    for (const preloaded of preloadRef.current) {
      preloaded.removeAttribute('src');
      preloaded.load();
    }
    preloadRef.current = [];

    if (speechAvailable()) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    stopAudio();
    setStatusSafe('idle');
    setError(null);
  }, [setStatusSafe, stopAudio]);

  const notify = useCallback((nextIndex: number) => {
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    const sentence = sentencesRef.current[nextIndex];
    if (sentence) {
      callbacksRef.current.onSentenceChange?.(sentence, nextIndex);
    }
  }, []);

  const preload = useCallback((fromIndex: number) => {
    const urls = urlsRef.current;
    const list = sentencesRef.current;
    for (let offset = 1; offset <= PRELOAD_AHEAD; offset++) {
      const sentence = list[fromIndex + offset];
      const url = sentence ? urls.get(sentence.id) : null;
      if (!url) continue;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      audio.load();
      preloadRef.current.push(audio);
    }
  }, []);

  const finish = useCallback(() => {
    stopAudio();
    setStatusSafe('idle');
    callbacksRef.current.onEnd?.();
  }, [setStatusSafe, stopAudio]);

  const playBrowser = useCallback(
    (target: number) => {
      if (!speechAvailable()) {
        setError('Браузер не умеет читать вслух.');
        setStatusSafe('idle');
        return;
      }

      const sentence = sentencesRef.current[target];
      if (!sentence) {
        finish();
        return;
      }

      providerRef.current = 'browser';
      setProvider('browser');
      notify(target);

      const utterance = new SpeechSynthesisUtterance(sentence.text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;

      const runId = runIdRef.current;
      utterance.onend = () => {
        if (runId !== runIdRef.current) return;
        const next = indexRef.current + 1;
        if (next >= sentencesRef.current.length) {
          finish();
        } else {
          playBrowser(next);
        }
      };
      utterance.onerror = () => {
        if (runId !== runIdRef.current) return;
        setError('Браузер прервал озвучку.');
        setStatusSafe('paused');
      };

      setStatusSafe('playing');
      window.speechSynthesis.speak(utterance);
    },
    [finish, notify, setStatusSafe]
  );

  const playServer = useCallback(
    (target: number) => {
      const sentence = sentencesRef.current[target];
      if (!sentence) {
        finish();
        return;
      }

      const url = urlsRef.current.get(sentence.id);
      if (!url) {
        playBrowser(target);
        return;
      }

      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        audioRef.current = audio;
      }

      const runId = runIdRef.current;
      const current = audio;

      current.onended = () => {
        if (runId !== runIdRef.current) return;
        const next = indexRef.current + 1;
        if (next >= sentencesRef.current.length) {
          finish();
        } else {
          playServer(next);
        }
      };

      // Ошибка звука (429, сеть, истёкшая подпись) — не повод молчать:
      // та же фраза дочитывается голосом браузера.
      current.onerror = () => {
        if (runId !== runIdRef.current) return;
        playBrowser(indexRef.current);
      };

      providerRef.current = 'azure';
      setProvider('azure');
      notify(target);
      setStatusSafe('playing');

      current.src = url;
      void current.play().catch(() => {
        if (runId !== runIdRef.current) return;
        playBrowser(indexRef.current);
      });

      preload(target);
    },
    [finish, notify, playBrowser, preload, setStatusSafe]
  );

  const playFrom = useCallback(
    (target: number) => {
      if (providerRef.current === 'azure') {
        playServer(target);
      } else {
        playBrowser(target);
      }
    },
    [playBrowser, playServer]
  );

  const begin = useCallback(
    async (fromSentenceId?: string) => {
      if (sentencesRef.current.length === 0) return;

      runIdRef.current += 1;
      const runId = runIdRef.current;
      stopAudio();
      setError(null);
      setStatusSafe('loading');

      const list = sentencesRef.current;
      const startIndex = fromSentenceId
        ? Math.max(0, list.findIndex((sentence) => sentence.id === fromSentenceId))
        : Math.min(indexRef.current, list.length - 1);

      let manifestAvailable = false;
      if (token) {
        try {
          const manifest = await getSpeechManifest(bookId, chapterIdRef.current ?? '', token);
          if (runId !== runIdRef.current) return;

          manifestAvailable = manifest.available && manifest.segments.length > 0;
          const urls = new Map<string, string>();
          for (const segment of manifest.segments) {
            const resolved = resolveApiAssetUrl(segment.url);
            if (resolved) urls.set(segment.sentenceId, resolved);
          }
          urlsRef.current = urls;
        } catch {
          if (runId !== runIdRef.current) return;
          manifestAvailable = false;
        }
      }

      providerRef.current = manifestAvailable ? 'azure' : 'browser';
      setProvider(providerRef.current);

      if (!manifestAvailable) {
        // iOS не даёт говорить без жеста, а fetch уже съел жест: показываем
        // паузу и ждём второго нажатия. На десктопе стартуем сразу.
        if (isIos()) {
          notify(startIndex);
          setStatusSafe('paused');
          return;
        }

        playBrowser(startIndex);
        return;
      }

      playServer(startIndex);
    },
    [bookId, notify, playBrowser, playServer, setStatusSafe, stopAudio, token]
  );

  const start = useCallback(
    (sentenceId?: string) => {
      void begin(sentenceId);
    },
    [begin]
  );

  const toggle = useCallback(() => {
    if (statusRef.current === 'loading') {
      return;
    }

    if (statusRef.current === 'playing') {
      if (providerRef.current === 'azure') {
        audioRef.current?.pause();
      } else if (speechAvailable()) {
        window.speechSynthesis.pause();
      }
      setStatusSafe('paused');
      return;
    }

    if (statusRef.current === 'paused') {
      if (providerRef.current === 'azure' && audioRef.current?.src) {
        setStatusSafe('playing');
        void audioRef.current.play().catch(() => playBrowser(indexRef.current));
        return;
      }

      if (speechAvailable()) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          setStatusSafe('playing');
          return;
        }

        // Пауза после сброса (iOS, смена главы): начинаем с текущего места.
        playBrowser(indexRef.current);
        return;
      }
    }

    start();
  }, [playBrowser, setStatusSafe, start]);

  const next = useCallback(() => {
    const target = indexRef.current + 1;
    if (target >= sentencesRef.current.length) {
      finish();
      return;
    }

    runIdRef.current += 1;
    stopAudio();
    playFrom(target);
  }, [finish, playFrom, stopAudio]);

  const previous = useCallback(() => {
    const target = Math.max(0, indexRef.current - 1);
    runIdRef.current += 1;
    stopAudio();
    playFrom(target);
  }, [playFrom, stopAudio]);

  // Смена главы и уход со страницы обрывают звук: продолжать чтение
  // предыдущей главы поверх новой страницы — худший из возможных багов.
  useEffect(() => {
    if (chapterIdRef.current !== (chapter?.id ?? null)) {
      chapterIdRef.current = chapter?.id ?? null;
      stop();
      indexRef.current = 0;
      setIndex(0);
      urlsRef.current = new Map();
    }
  }, [chapter?.id, stop]);

  useEffect(() => stop, [stop]);

  return {
    status,
    provider,
    index,
    total: sentences.length,
    activeSentenceId: status === 'idle' ? null : sentences[index]?.id ?? null,
    error,
    toggle,
    start,
    stop,
    next,
    previous,
  };
}
