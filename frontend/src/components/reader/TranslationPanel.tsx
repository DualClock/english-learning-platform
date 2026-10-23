'use client';

import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  VolumeIcon,
} from '@/components/ui/icons';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import type { TranslationResult } from './types';

interface Props {
  open: boolean;
  word: string;
  translation: TranslationResult | null;
  displayed: string;
  isTyping: boolean;
  isLoading: boolean;
  hasError: boolean;
  aiMode: boolean;
  addedToDictionary: boolean;
  isKnown: boolean;
  knownBusy: boolean;
  isInNotes: boolean;
  notesAvailable: boolean;
  onCollapse: () => void;
  onRetry: () => void;
  onSpeak: (text: string) => void;
  onAddToDictionary: () => void;
  onToggleKnown: () => void;
  onToggleAiMode: (next: boolean) => void;
  onCollect: (word: string) => void;
}

/**
 * Панель перевода слова. На телефоне — bottom-sheet с затемнением под ним,
 * на десктопе — сворачиваемая колонка. Съезд листа задаёт CSS: у колонки
 * на десктопе трансформации нет, и Motion conflictsовал бы с этим.
 */
export default function TranslationPanel({
  open,
  word,
  translation,
  displayed,
  isTyping,
  isLoading,
  hasError,
  aiMode,
  addedToDictionary,
  isKnown,
  knownBusy,
  isInNotes,
  notesAvailable,
  onCollapse,
  onRetry,
  onSpeak,
  onAddToDictionary,
  onToggleKnown,
  onToggleAiMode,
  onCollect,
}: Props) {
  // На телефоне лист поднимается только когда есть что показывать: иначе пустая
  // панель закрывала бы текст сразу после открытия книги.
  const sheetUp = open && Boolean(word);
  // Служебные коды источников (LEVEL_MAP, level_map и подобные) читателю ничего не говорят.
  const sourceValue = translation?.source?.trim() ?? '';
  const sourceLabel =
    sourceValue &&
    !/^[A-Z0-9_]+$/.test(sourceValue) &&
    !/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(sourceValue)
      ? sourceValue
      : null;

  return (
    <>
      {/* Затемнение под bottom-sheet, только до планшета */}
      <div
        className={`fixed inset-0 z-40 bg-scrim transition-opacity duration-base ease-soft lg:hidden ${
          sheetUp ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCollapse}
        aria-hidden="true"
      />

      <div
        data-translation-panel
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-base ease-soft
                    lg:static lg:z-auto lg:flex lg:h-full lg:w-[340px] lg:shrink-0 lg:translate-y-0
                    ${sheetUp ? 'translate-y-0' : 'translate-y-full'} ${open ? '' : 'lg:hidden'}`}
      >
        <div className="reader-paper reader-scroll flex max-h-[78dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-[var(--reader-hairline)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-modal lg:h-full lg:max-h-none lg:w-full lg:rounded-none lg:border-l lg:border-t-0 lg:px-6 lg:py-5 lg:shadow-none">
          {/* Ручка bottom-sheet и заголовок панели */}
          <div className="mb-4">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--reader-hairline)] lg:hidden" />
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold uppercase tracking-[0.16em] text-[var(--reader-ink-soft)]">
                Перевод
              </span>
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Свернуть панель перевода"
                className="rounded p-1 text-[var(--reader-ink-soft)] transition-colors duration-fast ease-soft hover:bg-[var(--reader-wash)] hover:text-[var(--reader-ink)]"
              >
                <span className="lg:hidden"><CloseIcon size={20} /></span>
                <span className="hidden lg:inline"><ChevronRightIcon size={20} /></span>
              </button>
            </div>
          </div>

          {word ? (
            <>
              <div className="mb-6 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="break-words font-reading text-[2rem] leading-tight text-[var(--reader-ink)]">{word}</h2>
                  {translation?.partOfSpeech && (
                    <span className="mt-2 inline-block text-caption uppercase tracking-[0.12em] text-[var(--reader-ink-soft)]">
                      {translation.partOfSpeech}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onSpeak(word)}
                  aria-label="Произнести слово"
                  title="Произнести"
                  className="shrink-0 rounded p-2 text-[var(--reader-ink-soft)] transition-colors duration-fast ease-soft hover:bg-[var(--reader-wash)] hover:text-primary"
                >
                  <VolumeIcon size={20} />
                </button>
              </div>

              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div
                    key="loading"
                    variants={variants.overlay}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="flex flex-col items-center justify-center gap-3 py-8"
                  >
                    <div className="flex items-center gap-1.5" role="status" aria-live="polite">
                      <span className="typing-dot h-2 w-2 rounded-full bg-primary" />
                      <span className="typing-dot h-2 w-2 rounded-full bg-primary" />
                      <span className="typing-dot h-2 w-2 rounded-full bg-primary" />
                      <span className="sr-only">Переводим слово</span>
                    </div>
                    {aiMode && <p className="text-body-sm text-[var(--reader-ink-soft)]">ИИ анализирует контекст…</p>}
                  </motion.div>
                ) : hasError ? (
                  <motion.div key="error" variants={variants.overlay} initial="hidden" animate="visible" exit="exit">
                    <ErrorState
                      title="Не удалось перевести"
                      description="Сервер не ответил. Попробуйте ещё раз — слово осталось выбранным."
                      onRetry={onRetry}
                    />
                  </motion.div>
                ) : translation ? (
                  <motion.div
                    key={word}
                    variants={variants.overlay}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="space-y-4"
                  >
                    <div>
                      <p className="min-h-8 font-reading text-[1.25rem] font-medium leading-snug text-primary">
                        {displayed}
                        {isTyping && (
                          <span className="typing-cursor ml-1 inline-block h-5 w-0.5 bg-primary align-middle" />
                        )}
                      </p>
                      {!isTyping && sourceLabel && (
                        <span className="mt-2 inline-block text-caption uppercase tracking-[0.12em] text-[var(--reader-ink-soft)]">
                          {sourceLabel}
                        </span>
                      )}
                    </div>

                    {!isTyping && translation.alternatives && translation.alternatives.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-caption font-semibold text-[var(--reader-ink-soft)]">Варианты</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {translation.alternatives.map((alt, idx) => (
                            <span
                              key={`${alt}-${idx}`}
                              className="rounded-full border border-[var(--reader-hairline)] px-2.5 py-1 text-caption text-[var(--reader-ink)]"
                            >
                              {alt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isTyping && translation.examples && translation.examples.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-caption font-semibold text-[var(--reader-ink-soft)]">Примеры</h3>
                        <ul className="space-y-2">
                          {translation.examples.slice(0, 2).map((ex, idx) => (
                            <li
                              key={`${ex.english}-${idx}`}
                              className="rounded-md border border-[var(--reader-hairline)] bg-[var(--reader-paper-deep)] p-3"
                            >
                              <button
                                type="button"
                                onClick={() => onSpeak(ex.english)}
                                className="group w-full text-left"
                              >
                                <span className="block font-reading text-body-sm leading-relaxed text-[var(--reader-ink)] transition-colors duration-fast ease-soft group-hover:text-primary">
                                  {ex.english}
                                </span>
                                <span className="mt-1 block text-caption text-[var(--reader-ink-soft)]">{ex.translation}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Button
                        variant={addedToDictionary ? 'secondary' : 'primary'}
                        onClick={onAddToDictionary}
                        disabled={isTyping || addedToDictionary}
                        className="w-full"
                      >
                        {addedToDictionary ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
                        {addedToDictionary ? 'Добавлено в словарь' : 'В словарь'}
                      </Button>

                      <Button
                        variant={isKnown ? 'secondary' : 'ghost'}
                        onClick={onToggleKnown}
                        disabled={isTyping || knownBusy}
                        title="Слово не попадёт в «новые» при подсчёте сложности"
                        className="w-full border border-[var(--reader-hairline)]"
                      >
                        <StarIcon size={16} />
                        {isKnown ? 'Знакомое слово' : 'Уже знаю'}
                      </Button>

                      {notesAvailable && (
                        <Button
                          variant="ghost"
                          onClick={() => onCollect(word)}
                          disabled={isTyping || isInNotes}
                          className={`w-full border border-[var(--reader-hairline)] ${
                            isInNotes ? 'bg-[var(--reader-mark)] text-[var(--reader-ink)]' : ''
                          }`}
                        >
                          {isInNotes ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
                          {isInNotes ? 'В конспекте' : 'В конспект'}
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>
          ) : (
            <div className="py-10 text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--reader-hairline)] text-[var(--reader-ink-soft)]">
                <VolumeIcon size={20} />
              </div>
              <p className="mx-auto max-w-[22ch] font-reading text-body-sm leading-relaxed text-[var(--reader-ink-soft)]">
                Нажмите на слово в тексте — перевод появится здесь
              </p>
            </div>
          )}

          {/* Переключатель ИИ-перевода с контекстом: отделён тоном, а не линией */}
          <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--reader-hairline)] p-3">
            <input
              type="checkbox"
              checked={aiMode}
              onChange={(e) => onToggleAiMode(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-body-sm font-medium text-[var(--reader-ink)]">
                <SparklesIcon size={16} />
                ИИ-перевод с контекстом
              </span>
              <span className="block text-caption leading-snug text-[var(--reader-ink-soft)]">
                Медленнее, но понимает смысл в контексте
              </span>
            </span>
          </label>
        </div>
      </div>
    </>
  );
}
