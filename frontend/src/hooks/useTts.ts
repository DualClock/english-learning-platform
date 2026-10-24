'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';
import { shouldUseServerTts } from '@/lib/tts';
import { useSpeech } from './useSpeech';

type Engine = 'server' | 'browser';

/**
 * Сколько миллисекунд ждём серверный голос, прежде чем озвучить браузерным.
 *
 * Замеры на проде 24.10: слово из серверного кэша отдаётся за 0,4 с, новое
 * собирается через прокси к Gemini за 3–4,5 с (и 15 с бывало, когда в цепочку
 * попадал текстовый запасной путь). Окно в 6 с покрывает обычную генерацию,
 * так что роботизованный голос слышен только когда провайдер реально молчит.
 * Кнопки за это время показывают спиннер — ожидание не выглядит поломкой.
 */
const SERVER_GRACE_MS = 6000;

/**
 * Озвучка с серверным TTS (Gemini, голос Kore) и автоматическим откатом на Web Speech API.
 *
 * Серверный голос звучит естественнее, но идёт через сеть и тратит квоту,
 * поэтому при ошибке, таймауте или просто долгой генерации молча переключаемся
 * на браузерный синтез — упражнение не должно ломаться из-за провайдера.
 *
 * Русские строки на сервер не уезжают сознательно: см. `lib/tts.ts`.
 */
export function useTts() {
  const { data: session } = useSession();
  const { speak: webSpeak, stop: webStop, isSupported } = useSpeech();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    releaseUrl();
    webStop();
    setIsPlaying(false);
    setIsLoading(false);
  }, [releaseUrl, webStop]);

  useEffect(() => stop, [stop]);

  const playBrowser = useCallback(
    (clean: string) => {
      setIsLoading(false);
      if (!isSupported) return;

      setEngine('browser');
      setIsPlaying(true);
      webSpeak(clean);
      // Web Speech не даёт надёжного onend во всех браузерах,
      // поэтому снимаем индикатор по таймеру от длины фразы
      const ms = Math.max(1200, clean.length * 75);
      window.setTimeout(() => setIsPlaying(false), ms);
    },
    [isSupported, webSpeak]
  );

  const play = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;

      stop();

      if (!shouldUseServerTts(clean)) {
        playBrowser(clean);
        return;
      }

      const requestId = requestRef.current;
      setIsLoading(true);

      const pending = fetch(`${API_URL}/api/audio/tts?text=${encodeURIComponent(clean)}`, {
        headers: session?.accessToken
          ? { Authorization: `Bearer ${session.accessToken}` }
          : {},
      });

      // Долгая генерация не должна превращать клик в тишину: через окно ожидания
      // озвучиваем браузерным голосом, а запрос оставляем жить — он кладёт аудио
      // в серверный кэш, и следующее нажатие на это же слово будет быстрым.
      const timeout = new Promise<'slow'>((resolve) => {
        window.setTimeout(() => resolve('slow'), SERVER_GRACE_MS);
      });

      const raced = await Promise.race([pending, timeout]).catch(() => null);

      if (requestId !== requestRef.current) return;

      if (raced === 'slow' || raced === null) {
        void pending
          .then((res) => (res.ok ? res.blob() : null))
          .catch(() => null);
        playBrowser(clean);
        return;
      }

      const res = raced as Response;

      if (res.ok) {
        try {
          const blob = await res.blob();
          if (requestId !== requestRef.current) return;

          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;

          audio.onended = () => {
            setIsPlaying(false);
            releaseUrl();
          };
          audio.onerror = () => {
            setIsPlaying(false);
            releaseUrl();
          };

          setIsLoading(false);
          setIsPlaying(true);
          setEngine('server');
          await audio.play();
          return;
        } catch {
          // тело ответа испорчено — ниже сработает браузерный синтез
        }
      } else {
        void res.blob().catch(() => null);
      }

      if (requestId !== requestRef.current) return;

      playBrowser(clean);
    },
    [session?.accessToken, releaseUrl, stop, playBrowser]
  );

  // `speak`/`isSpeaking` — те же имена, что у useSpeech: страницы переходят на
  // серверный голос заменой хука, а не переписыванием всех обработчиков.
  return { play, speak: play, stop, isPlaying, isSpeaking: isPlaying, isLoading, engine };
}
