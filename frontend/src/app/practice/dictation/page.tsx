'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { useTts } from '@/hooks/useTts';
import { accuracyPercent, compareWords } from '@/app/lib/text-compare';

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
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (current && !checked) inputRef.current?.focus();
  }, [current, checked]);

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
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error && data === undefined) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto card p-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Диктант не загрузился</h1>
          <p className="text-[var(--color-slate)] mb-6">{error}</p>
          <button onClick={refresh} className="btn-primary">Попробовать снова</button>
        </div>
      </AppLayout>
    );
  }

  if (items.length === 0) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto card p-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Пока нечего диктовать</h1>
          <p className="text-[var(--color-slate)] mb-6">
            Диктант собирается из ваших слов. Добавьте хотя бы одно слово в словарь — и возвращайтесь.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/dictionary" className="btn-primary">В словарь</Link>
            <Link href="/books" className="btn-secondary">К книгам</Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (finished) {
    const correct = results.filter((r) => r.correct).length;
    const percent = results.length ? Math.round((correct / results.length) * 100) : 0;

    return (
      <AppLayout>
        <div className="max-w-md mx-auto text-center py-12">
          <div className="text-5xl mb-4">{percent >= 80 ? '🎧' : percent >= 50 ? '👍' : '💪'}</div>
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Диктант завершён</h1>
          <p className="text-4xl font-bold text-[var(--color-primary)] my-4">{percent}%</p>
          <p className="text-[var(--color-slate)] mb-2">
            Точно на слух: {correct} из {results.length}
          </p>
          <p className="text-sm text-[var(--color-slate)] mb-8">
            {submitting ? 'Сохраняем результат…' : submitError || 'Результат сохранён'}
          </p>
          <div className="flex gap-4 justify-center">
            <button onClick={restart} className="btn-primary">Ещё диктант</button>
            <Link href="/dashboard" className="btn-secondary">На главную</Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="flex justify-between text-sm text-[var(--color-slate)] mb-2">
            <span>Предложение {index + 1} из {items.length}</span>
            <span>Верно: {results.filter((r) => r.correct).length}</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${((index + (checked ? 1 : 0)) / items.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="card p-8">
          <p className="text-center text-[var(--color-slate)] mb-6">
            Прослушайте и запишите предложение
          </p>

          <div className="flex flex-col items-center gap-3 mb-8">
            <button
              onClick={() => play(current.sentence)}
              className="w-20 h-20 rounded-full bg-[var(--color-primary)] text-white text-3xl flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-60"
              disabled={isLoading}
              aria-label="Прослушать предложение"
            >
              {isLoading ? (
                <span className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : isPlaying ? '🔊' : '▶'}
            </button>
            <button
              onClick={() => play(current.sentence)}
              className="text-sm text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors"
            >
              Прослушать ещё раз
            </button>
            {current.translation && (
              <p className="text-xs text-[var(--color-slate)] text-center max-w-sm">
                Подсказка: {current.translation}
              </p>
            )}
          </div>

          <input
            ref={inputRef}
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
            className="input w-full mb-4"
            autoComplete="off"
            spellCheck={false}
          />

          {!checked ? (
            <button
              onClick={handleCheck}
              disabled={!answer.trim()}
              className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Проверить
            </button>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[var(--color-tint-mint)] border border-[var(--color-hairline-strong)]">
                <p className="text-xs uppercase tracking-wide text-[var(--color-slate)] mb-2">
                  Правильный вариант
                </p>
                <p className="text-lg text-[var(--color-ink)] leading-relaxed">
                  {preview.map((match, i) => (
                    <span
                      key={i}
                      className={
                        match.ok
                          ? 'text-[var(--color-success)]'
                          : 'text-[var(--color-error)] underline decoration-wavy decoration-[var(--color-error)]'
                      }
                    >
                      {match.word}{' '}
                    </span>
                  ))}
                </p>
              </div>

              <p className="text-sm text-[var(--color-slate)]">
                Совпадение: {accuracyPercent(current.sentence, answer)}%
                {results[index] && results[index].correct ? ' · засчитано' : ' · пока неточно'}
              </p>

              <button onClick={handleNext} className="btn-primary w-full">
                {index < items.length - 1 ? 'Следующее предложение' : 'Завершить диктант'}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-[var(--color-slate)] mt-6">
          Слова берутся из вашего словаря. За каждое предложение — опыт.
        </p>
      </div>
    </AppLayout>
  );
}
