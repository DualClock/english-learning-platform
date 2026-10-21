'use client';

import { MAX_FONT_SIZE, MAX_LINE_WIDTH, MIN_FONT_SIZE, MIN_LINE_WIDTH } from './types';

interface Props {
  open: boolean;
  onToggle: () => void;
  fontSize: number;
  lineWidth: number;
  onFontSizeChange: (delta: number) => void;
  onLineWidthChange: (value: number) => void;
  onReset: () => void;
}


/** Меню кегля и ширины строки — значения читалки, которые выбирает сам читатель. */
export default function TextSettingsMenu({
  open,
  onToggle,
  fontSize,
  lineWidth,
  onFontSizeChange,
  onLineWidthChange,
  onReset,
}: Props) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Настройки текста"
        aria-expanded={open}
        title="Настройки текста"
        className="h-10 w-10 rounded-full border border-[var(--color-hairline-strong)] bg-white text-sm font-semibold text-[var(--color-slate)] shadow-md transition-colors hover:bg-[var(--color-tint-mint)]"
      >
        Aa
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} aria-hidden="true" />
          <div className="card fixed left-4 right-4 top-24 z-50 p-4 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-ink)]">Текст</h2>
              <button
                type="button"
                onClick={onToggle}
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
                  onClick={() => onFontSizeChange(-1)}
                  disabled={fontSize <= MIN_FONT_SIZE}
                  aria-label="Уменьшить текст"
                  className="h-8 w-8 rounded-lg border border-[var(--color-hairline-strong)] bg-white text-sm font-semibold transition-colors hover:bg-[var(--color-tint-mint)] disabled:opacity-40"
                >
                  A−
                </button>
                <span className="w-8 text-center text-sm tabular-nums">{fontSize}</span>
                <button
                  type="button"
                  onClick={() => onFontSizeChange(1)}
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
                onChange={(e) => onLineWidthChange(Number(e.target.value))}
                className="w-full accent-[var(--color-primary)]"
              />
            </label>

            <button
              type="button"
              onClick={onReset}
              className="mt-3 text-xs text-[var(--color-slate)] underline decoration-[var(--color-hairline-strong)] underline-offset-2 transition-colors hover:text-[var(--color-ink)]"
            >
              Сбросить
            </button>
          </div>
        </>
      )}
    </div>
  );
}
