'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { variants } from '@/lib/motion';
import { CheckIcon, CloseIcon, PlusIcon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/LoadingState';
import { Tag } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import type { TooltipState, WordToken } from './types';

interface Props {
  tokens: WordToken[];
  keyWords: Set<string>;
  selectedWordIndex: number | null;
  tooltip: TooltipState | null;
  readingSessionId: string | null;
  isCollected: (word: string) => boolean;
  onWordClick: (index: number) => void;
  onMarkerEnter: (index: number, word: string) => void;
  onMarkerLeave: () => void;
  onMarkerFocus: (index: number, word: string) => void;
  onMarkerClick: (index: number, word: string, token: WordToken) => void;
  onMarkerKeyDown: (
    event: ReactKeyboardEvent<HTMLSpanElement>,
    word: string,
    token: WordToken
  ) => void;
  onCloseTooltip: () => void;
  onCollect: (word: string, token?: WordToken) => void;
}

function Tooltip({
  tooltip,
  readingSessionId,
  isCollected,
  onClose,
  onCollect,
}: {
  tooltip: NonNullable<Props['tooltip']>;
  readingSessionId: string | null;
  isCollected: (word: string) => boolean;
  onClose: () => void;
  onCollect: (word: string) => void;
}) {
  const t = tooltip.data;
  const translationText = t ? t.translationRu ?? t.translation : null;
  const collected = isCollected(tooltip.word.toLowerCase());

  return (
    <motion.div
      data-word-tooltip
      // На телефоне карточка прижата к низу экрана — так она не уезжает за край
      className={`fixed inset-x-4 bottom-4 z-[60] rounded-xl border border-hairline bg-canvas p-3 shadow-modal
                  md:absolute md:inset-x-auto md:left-0 md:w-60 ${
                    tooltip.below ? 'md:top-full md:mt-2 md:bottom-auto' : 'md:bottom-full md:mb-2 md:top-auto'
                  }`}
      variants={variants.overlay}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 break-words text-body-sm font-semibold text-ink">
            {t?.word ?? tooltip.word}
          </span>
          {t?.cefrLevel && <Tag tone="success">{t.cefrLevel}</Tag>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть подсказку"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      {tooltip.loading || !t ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : (
        <>
          {translationText ? (
            <p className="mt-2 text-body-sm text-ink">{translationText}</p>
          ) : (
            <p className="mt-2 text-body-sm italic text-slate">перевод появится позже</p>
          )}
          {readingSessionId && (
            <Button
              variant={collected ? 'secondary' : 'primary'}
              onClick={() => onCollect(tooltip.word)}
              className="mt-3 w-full"
            >
              {collected ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
              {collected ? 'В конспекте' : 'В конспект'}
            </Button>
          )}
        </>
      )}
    </motion.div>
  );
}

/**
 * Размеченный текст страницы: обычные слова кликабельны для перевода,
 * слова-маркеры дополнительно собираются в конспект.
 */
export default function ReaderText({
  tokens,
  keyWords,
  selectedWordIndex,
  tooltip,
  readingSessionId,
  isCollected,
  onWordClick,
  onMarkerEnter,
  onMarkerLeave,
  onMarkerFocus,
  onMarkerClick,
  onMarkerKeyDown,
  onCloseTooltip,
  onCollect,
}: Props) {
  if (!tokens.length) return null;

  return (
    <div>
      {tokens.map((token, idx) => {
        const cleanWord = token.word.replace(/[^a-zA-Z']/g, '');
        const lower = cleanWord.toLowerCase();
        const isClickable = cleanWord.length >= 2;
        const isSelected = idx === selectedWordIndex;
        const isMarker = isClickable && keyWords.has(lower);
        const collected = isCollected(lower);

        if (isMarker) {
          return (
            <span
              key={idx}
              data-marker-word
              className="relative inline-block mr-1"
              onMouseEnter={() => onMarkerEnter(idx, lower)}
              onMouseLeave={onMarkerLeave}
              onBlur={(e) => {
                // Фокус ушёл за пределы слова и карточки — закрываем подсказку
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  onCloseTooltip();
                }
              }}
            >
              <span
                role="button"
                tabIndex={0}
                aria-label={`${lower}: перевод и добавление в конспект`}
                aria-expanded={tooltip?.idx === idx}
                onClick={() => onMarkerClick(idx, lower, token)}
                onKeyDown={(e) => onMarkerKeyDown(e, lower, token)}
                onFocus={() => onMarkerFocus(idx, lower)}
                className={`reader-marker${collected ? ' reader-marker-collected' : ''}`}
              >
                {token.word}
              </span>
              <AnimatePresence>
                {tooltip?.idx === idx && (
                  <Tooltip
                    tooltip={tooltip}
                    readingSessionId={readingSessionId}
                    isCollected={isCollected}
                    onClose={onCloseTooltip}
                    onCollect={(word) => onCollect(word, token)}
                  />
                )}
              </AnimatePresence>
            </span>
          );
        }

        return (
          <span
            key={idx}
            onClick={() => isClickable && onWordClick(idx)}
            className={
              isSelected
                ? 'reader-word reader-word-selected'
                : isClickable
                  ? 'reader-word'
                  : 'reader-plain'
            }
          >
            {token.word}
          </span>
        );
      })}
    </div>
  );
}
