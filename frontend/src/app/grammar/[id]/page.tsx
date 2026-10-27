'use client';

import AppLayout from '@/components/AppLayout';
import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useTrack } from '@/app/lib/analytics';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { pluralQuestions } from '@/lib/plural';
import { variants } from '@/lib/motion';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import LevelChip from '@/components/ui/LevelChip';
import ProgressBar from '@/components/ui/ProgressBar';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Skeleton } from '@/components/ui/LoadingState';
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  FlameIcon,
  SpinnerIcon,
} from '@/components/ui/icons';

interface Exercise {
  id: number;
  order: number;
  type: 'mc' | 'fill';
  prompt: string;
  options?: string[];
}

interface UnitDetail {
  id: number;
  title: string;
  cefrLevel: string;
  theoryHtml: string;
  exercises: Exercise[];
}

interface GrammarUnit {
  id: number;
  order: number;
  title: string;
  cefrLevel: string;
  shortDescription: string;
  completed: boolean;
  score: number;
}

interface ExerciseResult {
  exerciseId: number;
  correct: boolean;
  expected: string;
  explanation?: string | null;
}

interface CompleteResponse {
  score: number;
  results: ExerciseResult[];
}

export default function GrammarUnitPage() {
  const { status } = useSession();
  const params = useParams();
  const unitId = Number(params?.id);
  const trackEvent = useTrack();

  const {
    data: unitData,
    error: unitError,
    isLoading: unitLoading,
    refresh: refreshUnit,
  } = useApiQuery<UnitDetail>(Number.isFinite(unitId) ? `/api/grammar/units/${unitId}` : null, {
    enabled: status === 'authenticated',
  });

  // Список нужен только для ссылки «Следующий юнит» — берём его из общего кэша.
  const { data: unitsData } = useApiQuery<GrammarUnit[]>('/api/grammar/units', {
    enabled: status === 'authenticated' && Number.isFinite(unitId),
  });

  const unit = unitData;
  const units = useMemo(() => unitsData ?? [], [unitsData]);
  const isLoading = unitLoading && unitData === undefined;

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, ExerciseResult>>({});
  const [score, setScore] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const sortedExercises = useMemo(
    () => [...(unit?.exercises ?? [])].sort((a, b) => a.order - b.order),
    [unit]
  );

  const nextUnit = useMemo(() => {
    if (!unit) return null;
    return (
      units.find((u) => u.id === unit.id + 1) ??
      units
        .filter((u) => u.order > (units.find((x) => x.id === unit.id)?.order ?? 0))
        .sort((a, b) => a.order - b.order)[0] ??
      null
    );
  }, [unit, units]);

  const answeredCount = sortedExercises.filter((ex) => {
    const value = answers[ex.id];
    return value !== undefined && value.trim() !== '';
  }).length;

  const correctCount = Object.values(results).filter((r) => r.correct).length;

  const handleCheck = async () => {
    setIsChecking(true);
    setCheckError(null);
    try {
      const data = await apiMutate<CompleteResponse>(`/api/grammar/units/${unitId}/complete`, {
        method: 'POST',
        body: {
          answers: sortedExercises.map((ex) => ({
            exerciseId: ex.id,
            answer: answers[ex.id] ?? '',
          })),
        },
        // Прогресс юнита изменился — список на /grammar должен показать новый результат.
        invalidate: ['/api/grammar/units'],
      });
      trackEvent('grammar_unit_completed', unit?.title);

      const resultsMap: Record<number, ExerciseResult> = {};
      for (const r of data.results) {
        resultsMap[r.exerciseId] = r;
      }
      setResults(resultsMap);
      setScore(data.score);

      const firstIncorrect = sortedExercises.find(
        (ex) => resultsMap[ex.id] && !resultsMap[ex.id].correct
      );
      if (firstIncorrect) {
        setTimeout(() => {
          document
            .getElementById(`exercise-${firstIncorrect.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    } catch (err) {
      console.error('Failed to submit answers:', err);
      setCheckError('Не удалось отправить ответы. Попробуй ещё раз.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleRetry = () => {
    setAnswers({});
    setResults({});
    setScore(null);
    setCheckError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <UnitSkeleton />
      </AppLayout>
    );
  }

  if (!unit) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-2xl">
          <BackToList />
          <ErrorState
            title={unitError ? 'Юнит не загрузился' : 'Юнит не найден'}
            description={
              unitError
                ? 'Проверь соединение и попробуй ещё раз.'
                : 'Такого урока грамматики нет: возможно, он ещё не опубликован.'
            }
            onRetry={refreshUnit}
          />
        </div>
      </AppLayout>
    );
  }

  const passed = score !== null && score >= 50;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <BackToList />

        <div className="mb-8 flex flex-wrap items-center gap-3">
          <h1 className="text-h1 text-ink">{unit.title}</h1>
          <LevelChip level={unit.cefrLevel} className="px-3 py-1" />
        </div>

        {/* Теория */}
        <section className="card mb-6 p-6 md:p-8" aria-labelledby="theory-title">
          <h2 id="theory-title" className="mb-4 text-h3 text-ink">
            Теория
          </h2>
          <div className="theory-text" dangerouslySetInnerHTML={{ __html: unit.theoryHtml }} />
        </section>

        {/* Итог */}
        <AnimatePresence>
          {score !== null && (
            <motion.section
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
              aria-labelledby="result-title"
              className="card mb-6 p-6 text-center"
            >
              <h2 id="result-title" className="text-h2 tabular-nums text-ink">
                Результат: {correctCount} из {sortedExercises.length}{' '}
                <span className={passed ? 'text-primary' : 'text-semantic-warning'}>
                  (<AnimatedNumber value={score} />%)
                </span>
              </h2>
              {passed && (
                <div className="mt-4 inline-flex flex-col items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-surface-highlight px-4 py-2 text-body-sm font-semibold text-ink">
                    <FlameIcon size={16} />
                    +XP за урок
                  </span>
                  {nextUnit ? (
                    <Button href={`/grammar/${nextUnit.id}`}>Следующий юнит: {nextUnit.title}</Button>
                  ) : (
                    <Button variant="secondary" href="/grammar">
                      Вернуться к списку
                    </Button>
                  )}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Упражнения */}
        <section className="card mb-6 p-6 md:p-8" aria-labelledby="practice-title">
          <h2 id="practice-title" className="mb-6 text-h3 text-ink">
            Упражнения
          </h2>
          <div className="space-y-8">
            {sortedExercises.map((ex, index) => {
              const result = results[ex.id];
              const selected = answers[ex.id];

              return (
                <div
                  key={ex.id}
                  id={`exercise-${ex.id}`}
                  className={`rounded-lg border p-4 transition-colors duration-fast ease-soft ${
                    result
                      ? result.correct
                        ? 'border-semantic-success bg-surface-success'
                        : 'border-semantic-error bg-surface-danger'
                      : 'border-hairline-strong'
                  }`}
                >
                  <p className="mb-4 text-body text-ink">
                    <span className="tabular-nums text-slate">{index + 1}.</span> {ex.prompt}
                  </p>

                  {ex.type === 'mc' ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(ex.options ?? []).map((option, optIdx) => {
                        const chosen = selected === String(optIdx);
                        const revealed = result && !result.correct && option === result.expected;
                        const tone =
                          chosen && result && result.correct
                            ? 'border-semantic-success bg-surface-success text-ink'
                            : chosen && result
                              ? 'border-semantic-error bg-surface-danger text-ink'
                              : revealed
                                ? 'border-primary bg-surface-accent text-ink'
                                : chosen
                                  ? 'border-transparent bg-surface-highlight text-ink'
                                  : 'border-hairline-strong text-ink hover:bg-surface';

                        return (
                          <motion.button
                            key={optIdx}
                            type="button"
                            disabled={score !== null}
                            whileTap={{ scale: 0.99 }}
                            onClick={() =>
                              setAnswers((prev) => ({
                                ...prev,
                                [ex.id]: String(optIdx),
                              }))
                            }
                            className={`rounded-lg border-2 px-4 py-3 text-left text-body-sm font-medium transition-[background-color,border-color] duration-fast ease-soft disabled:cursor-default ${tone}`}
                          >
                            {option}
                          </motion.button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={selected ?? ''}
                      disabled={score !== null}
                      placeholder="Ответ…"
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [ex.id]: e.target.value }))
                      }
                      className="input w-full"
                    />
                  )}

                  {/* Разбор появляется вместе с проверкой — только прозрачность,
                      чтобы страница не прыгала по высоте */}
                  <AnimatePresence>
                    {result && (
                      <motion.div variants={variants.fadeOnly} initial="hidden" animate="visible" className="mt-3">
                        <p
                          className={`flex items-center gap-2 text-body-sm font-medium ${
                            result.correct ? 'text-semantic-success' : 'text-semantic-error'
                          }`}
                        >
                          {result.correct ? <CheckIcon size={16} /> : <CloseIcon size={16} />}
                          {result.correct ? 'Верно' : `Правильно: ${result.expected}`}
                        </p>
                        {result.explanation && (
                          <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-body-sm text-slate">
                            {result.explanation}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {checkError && (
            <p role="alert" className="mt-6 flex items-start gap-2 text-body-sm text-semantic-error">
              <AlertIcon size={20} className="mt-0.5 shrink-0" />
              {checkError}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {score === null ? (
              <Button onClick={handleCheck} disabled={isChecking || answeredCount === 0}>
                {isChecking && <SpinnerIcon size={16} className="animate-spin" />}
                {isChecking ? 'Проверяем…' : 'Проверить ответы'}
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleRetry}>
                Пройти ещё раз
              </Button>
            )}
            {score === null && (
              <span className="text-body-sm tabular-nums text-slate">
                Отвечено: {answeredCount} из {sortedExercises.length}
              </span>
            )}
          </div>

          {score === null && sortedExercises.length > 0 && (
            <div className="mt-4">
              <ProgressBar
                value={(answeredCount / sortedExercises.length) * 100}
                label={`Отвечено ${answeredCount} из ${sortedExercises.length} ${pluralQuestions(sortedExercises.length)}`}
              />
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}

/** Возврат к списку юнитов — это навигация, поэтому ссылка, а не обработчик клика. */
function BackToList() {
  return (
    <Button href="/grammar" variant="ghost" className="mb-4">
      <ArrowLeftIcon size={16} />
      К грамматике
    </Button>
  );
}

/** Скелет повторяет страницу: заголовок, блок теории и карточки упражнений. */
function UnitSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-3xl animate-page-in">
      <span className="sr-only">Загрузка юнита грамматики</span>
      <Skeleton className="mb-4 h-8 w-36" />
      <Skeleton className="mb-8 h-9 w-2/3" />
      <div className="card mb-6 p-6 md:p-8">
        <Skeleton className="mb-4 h-6 w-28" />
        <Skeleton className="mb-3 h-4 w-full" />
        <Skeleton className="mb-3 h-4 w-11/12" />
        <Skeleton className="mb-3 h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="card p-6 md:p-8">
        <Skeleton className="mb-6 h-6 w-36" />
        {[0, 1].map((i) => (
          <div key={i} className="mb-4 rounded-lg border border-hairline p-4">
            <Skeleton className="mb-4 h-4 w-3/4" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
