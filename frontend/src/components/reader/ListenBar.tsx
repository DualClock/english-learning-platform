'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  HeadphonesIcon,
  PauseIcon,
  PlayIcon,
} from '@/components/ui/icons';
import { variants } from '@/lib/motion';
import type { ListeningProvider, ListeningStatus } from '@/hooks/reader/useListening';

interface Props {
  open: boolean;
  status: ListeningStatus;
  provider: ListeningProvider;
  index: number;
  total: number;
  error: string | null;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

/**
 * Полоса озвучки. Живёт поверх страницы, а не в колонке текста: иначе
 * появление полосы меняло бы ширину вьюпорта и перевёрстывало страницу
 * под пальцем.
 */
export default function ListenBar({
  open,
  status,
  provider,
  index,
  total,
  error,
  onToggle,
  onPrevious,
  onNext,
  onClose,
}: Props) {
  const playing = status === 'playing';
  const loading = status === 'loading';
  const position = total > 0 ? Math.min(total, index + 1) : 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="listen-bar"
          role="region"
          aria-label="Озвучка главы"
          className="pointer-events-auto absolute inset-x-0 bottom-[calc(2.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[min(92%,560px)] items-center gap-1.5 rounded-xl border border-[var(--reader-hairline)] bg-[var(--reader-paper)] px-2 py-1.5 shadow-card"
          variants={variants.sheet}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--reader-ink-soft)]" aria-hidden="true">
            <HeadphonesIcon size={16} />
          </span>

          <button
            type="button"
            onClick={onPrevious}
            disabled={index <= 0}
            aria-label="Предыдущее предложение"
            className="reader-icon-btn h-9 w-9 disabled:opacity-40"
          >
            <ArrowLeftIcon size={16} />
          </button>

          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? 'Пауза' : 'Слушать'}
            className="reader-icon-btn h-10 w-10 shrink-0"
            data-active={playing ? 'true' : undefined}
          >
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={index >= total - 1}
            aria-label="Следующее предложение"
            className="reader-icon-btn h-9 w-9 disabled:opacity-40"
          >
            <ArrowRightIcon size={16} />
          </button>

          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-caption text-[var(--reader-ink)]" aria-live="polite">
              {loading
                ? 'Готовлю голос…'
                : provider === 'browser'
                  ? 'Читает голос браузера'
                  : 'AriaNeural'}
            </p>
            <p className="text-[0.7rem] tabular-nums text-[var(--reader-ink-soft)]">
              {error ? error : `Предложение ${position} из ${total}`}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Остановить озвучку"
            className="reader-icon-btn h-9 w-9"
          >
            <CloseIcon size={16} />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
