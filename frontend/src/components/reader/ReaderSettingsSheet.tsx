'use client';

import { AnimatePresence, motion } from 'motion/react';
import { CloseIcon } from '@/components/ui/icons';
import { variants } from '@/lib/motion';
import {
  DEFAULT_READER_SETTINGS,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MAX_MARGIN,
  MIN_FONT_SIZE,
  MIN_LINE_HEIGHT,
  MIN_MARGIN,
  READER_THEME_LABELS,
  type ReaderSettings,
  type ReaderTheme,
} from '@/lib/reader/types';

interface Props {
  open: boolean;
  settings: ReaderSettings;
  onChange: (next: ReaderSettings) => void;
  onClose: () => void;
}

const THEME_SWATCH: Record<ReaderTheme, string> = {
  day: '#fcfaf5',
  sepia: '#fbf7ed',
  night: '#121a24',
};

export default function ReaderSettingsSheet({ open, settings, onChange, onClose }: Props) {
  const set = (patch: Partial<ReaderSettings>) => onChange({ ...settings, ...patch });

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="settings-scrim"
            className="fixed inset-0 z-40 bg-scrim lg:bg-transparent"
            variants={variants.overlay}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.section
            key="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Настройки чтения"
            className="fixed inset-x-3 bottom-3 z-50 max-h-[85dvh] overflow-y-auto rounded-2xl border border-[var(--reader-hairline)] bg-[var(--reader-paper)] text-[var(--reader-ink)] shadow-modal md:inset-x-auto md:bottom-6 md:right-6 md:w-[390px]"
            variants={variants.sheet}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-heading text-body-sm font-semibold">Настройки чтения</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть настройки"
                  className="rounded p-1 text-[var(--reader-ink-soft)] hover:bg-[var(--reader-wash)] hover:text-[var(--reader-ink)]"
                >
                  <CloseIcon size={20} />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between text-caption text-[var(--reader-ink-soft)]">
                    <span>Тон бумаги</span>
                    <span>{READER_THEME_LABELS[settings.theme]}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(READER_THEME_LABELS) as ReaderTheme[]).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        onClick={() => set({ theme })}
                        aria-pressed={settings.theme === theme}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-body-sm transition-colors ${
                          settings.theme === theme
                            ? 'border-primary bg-[var(--reader-wash)]'
                            : 'border-[var(--reader-hairline)]'
                        }`}
                      >
                        <span
                          className="h-6 w-6 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: THEME_SWATCH[theme] }}
                        />
                        <span className="truncate">{READER_THEME_LABELS[theme]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-caption text-[var(--reader-ink-soft)]">
                    <span>Кегль</span>
                    <span className="tabular-nums">{settings.fontSize} px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="reader-icon-btn h-10 w-10 border border-[var(--reader-hairline)]"
                      onClick={() => set({ fontSize: Math.max(MIN_FONT_SIZE, settings.fontSize - 1) })}
                      aria-label="Уменьшить кегль"
                    >
                      A−
                    </button>
                    <input
                      type="range"
                      min={MIN_FONT_SIZE}
                      max={MAX_FONT_SIZE}
                      step={1}
                      value={settings.fontSize}
                      onChange={(event) => set({ fontSize: Number(event.target.value) })}
                      className="h-10 min-w-0 flex-1 accent-primary"
                      aria-label="Размер шрифта"
                    />
                    <button
                      type="button"
                      className="reader-icon-btn h-10 w-10 border border-[var(--reader-hairline)]"
                      onClick={() => set({ fontSize: Math.min(MAX_FONT_SIZE, settings.fontSize + 1) })}
                      aria-label="Увеличить кегль"
                    >
                      A+
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-caption text-[var(--reader-ink-soft)]">
                    <span>Интерлиньяж</span>
                    <span className="tabular-nums">{settings.lineHeight.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_LINE_HEIGHT}
                    max={MAX_LINE_HEIGHT}
                    step={0.05}
                    value={settings.lineHeight}
                    onChange={(event) => set({ lineHeight: Number(event.target.value) })}
                    className="h-10 w-full accent-primary"
                    aria-label="Межстрочный интервал"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-caption text-[var(--reader-ink-soft)]">
                    <span>Поля страницы</span>
                    <span className="tabular-nums">{settings.margin}%</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_MARGIN}
                    max={MAX_MARGIN}
                    step={1}
                    value={settings.margin}
                    onChange={(event) => set({ margin: Number(event.target.value) })}
                    className="h-10 w-full accent-primary"
                    aria-label="Поля страницы"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onChange(DEFAULT_READER_SETTINGS)}
                  className="text-caption text-[var(--reader-ink-soft)] underline underline-offset-4"
                >
                  Вернуть вид по умолчанию
                </button>
              </div>
            </div>
          </motion.section>
        </>
      ) : null}
    </AnimatePresence>
  );
}
