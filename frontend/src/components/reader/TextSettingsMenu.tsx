'use client';

import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { CloseIcon } from '@/components/ui/icons';
import Button from '@/components/ui/Button';
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
        className="icon-chip font-semibold"
      >
        Aa
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={onToggle} aria-hidden="true" />
            <motion.div
              variants={variants.overlay}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="card fixed left-4 right-4 top-24 z-50 p-4 shadow-modal sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-body-sm font-semibold text-ink">Текст</h2>
                <button
                  type="button"
                  onClick={onToggle}
                  aria-label="Закрыть настройки текста"
                  className="rounded p-1 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
                >
                  <CloseIcon size={16} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-slate">Размер</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onFontSizeChange(-1)}
                    disabled={fontSize <= MIN_FONT_SIZE}
                    aria-label="Уменьшить текст"
                    className="icon-chip h-9 w-9 font-semibold"
                  >
                    A−
                  </button>
                  <span className="w-8 text-center text-body-sm tabular-nums text-ink">{fontSize}</span>
                  <button
                    type="button"
                    onClick={() => onFontSizeChange(1)}
                    disabled={fontSize >= MAX_FONT_SIZE}
                    aria-label="Увеличить текст"
                    className="icon-chip h-9 w-9 font-semibold"
                  >
                    A+
                  </button>
                </div>
              </div>

              <label className="mt-4 block">
                <span className="mb-1 flex items-center justify-between text-body-sm text-slate">
                  <span>Ширина строки</span>
                  <span className="tabular-nums text-ink">{lineWidth}</span>
                </span>
                <input
                  type="range"
                  min={MIN_LINE_WIDTH}
                  max={MAX_LINE_WIDTH}
                  value={lineWidth}
                  onChange={(e) => onLineWidthChange(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </label>

              <Button variant="ghost" onClick={onReset} className="mt-3 text-caption">
                Сбросить
              </Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
