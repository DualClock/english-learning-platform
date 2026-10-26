'use client';

import { useState, useCallback } from 'react';

/**
 * Скорости, доступные в интерфейсе чтения.
 *
 * 0.75 — разбор незнакомой фразы, 1.0 — обычное чтение, 1.25 — беглое.
 * Список живёт здесь, а не в компоненте: браузерный голос и серверный плеер
 * обязаны предлагать одно и то же, иначе переключение с сервера на браузер
 * заставляет человека заново искать скорость.
 */
export const SPEECH_RATES = [0.75, 1.0, 1.25] as const;

export type SpeechRate = (typeof SPEECH_RATES)[number];

/**
 * Приводит произвольное число к одной из поддерживаемых скоростей.
 *
 * Web Speech API принимает 0.1–10, но браузеры читают это поле по-разному:
 * Chrome округляет до ближайшего «шага» голоса, Safari уважает только 0.5/1/2
 * в некоторых версиях. Поэтому наружу отдаём ровно три наши скорости.
 */
export function normalizeSpeechRate(rate: number | undefined | null): SpeechRate {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return 1.0;
  }

  let closest: SpeechRate = SPEECH_RATES[0];
  let bestDelta = Math.abs(rate - closest);

  for (const candidate of SPEECH_RATES) {
    const delta = Math.abs(rate - candidate);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = candidate;
    }
  }

  return closest;
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  /**
   * Озвучивает текст браузерным голосом.
   *
   * `rate` — скорость из интерфейса. Раньше она была прибита к 0.9, и кнопки
   * 0.75x/1.25x в читалке меняли цифру на экране, ничего не меняя в звуке.
   * Браузерный голос — запасной путь для длинных абзацев и недоступного
   * сервера, то есть ровно тот случай, когда скорость важнее всего.
   */
  const speak = useCallback(
    (text: string, lang: 'en-US' | 'ru-RU' = 'en-US', rate: number = 1.0) => {
      if (!isSupported) {
        console.warn('Web Speech API not supported');
        return;
      }

      // Останавливаем предыдущую озвучку
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = normalizeSpeechRate(rate);
      utterance.pitch = 1;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [isSupported]
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking, isSupported };
}