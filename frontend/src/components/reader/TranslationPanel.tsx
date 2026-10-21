'use client';

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
 * на десктопе — сворачиваемая колонка рядом с текстом.
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
  return (
    <>
      {/* Затемнение под bottom-sheet, только мобильные */}
      <div
        className={`fixed inset-0 z-40 bg-[rgba(11,37,69,0.35)] transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCollapse}
        aria-hidden="true"
      />

      <div
        data-translation-panel
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 md:static md:z-auto md:w-72 md:shrink-0 md:translate-y-0 ${
          open ? 'translate-y-0' : 'translate-y-full md:hidden'
        }`}
      >
        <div className="card max-h-[72vh] overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:sticky md:top-8 md:max-h-none md:rounded-b-lg md:p-5">
          {/* Ручка bottom-sheet и заголовок панели */}
          <div className="mb-3">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--color-hairline-strong)] md:hidden" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-slate)]">
                Перевод
              </span>
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Свернуть панель перевода"
                className="rounded p-1 text-lg leading-none text-[var(--color-slate)] transition-colors hover:text-[var(--color-ink)] md:text-base"
              >
                <span aria-hidden="true" className="md:hidden">×</span>
                <span aria-hidden="true" className="hidden md:inline">→</span>
              </button>
            </div>
          </div>

          {word ? (
            <>
              <div className="flex items-start justify-between mb-4 pb-3 border-b border-[var(--color-hairline-strong)]">
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold text-[var(--color-ink)] break-words">{word}</h2>
                  {translation?.partOfSpeech && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-[var(--color-tint-mint)] text-[var(--color-primary)] text-xs rounded-full">
                      {translation.partOfSpeech}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onSpeak(word)}
                  className="p-2 text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors shrink-0"
                  title="Произнести"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </button>
              </div>

              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" style={{ animationDelay: '200ms' }}></span>
                    <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" style={{ animationDelay: '400ms' }}></span>
                  </div>
                  {aiMode && (
                    <p className="text-sm text-[var(--color-slate)]">ИИ анализирует контекст…</p>
                  )}
                </div>
              ) : hasError ? (
                <div className="text-center py-6">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-[rgba(217,45,32,0.10)] flex items-center justify-center">
                    <svg className="w-5 h-5 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 21a9 9 0 100-18 9 9 000 18z" />
                    </svg>
                  </div>
                  <p className="text-sm text-[var(--color-error)] mb-4">Не удалось перевести.<br />Попробуйте ещё раз</p>
                  <button onClick={onRetry} className="btn-secondary text-sm py-2 px-4">
                    Повторить
                  </button>
                </div>
              ) : translation ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-xl text-[var(--color-primary)] font-medium min-h-[2rem]">
                      {displayed}
                      {isTyping && (
                        <span className="inline-block w-0.5 h-5 bg-[var(--color-primary)] ml-1 typing-cursor align-middle"></span>
                      )}
                    </p>
                    {!isTyping && translation.source && (
                      <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-[var(--color-slate)]">
                        {translation.source}
                      </span>
                    )}
                  </div>

                  {!isTyping && translation.alternatives && translation.alternatives.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-[var(--color-slate)] mb-2">Варианты</h3>
                      <div className="flex flex-wrap gap-2">
                        {translation.alternatives.map((alt, idx) => (
                          <span key={idx} className="px-2 py-1 bg-[var(--color-tint-mint)] text-[var(--color-ink)] text-xs rounded-lg">
                            {alt}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {!isTyping && translation.examples && translation.examples.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-[var(--color-slate)] mb-2">Примеры</h3>
                      <div className="space-y-2">
                        {translation.examples.slice(0, 2).map((ex, idx) => (
                          <div key={idx} className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-hairline-strong)]">
                            <button
                              onClick={() => onSpeak(ex.english)}
                              className="text-left w-full group"
                            >
                              <p className="text-sm text-[var(--color-ink)] group-hover:text-[var(--color-primary)] font-medium">
                                {ex.english}
                              </p>
                              <p className="text-xs text-[var(--color-slate)] mt-1">{ex.translation}</p>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={onAddToDictionary}
                    disabled={isTyping || addedToDictionary}
                    className={`w-full text-sm py-2 rounded-lg transition-colors ${
                      addedToDictionary
                        ? 'bg-[var(--color-tint-mint)] text-[var(--color-primary)] cursor-default'
                        : 'btn-primary'
                    }`}
                  >
                    {addedToDictionary ? '✓ Добавлено' : '+ В словарь'}
                  </button>

                  <button
                    onClick={onToggleKnown}
                    disabled={isTyping || knownBusy}
                    title="Слово не попадёт в «новые» при подсчёте сложности"
                    className={`w-full text-sm py-2 rounded-lg transition-colors disabled:opacity-60 ${
                      isKnown
                        ? 'bg-[rgba(26,156,60,0.10)] text-[var(--color-success)]'
                        : 'btn-secondary'
                    }`}
                  >
                    {isKnown ? '★ Знакомое слово' : '☆ Уже знаю'}
                  </button>

                  {notesAvailable && (
                    <button
                      onClick={() => onCollect(word)}
                      disabled={isTyping || isInNotes}
                      className={`w-full text-sm py-2 rounded-lg transition-colors ${
                        isInNotes
                          ? 'bg-[rgba(249,231,159,0.40)] text-[var(--color-ink)] cursor-default'
                          : 'btn-secondary'
                      }`}
                    >
                      {isInNotes ? '✓ В конспекте' : '✎ В конспект'}
                    </button>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-[var(--color-tint-mint)] flex items-center justify-center">
                <svg className="w-5 h-5 text-[var(--color-slate)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
              </div>
              <p className="text-sm text-[var(--color-slate)]">Нажми на слово<br />для перевода</p>
            </div>
          )}

          {/* Переключатель ИИ-перевода с контекстом */}
          <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-[var(--color-hairline-strong)] pt-3">
            <input
              type="checkbox"
              checked={aiMode}
              onChange={(e) => onToggleAiMode(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--color-ink)]">✨ ИИ-перевод с контекстом</span>
              <span className="block text-xs text-[var(--color-slate)]">Медленнее, но понимает смысл в контексте</span>
            </span>
          </label>
        </div>
      </div>
    </>
  );
}
