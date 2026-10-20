'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useTts } from '@/hooks/useTts';
import { useRecorder } from '@/hooks/useRecorder';
import { blobToWavBase64 } from '@/app/lib/wav';

interface PairSide {
  word: string;
  ipa: string;
  translation: string;
}

interface MinimalPair {
  id: number;
  a: PairSide;
  b: PairSide;
  tip: string;
}

interface PairsResponse {
  pairs: MinimalPair[];
  total: number;
}

interface Verdict {
  transcribed: string;
  similarity: number;
  correct: boolean;
  advice: string;
  mismatches?: { expected: string; heard: string }[];
}

type Side = 'a' | 'b';

export default function PronunciationPage() {
  const { data: session, status } = useSession();
  const { play, isLoading: audioLoading } = useTts();
  const recorder = useRecorder();

  const { data, error, isLoading, refresh } = useApiQuery<PairsResponse>('/api/practice/minimal-pairs', {
    enabled: status === 'authenticated',
  });

  const [index, setIndex] = useState(0);
  const [side, setSide] = useState<Side>('a');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

  const pairs = data?.pairs ?? [];
  const pair = pairs[index];
  const target = pair ? pair[side].word : '';

  useEffect(() => {
    setVerdict(null);
    setCheckError('');
  }, [index, side]);

  const selectWord = useCallback(
    (nextSide: Side) => {
      setSide(nextSide);
      if (!pair) return;
      void play(pair[nextSide].word);
    },
    [pair, play]
  );

  const check = useCallback(
    async (blob: Blob) => {
      setChecking(true);
      setCheckError('');
      try {
        const audioBase64 = await blobToWavBase64(blob);
        const result = await apiMutate<Verdict>('/api/pronunciation/check', {
          token: session?.accessToken,
          method: 'POST',
          body: { target, audioBase64, mimeType: 'audio/wav' },
        });
        setVerdict(result);
      } catch (err) {
        setCheckError(
          err instanceof ApiError
            ? err.message
            : 'Не удалось проверить произношение. Попробуйте ещё раз.'
        );
      } finally {
        setChecking(false);
      }
    },
    [session?.accessToken, target]
  );

  const toggleRecord = useCallback(async () => {
    if (checking) return;

    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (blob) await check(blob);
      return;
    }

    setVerdict(null);
    setCheckError('');
    await recorder.start();
  }, [check, checking, recorder]);

  const nextPair = useCallback(() => {
    if (pairs.length === 0) return;
    setIndex((value) => (value + 1) % pairs.length);
    setSide('a');
  }, [pairs.length]);

  if (status === 'loading' || (isLoading && data === undefined)) {
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
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Не удалось загрузить пары</h1>
          <p className="text-[var(--color-slate)] mb-6">{error}</p>
          <button onClick={refresh} className="btn-primary">Попробовать снова</button>
        </div>
      </AppLayout>
    );
  }

  if (!pair) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto card p-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Пока пусто</h1>
          <p className="text-[var(--color-slate)] mb-6">Набор минимальных пар не загрузился.</p>
          <Link href="/dashboard" className="btn-primary">На главную</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-1">Произношение</h1>
          <p className="text-sm text-[var(--color-slate)]">
            Выберите слово, послушайте образец и повторите — проверим на слух.
          </p>
        </div>

        <div className="flex justify-between text-sm text-[var(--color-slate)] mb-2">
          <span>Пара {index + 1} из {pairs.length}</span>
          <span>Тренируем: {target}</span>
        </div>
        <div className="progress-bar mb-6">
          <div className="progress-fill" style={{ width: `${((index + 1) / pairs.length) * 100}%` }} />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {(['a', 'b'] as const).map((option) => {
            const item = pair[option];
            const active = side === option;

            return (
              <button
                key={option}
                onClick={() => selectWord(option)}
                className={`card p-6 text-center transition-all border-2 ${
                  active
                    ? 'border-[var(--color-primary)] bg-[var(--color-tint-mint)]'
                    : 'border-transparent hover:border-[var(--color-hairline-strong)]'
                }`}
                aria-pressed={active}
              >
                <p className="text-2xl font-bold text-[var(--color-ink)] mb-1">{item.word}</p>
                <p className="text-sm text-[var(--color-slate)]">{item.ipa}</p>
                <p className="text-xs text-[var(--color-slate)] mt-2">{item.translation}</p>
              </button>
            );
          })}
        </div>

        <div className="flex justify-center mb-6">
          <button
            onClick={() => play(target)}
            disabled={audioLoading}
            className="text-sm text-[var(--color-slate)] hover:text-[var(--color-primary)] transition-colors inline-flex items-center gap-2"
          >
            {audioLoading ? 'Загружаем звук…' : `🔊 Прослушать «${target}»`}
          </button>
        </div>

        <div className="card p-6 mb-6">
          <p className="text-sm text-[var(--color-slate)] leading-relaxed">
            <span className="font-medium text-[var(--color-ink)]">Подсказка: </span>
            {pair.tip}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 mb-6">
          <button
            onClick={toggleRecord}
            disabled={checking}
            className={`w-20 h-20 rounded-full text-white text-3xl flex items-center justify-center transition-all disabled:opacity-60 ${
              recorder.isRecording
                ? 'bg-[var(--color-error)] animate-pulse'
                : 'bg-[var(--color-primary)] hover:opacity-90'
            }`}
            aria-label={recorder.isRecording ? 'Остановить запись' : 'Начать запись'}
          >
            {checking ? (
              <span className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : recorder.isRecording ? (
              '⏹'
            ) : (
              '🎙'
            )}
          </button>
          <p className="text-sm text-[var(--color-slate)]">
            {checking
              ? 'Слушаем запись…'
              : recorder.isRecording
                ? `Идёт запись · ${recorder.seconds} с из ${recorder.maxSeconds}`
                : 'Нажмите и произнесите слово'}
          </p>
          {recorder.error && (
            <p className="text-sm text-[var(--color-error)] text-center">{recorder.error}</p>
          )}
          {checkError && (
            <p className="text-sm text-[var(--color-error)] text-center">{checkError}</p>
          )}
        </div>

        {verdict && (
          <div className="card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <span
                className={`text-sm font-medium px-3 py-1 rounded-full ${
                  verdict.correct
                    ? 'bg-[rgba(26,156,60,0.10)] text-[var(--color-success)]'
                    : 'bg-[rgba(217,45,32,0.10)] text-[var(--color-error)]'
                }`}
              >
                {verdict.correct ? 'Похоже на носителя' : 'Есть расхождения'}
              </span>
              <span className="text-2xl font-bold text-[var(--color-primary)]">{verdict.similarity}%</span>
            </div>

            <div className="progress-bar mb-4">
              <div className="progress-fill" style={{ width: `${verdict.similarity}%` }} />
            </div>

            <p className="text-sm text-[var(--color-slate)] mb-1">Мы услышали:</p>
            <p className="text-lg text-[var(--color-ink)] mb-4">«{verdict.transcribed || '—'}»</p>

            <p className="text-sm text-[var(--color-slate)] leading-relaxed">{verdict.advice}</p>

            <div className="flex flex-wrap gap-3 mt-5">
              <button onClick={toggleRecord} className="btn-primary">Ещё раз</button>
              <button onClick={() => selectWord(side === 'a' ? 'b' : 'a')} className="btn-secondary">
                Другое слово пары
              </button>
              <button onClick={nextPair} className="btn-secondary">Следующая пара</button>
            </div>
          </div>
        )}

        {!verdict && (
          <div className="flex justify-center">
            <button onClick={nextPair} className="text-sm text-[var(--color-slate)] hover:text-[var(--color-ink)] transition-colors">
              Пропустить пару →
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
