'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import { useTrack } from '@/app/lib/analytics';

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
}

interface CompleteResponse {
  score: number;
  results: ExerciseResult[];
}

export default function GrammarUnitPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const unitId = Number(params?.id);
  const trackEvent = useTrack();

  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [units, setUnits] = useState<GrammarUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, ExerciseResult>>({});
  const [score, setScore] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const loadUnit = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = session?.accessToken;
      const res = await fetch(`${API_URL}/api/grammar/units/${unitId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UnitDetail = await res.json();
      setUnit(data);
    } catch (err) {
      console.error('Failed to load grammar unit:', err);
      setError('Не удалось загрузить юнит. Проверь соединение и попробуй ещё раз.');
    } finally {
      setIsLoading(false);
    }
  }, [session, unitId]);

  useEffect(() => {
    if (status === 'authenticated' && Number.isFinite(unitId)) {
      loadUnit();
      fetch(`${API_URL}/api/grammar/units`, {
        headers: { Authorization: `Bearer ${session?.accessToken}` },
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data: GrammarUnit[]) => setUnits(data))
        .catch(() => setUnits([]));
    }
  }, [status, unitId, loadUnit, session]);

  const exercises = unit?.exercises ?? [];

  const sortedExercises = useMemo(
    () => [...exercises].sort((a, b) => a.order - b.order),
    [exercises]
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
      const token = session?.accessToken;
      const res = await fetch(`${API_URL}/api/grammar/units/${unitId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          answers: sortedExercises.map((ex) => ({
            exerciseId: ex.id,
            answer: answers[ex.id] ?? '',
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CompleteResponse = await res.json();
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
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !unit) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Link
            href="/grammar"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-slate)] hover:text-[var(--color-ink)] mb-6"
          >
            ← К грамматике
          </Link>
          <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-8 text-center">
            <p className="text-[var(--color-ink)] mb-4">{error || 'Юнит не найден'}</p>
            <button onClick={loadUnit} className="btn-primary">
              Попробовать снова
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const passed = score !== null && score >= 50;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <Link
          href="/grammar"
          className="inline-flex items-center gap-2 text-sm text-[var(--color-slate)] hover:text-[var(--color-ink)] mb-4"
        >
          ← К грамматике
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-3xl font-bold text-[var(--color-ink)]">{unit.title}</h1>
          <span className="badge badge-primary">{unit.cefrLevel}</span>
        </div>

        {/* Теория */}
        <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-6 md:p-8 mb-6">
          <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-4">Теория</h2>
          <div
            className="text-[var(--color-ink)] leading-relaxed text-[15px] [&_p]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-[var(--color-surface)] [&_code]:px-1 [&_code]:rounded [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--color-tint-yellow-bold)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[var(--color-slate)] [&_a]:text-[var(--color-primary)] [&_a]:underline [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4 [&_th]:bg-[var(--color-surface)] [&_th]:border [&_th]:border-[var(--color-hairline-strong)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-[var(--color-hairline-strong)] [&_td]:px-2 [&_td]:py-1"
            dangerouslySetInnerHTML={{ __html: unit.theoryHtml }}
          />
        </div>

        {/* Итог */}
        {score !== null && (
          <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-6 mb-6 text-center">
            <p className="text-2xl font-bold text-[var(--color-ink)]">
              Результат: {correctCount} из {sortedExercises.length} ({score}%)
            </p>
            {passed && (
              <div className="mt-4 inline-flex flex-col items-center gap-3">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[rgba(249,231,159,0.30)] text-[#7A3A00] font-semibold">
                  +XP за урок 🔥
                </span>
                {nextUnit ? (
                  <Link
                    href={`/grammar/${nextUnit.id}`}
                    className="btn-primary"
                  >
                    Следующий юнит: {nextUnit.title}
                  </Link>
                ) : (
                  <Link href="/grammar" className="btn-secondary">
                    Вернуться к списку
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* Упражнения */}
        <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-6 md:p-8 mb-6">
          <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-6">
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
                  className={`rounded-xl border p-4 transition-colors ${
                    result
                      ? result.correct
                        ? 'border-[var(--color-primary)] bg-[rgba(14,124,123,0.05)]'
                        : 'border-[var(--color-error)] bg-[rgba(217,45,32,0.05)]'
                      : 'border-[var(--color-hairline-strong)]'
                  }`}
                >
                  <p className="font-medium text-[var(--color-ink)] mb-4">
                    {index + 1}. {ex.prompt}
                  </p>

                  {ex.type === 'mc' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(ex.options ?? []).map((option, optIdx) => (
                        <button
                          key={optIdx}
                          type="button"
                          disabled={score !== null}
                          onClick={() =>
                            setAnswers((prev) => ({
                              ...prev,
                              [ex.id]: String(optIdx),
                            }))
                          }
                          className={`text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                            selected === String(optIdx)
                              ? 'border-[var(--color-tint-yellow-bold)] bg-[rgba(249,231,159,0.40)] text-[var(--color-ink)] font-medium'
                              : 'border-[var(--color-hairline-strong)] text-[var(--color-ink)] hover:border-[var(--color-tint-yellow-bold)]'
                          }`}
                        >
                          {option}
                        </button>
                      ))}
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
                      className="w-full px-4 py-3 rounded-lg border border-[var(--color-hairline-strong)] text-sm text-[var(--color-ink)] placeholder-[rgba(93,100,112,0.60)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent disabled:bg-[var(--color-surface)]"
                    />
                  )}

                  {result && (
                    <div className="mt-3 flex items-start gap-2 text-sm">
                      {result.correct ? (
                        <>
                          <span className="text-[var(--color-primary)] font-bold">✓</span>
                          <span className="text-[var(--color-primary)]">Верно!</span>
                        </>
                      ) : (
                        <>
                          <span className="text-[var(--color-error)] font-bold">✗</span>
                          <span className="text-[var(--color-error)]">
                            Правильно: {result.expected}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {checkError && (
            <p className="mt-6 text-sm text-[var(--color-error)]">{checkError}</p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {score === null ? (
              <button
                onClick={handleCheck}
                disabled={isChecking || answeredCount === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isChecking ? 'Проверяем…' : 'Проверить ответы'}
              </button>
            ) : (
              <button onClick={handleRetry} className="btn-secondary">
                Пройти ещё раз
              </button>
            )}
            {score === null && (
              <span className="text-sm text-[var(--color-slate)]">
                Отвечено: {answeredCount} из {sortedExercises.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
