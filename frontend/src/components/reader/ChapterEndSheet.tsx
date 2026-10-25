'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { ArrowRightIcon, CheckIcon, CloseIcon, PlusIcon } from '@/components/ui/icons';
import Button from '@/components/ui/Button';
import BetaPulse from '@/components/feedback/BetaPulse';
import { variants } from '@/lib/motion';
import type { ReaderPocketItem } from '@/lib/reader/types';

interface Props {
  open: boolean;
  items: ReaderPocketItem[];
  loading: boolean;
  error: string;
  pocketCount: number;
  hasNextChapter: boolean;
  isLastChapter: boolean;
  finished: boolean;
  finishing: boolean;
  userId: string | null;
  accessToken?: string;
  page: number;
  onClose: () => void;
  onPromote: (pocketId: number) => void;
  onKnown: (pocketId: number) => void;
  onNextChapter: () => void;
  onFinish: () => void;
}

/**
 * Cloze без экзамена: слово закрыто, пока читатель сам не откроет его.
 * Это возвращает фразу в память, но не превращает разбор в тест — оценки
 * здесь нет и быть не должно.
 */
function ClozeSentence({ text, word }: { text: string; word: string }) {
  const [revealed, setRevealed] = useState(false);
  if (!text) return null;

  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped, 'i').exec(text);
  if (!match) {
    return <>{text}</>;
  }

  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);

  return (
    <>
      {before}
      {revealed ? (
        <mark className="rounded-[2px] bg-[var(--reader-mark-strong)] px-0.5 text-[var(--reader-ink)]">
          {match[0]}
        </mark>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          aria-label={`Показать слово ${word}`}
          className="mx-0.5 inline-block min-w-[3.5rem] border-b border-dotted border-[var(--reader-ink-soft)] align-baseline text-transparent hover:bg-[var(--reader-wash)] focus-visible:bg-[var(--reader-wash)]"
        >
          {match[0]}
        </button>
      )}
      {after}
    </>
  );
}

export default function ChapterEndSheet({
  open,
  items,
  loading,
  error,
  pocketCount,
  hasNextChapter,
  isLastChapter,
  finished,
  finishing,
  userId,
  accessToken,
  page,
  onClose,
  onPromote,
  onKnown,
  onNextChapter,
  onFinish,
}: Props) {
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [postponed, setPostponed] = useState<number[]>([]);

  const act = async (id: number, action: (id: number) => void) => {
    setWorkingId(id);
    await Promise.resolve(action(id));
    setWorkingId(null);
  };

  const visibleItems = items.filter((item) => !postponed.includes(item.id));

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="review-scrim"
            className="fixed inset-0 z-40 bg-scrim"
            variants={variants.overlay}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.section
            key="review-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Разбор главы"
            className="fixed inset-x-3 bottom-3 z-50 max-h-[86dvh] overflow-y-auto rounded-2xl border border-[var(--reader-hairline)] bg-[var(--reader-paper)] text-[var(--reader-ink)] shadow-modal
                       md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[560px] md:-translate-x-1/2"
            variants={variants.sheet}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-caption font-semibold uppercase tracking-[0.16em] text-[var(--reader-ink-soft)]">
                    Глава прочитана
                  </p>
                  <h2 className="mt-2 font-heading text-h2 text-[var(--reader-ink)]">Слова, которые встретились</h2>
                  <p className="mt-1.5 text-body-sm leading-relaxed text-[var(--reader-ink-soft)]">
                    {loading
                      ? 'Собираем карман главы…'
                      : visibleItems.length > 0
                        ? 'Короткий разбор по реальным фразам. Учить — значит добавить в повторение; знать — убрать из будущих вопросов.'
                        : 'В кармане нет новых слов этой главы. Можно читать дальше.'}
                    {pocketCount > 0 ? ` В кармане книги: ${pocketCount}.` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть разбор"
                  className="rounded p-1 text-[var(--reader-ink-soft)] hover:bg-[var(--reader-wash)] hover:text-[var(--reader-ink)]"
                >
                  <CloseIcon size={20} />
                </button>
              </div>

              {error ? (
                <p className="mt-4 rounded-md border border-[var(--color-surface-danger)] bg-[var(--color-surface-danger)] p-3 text-body-sm">
                  {error}
                </p>
              ) : null}

              {loading ? (
                <div className="mt-5 space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="h-24 animate-pulse rounded-lg bg-[var(--reader-wash)]" />
                  ))}
                </div>
              ) : visibleItems.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {visibleItems.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-lg border border-[var(--reader-hairline)] bg-[var(--reader-paper-deep)] p-4"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-reading text-[1.35rem] font-semibold">{item.word}</h3>
                        <span className="text-body-sm text-[var(--reader-ink-soft)]">
                          {item.translationRu || 'перевод не сохранён'}
                        </span>
                      </div>
                      {item.sentenceText ? (
                        <p className="mt-2 font-reading text-body-sm leading-relaxed text-[var(--reader-ink)]">
                          <ClozeSentence text={item.sentenceText} word={item.word} />
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          onClick={() => void act(item.id, onPromote)}
                          disabled={workingId === item.id}
                          className="min-h-10"
                        >
                          <PlusIcon size={16} /> Учить
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void act(item.id, onKnown)}
                          disabled={workingId === item.id}
                          className="min-h-10"
                        >
                          <CheckIcon size={16} /> Знаю
                        </Button>
                        <button
                          type="button"
                          onClick={() => setPostponed((current) => [...current, item.id])}
                          className="min-h-10 px-2 text-body-sm text-[var(--reader-ink-soft)] underline underline-offset-4"
                        >
                          Позже
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              {open ? (
                <div
                  className="mt-6 border-t border-[var(--reader-hairline)] pt-5
                             [--color-canvas:var(--reader-paper-deep)]
                             [--color-surface:var(--reader-paper-deep)]
                             [--color-surface-soft:var(--reader-paper)]
                             [--color-ink:var(--reader-ink)]
                             [--color-slate:var(--reader-ink-soft)]
                             [--color-hairline:var(--reader-hairline)]
                             [--color-hairline-strong:var(--reader-ink-soft)]
                             [--color-link:var(--reader-ink)]"
                >
                  <BetaPulse userId={userId} accessToken={accessToken ?? null} page={page} />
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-body-sm text-[var(--reader-ink-soft)] underline underline-offset-4"
                >
                  Вернуться к тексту
                </button>
                {hasNextChapter ? (
                  <Button variant="primary" onClick={onNextChapter} className="min-h-10">
                    Следующая глава
                    <ArrowRightIcon size={16} />
                  </Button>
                ) : finished ? (
                  <span className="inline-flex items-center gap-1.5 text-body-sm text-[var(--reader-ink-soft)]">
                    <CheckIcon size={16} /> Книга прочитана
                  </span>
                ) : isLastChapter ? (
                  <Button
                    variant="primary"
                    onClick={onFinish}
                    disabled={finishing}
                    className="min-h-10"
                  >
                    <CheckIcon size={16} /> Дочитано
                  </Button>
                ) : null}
              </div>
            </div>
          </motion.section>
        </>
      ) : null}
    </AnimatePresence>
  );
}
