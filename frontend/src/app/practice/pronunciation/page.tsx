'use client';

import AppLayout from '@/components/AppLayout';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import { useApiQuery } from '@/app/lib/use-api';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useTts } from '@/hooks/useTts';
import { useRecorder } from '@/hooks/useRecorder';
import { blobToWavBase64 } from '@/app/lib/wav';
import { slideVariants, variants } from '@/lib/motion';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import ProgressBar from '@/components/ui/ProgressBar';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Tag } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/LoadingState';
import {
  AlertIcon,
  ArrowRightIcon,
  InboxIcon,
  MicIcon,
  SpinnerIcon,
  StopIcon,
  VolumeIcon,
} from '@/components/ui/icons';

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
        <PronunciationSkeleton />
      </AppLayout>
    );
  }

  if (error && data === undefined) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <ErrorState
            title="Не удалось загрузить пары"
            description={error}
            onRetry={refresh}
            action={<Button variant="ghost" href="/dashboard">На главную</Button>}
          />
        </div>
      </AppLayout>
    );
  }

  if (!pair) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <EmptyState
            icon={<InboxIcon size={24} />}
            title="Минимальных пар нет"
            description="Пары для тренировки строятся из ваших слов. Добавьте слова в словарь и обновите страницу."
            action={
              <>
                <Button href="/dictionary">В словарь</Button>
                <Button variant="secondary" href="/dashboard">
                  На главную
                </Button>
              </>
            }
          />
        </div>
      </AppLayout>
    );
  }

  const similarityTone = verdict
    ? verdict.correct
      ? 'text-primary'
      : verdict.similarity >= 60
        ? 'text-semantic-warning'
        : 'text-semantic-error'
    : '';

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Произношение"
          subtitle="Выберите слово, послушайте образец и повторите — проверим на слух."
        />

        <div className="mt-6 mb-2 flex justify-between text-body-sm text-slate">
          <span>
            Пара {index + 1} из {pairs.length}
          </span>
          <span>Тренируем: {target}</span>
        </div>
        <ProgressBar
          value={((index + 1) / pairs.length) * 100}
          label={`Пара ${index + 1} из ${pairs.length}`}
          className="mb-6"
        />

        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={pair.id}
            variants={slideVariants(1)}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="mb-4 grid grid-cols-2 gap-4">
              {(['a', 'b'] as const).map((option) => {
                const item = pair[option];
                const active = side === option;
                // На выбранном поле цвета подсветки вторичный текст должен
                // оставаться чернильным: приглушённый slate на таком фоне
                // в тёмной теме не дотягивает до 4.5:1.
                const noteTone = active ? 'text-ink' : 'text-slate';

                return (
                  <motion.button
                    key={option}
                    type="button"
                    onClick={() => selectWord(option)}
                    whileTap={{ scale: 0.99 }}
                    aria-pressed={active}
                    className={`card border-2 p-6 text-center transition-[background-color,border-color] duration-fast ease-soft ${
                      active
                        ? 'border-primary bg-surface-highlight'
                        : 'border-transparent hover:border-hairline-strong'
                    }`}
                  >
                    <p className="mb-1 break-words text-h2 text-ink">{item.word}</p>
                    <p className={`text-body-sm ${noteTone}`}>{item.ipa}</p>
                    <p className={`mt-2 text-caption ${noteTone}`}>{item.translation}</p>
                  </motion.button>
                );
              })}
            </div>

            <div className="mb-6 flex justify-center">
              <button
                type="button"
                onClick={() => play(target)}
                disabled={audioLoading}
                className="icon-chip"
              >
                {audioLoading ? (
                  <SpinnerIcon size={20} className="animate-spin" label="Загрузка озвучки" />
                ) : (
                  <VolumeIcon size={20} />
                )}
                {audioLoading ? 'Загружаем звук…' : `Прослушать «${target}»`}
              </button>
            </div>

            <div className="card mb-6 p-6">
              <p className="text-body-sm leading-relaxed text-slate">
                <span className="font-medium text-ink">Подсказка: </span>
                {pair.tip}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative">
            {recorder.isRecording && (
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-semantic-error"
                initial={{ opacity: 0.35, scale: 1 }}
                animate={{ opacity: 0, scale: 1.45 }}
                transition={{ duration: 1.4, ease: 'easeOut', repeat: Infinity }}
              />
            )}
            <motion.button
              type="button"
              onClick={toggleRecord}
              disabled={checking}
              whileTap={{ scale: 0.96 }}
              aria-label={recorder.isRecording ? 'Остановить запись' : 'Начать запись'}
              className={`relative flex h-20 w-20 items-center justify-center rounded-full text-on-primary transition-colors duration-fast ease-soft disabled:opacity-60 ${
                recorder.isRecording
                  ? 'bg-semantic-error hover:bg-semantic-error'
                  : 'bg-primary hover:bg-primary-pressed'
              }`}
            >
              {checking ? (
                <SpinnerIcon size={24} className="animate-spin" label="Проверяем запись" />
              ) : recorder.isRecording ? (
                <StopIcon size={24} />
              ) : (
                <MicIcon size={24} />
              )}
            </motion.button>
          </div>
          <p className="text-body-sm text-slate" role="status">
            {checking
              ? 'Слушаем запись…'
              : recorder.isRecording
                ? `Идёт запись · ${recorder.seconds} с из ${recorder.maxSeconds}`
                : 'Нажмите и произнесите слово'}
          </p>
          <AnimatePresence>
            {(recorder.error || checkError) && (
              <motion.p
                variants={variants.enter}
                initial="hidden"
                animate="visible"
                exit="exit"
                role="alert"
                className="flex max-w-measure items-start gap-2 text-center text-body-sm text-semantic-error"
              >
                <AlertIcon size={20} className="mt-0.5 shrink-0" />
                {recorder.error || checkError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait">
          {verdict && (
            <motion.div
              key="verdict"
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="card mb-6 p-6"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <Tag tone={verdict.correct ? 'success' : 'warning'}>
                  {verdict.correct ? 'Похоже на носителя' : 'Есть расхождения'}
                </Tag>
                <p className={`text-h2 tabular-nums ${similarityTone}`}>
                  <AnimatedNumber value={verdict.similarity} />%
                </p>
              </div>

              <ProgressBar value={verdict.similarity} label="Сходство с образцом" />

              <p className="mt-4 text-caption uppercase tracking-wide text-slate">Мы услышали</p>
              <p className="mb-4 break-words text-body-lg text-ink">«{verdict.transcribed || '—'}»</p>

              <p className="text-body-sm leading-relaxed text-slate">{verdict.advice}</p>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={toggleRecord}>Ещё раз</Button>
                <Button variant="secondary" onClick={() => selectWord(side === 'a' ? 'b' : 'a')}>
                  Другое слово пары
                </Button>
                <Button variant="ghost" onClick={nextPair}>
                  Следующая пара
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!verdict && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={nextPair} className="group">
              Пропустить пару
              <ArrowRightIcon
                size={16}
                className="transition-transform duration-fast ease-soft group-hover:translate-x-0.5"
              />
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

/** Скелет повторяет экран: две карточки слов, подсказка и круг записи. */
function PronunciationSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-2xl animate-page-in">
      <span className="sr-only">Загрузка минимальных пар</span>
      <Skeleton className="mb-2 h-8 w-52" />
      <Skeleton className="mb-6 h-4 w-full max-w-measure" />
      <Skeleton className="mb-2 h-4 w-32" />
      <Skeleton className="mb-6 h-2 w-full rounded-full" />
      <div className="mb-4 grid grid-cols-2 gap-4">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
      <Skeleton className="mx-auto mb-6 h-10 w-48 rounded-md" />
      <Skeleton className="mb-6 h-20 w-full rounded-lg" />
      <div className="mb-6 flex flex-col items-center gap-3">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-4 w-44" />
      </div>
    </div>
  );
}
