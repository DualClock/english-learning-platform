'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';
import { useSpeech } from './useSpeech';

type Engine = 'server' | 'browser';

/**
 * Озвучка с серверным TTS (Gemini) и автоматическим откатом на Web Speech API.
 *
 * Серверный голос звучит естественнее, но идёт через сеть и тратит квоту,
 * поэтому при ошибке/таймауте молча переключаемся на браузерный синтез —
 * упражнение не должно ломаться из-за недоступного провайдера.
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

  const play = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;

      stop();
      const requestId = requestRef.current;
      setIsLoading(true);

      try {
        const res = await fetch(`${API_URL}/api/audio/tts?text=${encodeURIComponent(clean)}`, {
          headers: session?.accessToken
            ? { Authorization: `Bearer ${session.accessToken}` }
            : {},
        });

        if (requestId !== requestRef.current) return;

        if (res.ok) {
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
        }
      } catch {
        // сеть/провайдер недоступны — ниже сработает браузерный синтез
      }

      if (requestId !== requestRef.current) return;

      setIsLoading(false);
      if (isSupported) {
        setEngine('browser');
        setIsPlaying(true);
        webSpeak(clean);
        // Web Speech не даёт надёжного onend во всех браузерах,
        // поэтому снимаем индикатор по таймеру от длины фразы
        const ms = Math.max(1200, clean.length * 75);
        window.setTimeout(() => setIsPlaying(false), ms);
      }
    },
    [session?.accessToken, isSupported, releaseUrl, stop, webSpeak]
  );

  return { play, stop, isPlaying, isLoading, engine };
}
