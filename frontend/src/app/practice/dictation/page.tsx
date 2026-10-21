'use client';

import AppLayout from '@/components/AppLayout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { useTts } from '@/hooks/useTts';
import { accuracyPercent, compareWords } from '@/app/lib/text-compare';
import { pluralSentences } from '@/lib/plural';
import { slideVariants, variants } from '@/lib/motion';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ProgressBar from '@/components/ui/ProgressBar';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Skeleton } from '@/components/ui/LoadingState';
import {
  CheckCircleIcon,
  InboxIcon,
  PlayIcon,
  RepeatIcon,
  SpinnerIcon,
  VolumeIcon,
} from '@/components/ui/icons';

interface DictationItem {
  wordId: number;
  word: string;
  sentence: string;
  translation?: string | null;
  partOfSpeech?: string | null;
}

interface DictationResponse {
  items: DictationItem[];
  count?: number;
  reason?: string;
}

interface AttemptResult {
  wordId: number;
  correct: boolean;
  accuracy: number;
}

const ITEM_COUNT = 5;

export default function DictationPage() {
  const { data: session, status } = useSession();
  const { play, stop, isPlaying, isLoading } = useTts();

  const { data, error, isLoading: loadingDeck, refresh } = useApiQuery<DictationResponse>(
    `/api/practice/dictation?count=${ITEM_COUNT}`,
    { maxAgeMs: 0, enabled: status === 'authenticated' }
  );

  const [deck, setDeck] = useState<DictationItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [finished, setFinished] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Колода фиксируется один раз: фоновое обновление не подменит предложение
  // посреди диктанта
  useEffect(() => {
    if (data && deck === null) setDeck(data.items ?? []);
  }, [data, deck]);

  const items = deck ?? data?.items ?? [];
  const current = items[index];

  // Озвучка текущего предложения. Автозапуск может быть заблокирован
  // политикой браузера — тогда пользователь нажмёт кнопку сам.
  useEffect(() => {
    if (!current || checked) return;
    const timer = window.setTimeout(() => {
      void play(current.sentence);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.wordId, checked]);

  // Карточка перемонтируется на каждом предложении (AnimatePresence), поэтому
  // фокус ловим в момент установки ref, а не в эффекте по индексу.
  const attachInput = useCallback(
    (node: HTMLInputElement | null) => {
      if (node && !checked) node.focus();
    },
    [checked]
  );

  const preview = useMemo(
    () => (checked && current ? compareWords(current.sentence, answer) : []),
    [checked, current, answer]
  );

  const handleCheck = useCallback(() => {
    if (!current || checked) return;
    const accuracy = accuracyPercent(current.sentence, answer);
    setChecked(true);
    setResults((prev) => [
      ...prev,
      { wordId: current.wordId, correct: accuracy >= 90, accuracy },
    ]);
  }, [answer, checked, current]);

  const submitResults = useCallback(
    async (all: AttemptResult[]) => {
      if (all.length === 0) return;
      setSubmitting(true);
      setSubmitError('');
      try {
        await apiMutate('/api/practice/dictation/result', {
          token: session?.accessToken,
          method: 'POST',
          body: { results: all.map((r) => ({ wordId: r.wordId, correct: r.correct })) },
        });
      } catch {
        // Диктант пройден — ошибка сохранения не должна его «отменять»
        setSubmitError('Результат не сохранился: сервер недоступен. Прогресс засчитается в следующий раз.');
      } finally {
        setSubmitting(false);
      }
    },
    [session?.accessToken]
  );

  const handleNext = useCallback(async () => {
    if (index < items.length - 1) {
      setIndex(index + 1);
      setAnswer('');
      setChecked(false);
      return;
    }

    setFinished(true);
    stop();
    await submitResults(results);
  }, [index, items.length, results, stop, submitResults]);

  const restart = useCallback(() => {
    stop();
    setDeck(null);
    setIndex(0);
    setAnswer('');
    setChecked(false);
    setResults([]);
    setFinished(false);
    setSubmitError('');
    refresh();
  }, [refresh, stop]);

  if (status === 'loading' || (loadingDeck && data === undefined)) {
    return (
      <AppLayout>
        <DictationSkeleton />
      </AppLayout>
    );
  }

  if (error && data === undefined) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <ErrorState
            title="Диктант не загрузился"
            description={error}
            onRetry={refresh}
            action={<Button variant="ghost" href="/dashboard">На главную</Button>}
          />
        </div>
      </AppLayout>
    );
  }

  if (items.length === 0) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <EmptyState
            icon={<InboxIcon size={24} />}
            title="Пока нечего диктовать"
            description="Диктант собирается из ваших слов. Добавьте хотя бы одно слово в словарь — и возвращайтесь."
            action={
              <>
                <Button href="/dictionary">В словарь</Button>
                <Button variant="secondary" href="/books">К книгам</Button>
              </>
            }
          />
        </div>
      </AppLayout>
    );
  }

  if (finished) {
    const correct = results.filter((r) => r.correct).length;
    const percent = results.length ? Math.round((correct / results.length) * 100) : 0;
    const tone =
      percent >= 80
        ? 'bg-surface-accent text-on-accent'
        : percent >= 50
          ? 'bg-surface-warning text-on-warning'
          : 'bg-surface-danger text-on-danger';
    const numberTone =
      percent >= 80 ? 'text-primary' : percent >= 50 ? 'text-semantic-warning' : 'text-semantic-error';

    return (
      <AppLayout>
        <motion.div
          variants={variants.enter}
          initial="hidden"
          animate="visible"
          className="mx-auto max-w-md py-12 text-center"
        >
          <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-lg ${tone}`}>
            {percent >= 80 ? <CheckCircleIcon size={24} /> : <RepeatIcon size={24} />}
          </div>
          <h1 className="mb-2 text-h1 text-ink">Диктант завершён</h1>
          <p className={`my-4 text-h1 tabular-nums ${numberTone}`}>
            <AnimatedNumber value={percent} />%
          </p>
          <p className="mb-2 text-body-lg text-slate">
            Точно на слух: {correct} из {results.length} {pluralSentences(results.length)}
          </p>
          <p className="mb-8 text-body-sm text-slate">
            {submitting ? 'Сохраняем результат…' : submitError || 'Результат сохранён'}
          </p>
          <div className="flex justify-center gap-3">
            <Button onClick={restart}>Ещё диктант</Button>
            <Button variant="secondary" href="/dashboard">
              На главную
            </Button>
          </div>
        </motion.div>
      </AppLayout>
    );
  }

  const progress = ((index + (checked ? 1 : 0)) / items.length) * 100;
  const matchPercent = accuracyPercent(current.sentence, answer);
  const scored = results[index]?.correct ?? false;

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <div className="mb-2 flex justify-between text-body-sm text-slate">
            <span>
              Предложение {index + 1} из {items.length}
            </span>
            <span className="tabular-nums">Верно: {results.filter((r) => r.correct).length}</span>
          </div>
          <ProgressBar value={progress} label={`Пройдено ${index + 1} из ${items.length}`} />
        </div>

        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={`${current.wordId}-${index}`}
            variants={slideVariants(1)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="card p-8"
          >
            <h1 className="mb-6 text-center text-body text-slate">Прослушайте и запишите предложение</h1>

            <div className="mb-8 flex flex-col items-center gap-3">
              <button
                onClick={() => play(current.sentence)}
                disabled={isLoading}
                aria-label="Прослушать предложение"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-on-primary transition-transform duration-fast ease-soft hover:bg-primary-pressed active:scale-97 disabled:opacity-60"
              >
                {isLoading ? (
                  <SpinnerIcon size={24} className="animate-spin" label="Загрузка озвучки" />
                ) : isPlaying ? (
                  <VolumeIcon size={24} />
                ) : (
                  <PlayIcon size={24} />
                )}
              </button>
              <button
                onClick={() => play(current.sentence)}
                className="text-body-sm text-slate transition-colors duration-fast hover:text-primary"
              >
                Прослушать ещё раз
              </button>
              {current.translation && (
                <p className="max-w-sm text-center text-caption text-slate">
                  Подсказка: {current.translation}
                </p>
              )}
            </div>

            <input
              ref={attachInput}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (checked) handleNext();
                  else handleCheck();
                }
              }}
              disabled={checked}
              placeholder="Напишите то, что услышали…"
              className="input mb-4 w-full"
              autoComplete="off"
              spellCheck={false}
            />

            {!checked ? (
              <Button onClick={handleCheck} disabled={!answer.trim()} className="w-full">
                Проверить
              </Button>
            ) : (
              <motion.div variants={variants.enter} initial="hidden" animate="visible" className="space-y-4">
                <div className="rounded-lg border border-hairline bg-surface-accent p-4">
                  <p className="mb-2 text-caption uppercase tracking-wide text-on-accent">Правильный вариант</p>
                  <p className="text-body-lg leading-relaxed text-ink">
                    {preview.map((match, i) => (
                      <span
                        key={i}
                        className={
                          match.ok
                            ? 'text-semantic-success'
                            : 'text-semantic-error underline decoration-wavy decoration-semantic-error'
                        }
                      >
                        {match.word}{' '}
                      </span>
                    ))}
                  </p>
                </div>

                <p className="text-body-sm text-slate">
                  Совпадение: <strong className="font-semibold tabular-nums text-ink">{matchPercent}%</strong>
                  {scored ? ' · засчитано' : ' · пока неточно'}
                </p>

                <Button onClick={handleNext} className="w-full">
                  {index < items.length - 1 ? 'Следующее предложение' : 'Завершить диктант'}
                </Button>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        <p className="mx-auto mt-6 max-w-measure-sm text-center text-caption text-slate">
          Слова берутся из вашего словаря. За каждое предложение — опыт.
        </p>
      </div>
    </AppLayout>
  );
}

/** Скелет повторяет карточку диктанта: круг озвучки, поле ответа и кнопка. */
function DictationSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-2xl animate-page-in">
      <span className="sr-only">Загрузка предложений для диктанта</span>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-8 h-2 w-full rounded-full" />
      <div className="card p-8">
        <Skeleton className="mx-auto mb-6 h-4 w-64" />
        <Skeleton className="mx-auto mb-3 h-20 w-20 rounded-full" />
        <Skeleton className="mx-auto mb-8 h-4 w-36" />
        <Skeleton className="mb-4 h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}
