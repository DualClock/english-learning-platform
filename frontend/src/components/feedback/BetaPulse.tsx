'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '@/app/lib/api-url';
import { track } from '@/app/lib/analytics';
import { FEEDBACK_CHECKPOINTS } from '@/lib/beta';
import { CloseIcon } from '@/components/ui/icons';
import { openFeedback } from './events';
import {
  EMPTY_PULSE_STATE,
  PULSE_EVENTS,
  buildPulseBlock,
  parsePulseState,
  pulseEventsOnAnswer,
  pulseMeta,
  pulseShowsOnPage,
  pulseStorageKey,
  serializePulseState,
  shouldShowPulse,
} from '@/lib/pulse';
import type { PulseAnswer, PulseState } from '@/lib/pulse';

interface Props {
  userId: string | null;
  accessToken: string | null;
  /** Номер открытой страницы: блок живёт только на той, где появился. */
  page: number;
}

/**
 * Один inline-вопрос в читалке (W4.1 Feedback Pulse).
 *
 * Это не попап и не модалка: блок стоит в колонке под текстом открытой
 * страницы, не перекрывает её, не затемняет, не блокирует перелистывание и
 * уходит сам, как только человек перевернул страницу. Появляется один раз:
 * сервер держит семисуточную паузу на аккаунт (см.
 * AnalyticsController.GetPulseEligibility), а правило «не повторять в этом
 * браузере» живёт в lib/pulse.ts.
 *
 * Никаких анимаций появления: контент, стартующий с opacity 0, без JS не
 * читается, и индексацию мы на этом уже ломали.
 */
export default function BetaPulse({ userId, accessToken, page }: Props) {
  // Копия вопроса живёт в beta.ts вместе с остальными обещаниями когорты:
  // сдвиг текста на /beta автоматически меняет и этот блок, а разъезд текста
  // с кнопками перехватывает buildPulseBlock (он вернёт null).
  const block = buildPulseBlock(FEEDBACK_CHECKPOINTS);
  const [state, setState] = useState<PulseState>(EMPTY_PULSE_STATE);
  const [serverEligible, setServerEligible] = useState<boolean | null>(null);
  const [openedPage, setOpenedPage] = useState<number | null>(null);

  const askedRef = useRef(false);
  const openedRef = useRef(false);

  const storageKey = userId ? pulseStorageKey(userId) : null;

  // 1. Состояние этого аккаунта в этом браузере.
  useEffect(() => {
    if (!storageKey) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      // localStorage недоступен — остаётся решение сервера, оно и есть главное
    }
    setState(parsePulseState(stored));
  }, [storageKey]);

  // 2. Спросить сервер, можно ли показывать. Один запрос на монтирование:
  // без него блок показался бы на каждом из трёх устройств читателя.
  useEffect(() => {
    if (!userId || !accessToken || askedRef.current) return;
    askedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/analytics/pulse/eligible`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) return;
        const data = (await response.json()) as { eligible?: boolean };
        if (!cancelled) setServerEligible(data.eligible === true);
      } catch {
        // Нет связи — нет и блока: читателю не должно быть видно, что где-то
        // не ответила аналитика.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, accessToken]);

  const remember = useCallback(
    (next: PulseState) => {
      setState(next);
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, serializePulseState(next));
      } catch {
        // Флаг не переживёт перезагрузку, но серверное правило останется —
        // именно оно держит частоту между устройствами.
      }
    },
    [storageKey]
  );

  // 3. Открыть блок и засчитать показ. Ровно один раз на монтирование: `seen` —
  // знаменатель конверсии, и перемонтирование читалки не должно превращать
  // одного читателя в двух молчунов.
  useEffect(() => {
    if (openedRef.current) return;
    if (!shouldShowPulse({ userId, accessToken, serverEligible, state })) return;

    openedRef.current = true;
    setOpenedPage(page);
    void track(PULSE_EVENTS.seen, pulseMeta(PULSE_EVENTS.seen), accessToken);
    remember({ ...state, seen: true });
  }, [userId, accessToken, serverEligible, state, remember, page]);

  const answer = useCallback(
    (option: PulseAnswer) => {
      if (state.answered !== option) {
        const event = pulseEventsOnAnswer(option);
        void track(event.event, event.meta, accessToken);
      }
      remember({ ...state, seen: true, answered: option });
    },
    [accessToken, remember, state]
  );

  const dismiss = useCallback(() => {
    void track(PULSE_EVENTS.dismissed, pulseMeta(PULSE_EVENTS.dismissed), accessToken);
    remember({ ...state, seen: true, dismissed: true });
    setOpenedPage(null);
  }, [accessToken, remember, state]);

  if (!block || !pulseShowsOnPage(openedPage, page)) return null;

  const answered = state.answered !== null;

  return (
    <aside
      aria-labelledby="beta-pulse-question"
      className="card w-full max-w-measure p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <h2 id="beta-pulse-question" className="min-w-0 flex-1 text-h3 text-ink">
          {block.question}
        </h2>
        {!answered && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Закрыть короткий вопрос"
            className="-mr-1 -mt-1 shrink-0 rounded p-1.5 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
        )}
      </div>

      {answered ? (
        <p className="mt-3 text-body-sm text-slate">
          Записал. Это одна кнопка, а не отзыв: если есть что сказать подробнее —
          напишите, я читаю все сообщения сам.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={block.question}>
          {block.options.map((option) => (
            <button
              key={option.answer}
              type="button"
              onClick={() => answer(option.answer)}
              className="inline-flex items-center rounded-md border border-hairline px-4 py-2 text-body-sm font-medium text-slate transition-colors duration-fast ease-soft hover:border-hairline-strong hover:bg-surface hover:text-ink"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => openFeedback()}
          className="text-body-sm font-medium text-link underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
        >
          Написать подробнее
        </button>
      </div>
    </aside>
  );
}
