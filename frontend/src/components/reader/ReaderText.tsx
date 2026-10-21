'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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
          onClick={onClose}
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
              onClick={() => onCollect(tooltip.word)}
              className={`mt-2 w-full rounded-lg py-1.5 text-xs font-medium transition-colors ${
                collected
                  ? 'bg-[rgba(249,231,159,0.60)] text-[var(--color-ink)]'
                  : 'bg-[var(--color-tint-mint)] text-[var(--color-primary)]'
              }`}
            >
              {collected ? '✓ В конспекте' : '+ В конспект'}
            </button>
          )}
        </>
      )}
    </div>
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
                className={`inline-block rounded px-0.5 border-b border-dashed border-[var(--color-primary-pressed)] cursor-pointer transition-colors hover:bg-[rgba(249,231,159,0.20)] ${
                  collected ? 'bg-[rgba(249,231,159,0.60)] text-[var(--color-ink)]' : ''
                }`}
              >
                {token.word}
                <span className="text-[var(--color-primary-pressed)] text-xs ml-0.5 select-none">
                  {collected ? '✓' : '✦'}
                </span>
              </span>
              {tooltip?.idx === idx && (
                <Tooltip
                  tooltip={tooltip}
                  readingSessionId={readingSessionId}
                  isCollected={isCollected}
                  onClose={onCloseTooltip}
                  onCollect={(word) => onCollect(word, token)}
                />
              )}
            </span>
          );
        }

        return (
          <span
            key={idx}
            onClick={() => isClickable && onWordClick(idx)}
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
}
