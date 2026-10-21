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
import { Tag } from '@/components/ui/Badge';
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

  return (
    <>
      {/* Затемнение под bottom-sheet, только мобильные */}
      <div
        className={`fixed inset-0 z-40 bg-scrim transition-opacity duration-base ease-soft md:hidden ${
          sheetUp ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCollapse}
        aria-hidden="true"
      />

      <div
        data-translation-panel
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-base ease-soft
                    md:static md:z-auto md:w-72 md:shrink-0 md:translate-y-0
                    ${sheetUp ? 'translate-y-0' : 'translate-y-full'} ${open ? '' : 'md:hidden'}`}
      >
        <div className="card max-h-[72vh] overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-card md:sticky md:top-8 md:max-h-none md:rounded-b-lg md:p-5 md:shadow-none">
          {/* Ручка bottom-sheet и заголовок панели */}
          <div className="mb-3">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-hairline-strong md:hidden" />
            <div className="flex items-center justify-between">
              <span className="text-caption font-medium uppercase tracking-wide text-slate">Перевод</span>
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Свернуть панель перевода"
                className="rounded p-1 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
              >
                <span className="md:hidden"><CloseIcon size={20} /></span>
                <span className="hidden md:inline"><ChevronRightIcon size={20} /></span>
              </button>
            </div>
          </div>

          {word ? (
            <>
              <div className="mb-5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="break-words text-h2 text-ink">{word}</h2>
                  {translation?.partOfSpeech && <Tag tone="accent" className="mt-1">{translation.partOfSpeech}</Tag>}
                </div>
                <button
                  type="button"
                  onClick={() => onSpeak(word)}
                  aria-label="Произнести слово"
                  title="Произнести"
                  className="shrink-0 rounded p-2 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-primary"
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
                    {aiMode && <p className="text-body-sm text-slate">ИИ анализирует контекст…</p>}
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
                      <p className="min-h-8 text-body-lg font-medium text-primary">
                        {displayed}
                        {isTyping && (
                          <span className="typing-cursor ml-1 inline-block h-5 w-0.5 bg-primary align-middle" />
                        )}
                      </p>
                      {!isTyping && translation.source && (
                        <span className="mt-1 inline-block text-caption uppercase tracking-wide text-slate">
                          {translation.source}
                        </span>
                      )}
                    </div>

                    {!isTyping && translation.alternatives && translation.alternatives.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-caption font-medium text-slate">Варианты</h3>
                        <div className="flex flex-wrap gap-2">
                          {translation.alternatives.map((alt, idx) => (
                            <Tag key={`${alt}-${idx}`} tone="success">
                              {alt}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isTyping && translation.examples && translation.examples.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-caption font-medium text-slate">Примеры</h3>
                        <ul className="space-y-2">
                          {translation.examples.slice(0, 2).map((ex, idx) => (
                            <li key={`${ex.english}-${idx}`} className="rounded-md border border-hairline bg-surface p-3">
                              <button
                                type="button"
                                onClick={() => onSpeak(ex.english)}
                                className="group w-full text-left"
                              >
                                <span className="block text-body-sm font-medium text-ink transition-colors duration-fast ease-soft group-hover:text-primary">
                                  {ex.english}
                                </span>
                                <span className="mt-1 block text-caption text-slate">{ex.translation}</span>
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
                        className="w-full border border-hairline-strong"
                      >
                        <StarIcon size={16} />
                        {isKnown ? 'Знакомое слово' : 'Уже знаю'}
                      </Button>

                      {notesAvailable && (
                        <Button
                          variant="ghost"
                          onClick={() => onCollect(word)}
                          disabled={isTyping || isInNotes}
                          className={`w-full border border-hairline-strong ${
                            isInNotes ? 'bg-surface-warning text-ink' : ''
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
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-surface-accent text-on-accent">
                <VolumeIcon size={20} />
              </div>
              <p className="text-body-sm text-slate">
                Нажми на слово в тексте — перевод появится здесь
              </p>
            </div>
          )}

          {/* Переключатель ИИ-перевода с контекстом: отделён тоном, а не линией */}
          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md bg-surface p-3">
            <input
              type="checkbox"
              checked={aiMode}
              onChange={(e) => onToggleAiMode(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-body-sm font-medium text-ink">
                <SparklesIcon size={16} />
                ИИ-перевод с контекстом
              </span>
              <span className="block text-caption text-slate">Медленнее, но понимает смысл в контексте</span>
            </span>
          </label>
        </div>
      </div>
    </>
  );
}
