'use client';

import AppLayout from '@/components/AppLayout';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useTrack } from '@/app/lib/analytics';
import { useTts } from '@/hooks/useTts';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';
import { slideVariants, variants } from '@/lib/motion';
import Button from '@/components/ui/Button';
import WordVisual from '@/components/dictionary/WordVisual';
import ErrorState from '@/components/ui/ErrorState';
import Notice from '@/components/ui/Notice';
import ProgressBar from '@/components/ui/ProgressBar';
import { Tag } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/LoadingState';
import { ArrowLeftIcon, SpinnerIcon, VolumeIcon } from '@/components/ui/icons';

interface Word {
  wordId: number;
  text: string;
  emoji?: string | null;
  imageUrl?: string | null;
  definitions: {
    definition: string;
    partOfSpeech?: string;
    example?: string;
  }[];
  isNew?: boolean;
  isLeech?: boolean;
}

interface ReviewTodayResponse {
  totalCount?: number;
  reviewCount?: number;
  newCount?: number;
  words?: Word[];
}

interface ReviewResponse {
  undoToken?: string;
  xpEarned?: number;
}

interface AnswerRecord {
  index: number;
  wordId: number;
  quality: number;
  undoToken: string;
  xpEarned: number;
}

const QUALITY = [
  {
    value: 1,
    key: '1',
    label: 'Не знаю',
    className: 'bg-surface-danger text-on-danger hover:bg-semantic-error hover:text-on-primary',
  },
  {
    value: 3,
    key: '2',
    label: 'Трудно',
    className: 'bg-surface-warning text-on-warning hover:bg-surface-highlight',
  },
  {
    value: 4,
    key: '3',
    label: 'Хорошо',
    className: 'bg-surface-success text-on-success hover:bg-semantic-success hover:text-on-primary',
  },
  {
    value: 5,
    key: '4',
    label: 'Легко',
    className: 'bg-primary text-on-primary hover:bg-primary-pressed',
  },
];

/** Общая рамка фокусной сессии: тихая шапка и одна колонка по центру. */
function ReviewShell({ children }: { children: React.ReactNode }) {
  return (
    <AppLayout immersive>
      <div className="min-h-[100dvh] bg-surface">
        <header className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link href="/dictionary" className="icon-chip" aria-label="К словарю">
            <ArrowLeftIcon size={20} />
          </Link>
          <span className="text-caption font-semibold uppercase tracking-[0.16em] text-slate">
            Повторение
          </span>
          <span className="h-10 w-10" aria-hidden="true" />
        </header>
        <main className="mx-auto w-full max-w-2xl px-4 pb-12 sm:px-6">{children}</main>
      </div>
    </AppLayout>
  );
}

export default function ReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const trackEvent = useTrack();
  const { speak, isLoading: isSpeakingLoading } = useTts();

  const { data, error: loadError, isLoading, refresh } = useApiQuery<ReviewTodayResponse>('/api/review/today', {
    maxAgeMs: 0,
    enabled: status === 'authenticated',
  });

  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastAnswer, setLastAnswer] = useState<AnswerRecord | null>(null);
  const [ratings, setRatings] = useState<number[]>([]);
  const [sessionXp, setSessionXp] = useState(0);
  const [paused, setPaused] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState('');

  // Колода — снимок на момент входа: ответы и позиция не должны «мигать» из-за фона.
  useEffect(() => {
    if (!data || sessionStarted) return;
    setWords(data.words ?? []);
    setSessionStarted(true);
  }, [data, sessionStarted]);

  // Авто-озвучка нового слова; на паузе и в итоге не мешаем.
  useEffect(() => {
    if (!paused && !isFinished && words.length > 0 && currentIndex < words.length) {
      speak(words[currentIndex].text);
    }
  }, [currentIndex, words, speak, paused, isFinished]);

  const currentWord = words[currentIndex];

  const handleQuality = useCallback(async (quality: number) => {
    const word = words[currentIndex];
    if (!word || isSaving) return;

    setIsSaving(true);
    setSaveError('');
    setUndoError('');

    try {
      const outcome = await apiMutate<ReviewResponse>(
        `/api/review/${word.wordId}/quality/${quality}`,
        {
          token: session?.accessToken,
          method: 'POST',
          invalidate: ['/api/review/today', '/api/progress/streak'],
        }
      );

      const xp = Number(outcome?.xpEarned) || 1;
      setSessionXp((value) => value + xp);
      setRatings((value) => [...value, quality]);
      setLastAnswer(
        outcome?.undoToken
          ? {
              index: currentIndex,
              wordId: word.wordId,
              quality,
              undoToken: outcome.undoToken,
              xpEarned: xp,
            }
          : null
      );
      trackEvent('word_reviewed', word.text);

      if (currentIndex < words.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setShowAnswer(false);
      } else {
        setIsFinished(true);
      }
    } catch {
      setSaveError('Не удалось сохранить ответ. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setIsSaving(false);
    }
  }, [words, currentIndex, session?.accessToken, isSaving, trackEvent]);

  const handleUndo = useCallback(async () => {
    if (!lastAnswer || undoBusy) return;
    setUndoBusy(true);
    setUndoError('');

    try {
      await apiMutate(`/api/review/${lastAnswer.wordId}/undo`, {
        token: session?.accessToken,
        method: 'POST',
        body: { token: lastAnswer.undoToken },
        invalidate: ['/api/review/today', '/api/progress/streak'],
      });

      setSessionXp((value) => Math.max(0, value - lastAnswer.xpEarned));
      setRatings((value) => value.slice(0, -1));
      setIsFinished(false);
      setCurrentIndex(lastAnswer.index);
      setShowAnswer(true);
      setLastAnswer(null);
    } catch {
      setUndoError('Этот ответ уже нельзя отменить.');
      setLastAnswer(null);
    } finally {
      setUndoBusy(false);
    }
  }, [lastAnswer, undoBusy, session?.accessToken]);

  // Клавиатура: Space/Enter — ответ, 1–4 — оценка, Escape — пауза.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'Escape') {
        if (isFinished) return;
        event.preventDefault();
        setPaused((value) => !value);
        return;
      }

      if (paused || isFinished || isSaving || !currentWord) return;

      if (!showAnswer) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          setShowAnswer(true);
        }
        return;
      }

      const qualityByKey: Record<string, number> = { '1': 1, '2': 3, '3': 4, '4': 5 };
      const quality = qualityByKey[event.key];
      if (quality && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        void handleQuality(quality);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paused, isFinished, isSaving, currentWord, showAnswer, handleQuality]);

  if (isLoading && data === undefined) {
    return (
      <ReviewShell>
        <ReviewSkeleton />
      </ReviewShell>
    );
  }

  if (loadError && data === undefined) {
    return (
      <ReviewShell>
        <div className="card mt-4 p-6 sm:p-8">
          <ErrorState
            title="Расписание повторений не загрузилось"
            description="Сервер не прислал колоду на сегодня. Проверьте соединение и попробуйте снова."
            onRetry={refresh}
            action={
              <Button variant="secondary" href="/dictionary">
                К словарю
              </Button>
            }
          />
        </div>
      </ReviewShell>
    );
  }

  if (words.length === 0) {
    return (
      <ReviewShell>
        <div className="card mt-4 p-8 text-center">
          <LexiMascot pose="sleep" className="mx-auto mb-2 w-36" />
          <h1 className="mb-2 text-h1 text-ink">На сегодня слов нет</h1>
          <p className="mb-8 text-body-lg text-slate">
            Расписание пустое: все сохранённые слова уже повторены. Добавьте новые из читалки или словаря.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button href="/dictionary/add">Добавить слово</Button>
            <Button variant="secondary" href="/dictionary">
              К словарю
            </Button>
          </div>
        </div>
      </ReviewShell>
    );
  }

  if (isFinished) {
    const counts = QUALITY.map((item) => ({
      ...item,
      count: ratings.filter((rating) => rating === item.value).length,
    }));

    return (
      <ReviewShell>
        <motion.div
          variants={variants.enter}
          initial="hidden"
          animate="visible"
          className="card mt-4 p-8 text-center"
        >
          <LexiMascot pose="celebrate" className="mx-auto mb-1 w-40" />
          <h1 className="mb-2 text-h1 text-ink">Повторение завершено</h1>
          <p className="mb-1 text-body-lg text-slate">
            Повторено {formatNumber(words.length)} {pluralWords(words.length)}
          </p>
          <p className="mb-1 text-body font-semibold text-primary">
            +{formatNumber(sessionXp)} XP за сессию
          </p>
          {sessionXp > ratings.length && (
            <p className="text-caption text-slate">Включая бонус за дневную цель</p>
          )}

          <div className="mx-auto my-6 grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
            {counts.map((item) => (
              <div key={item.value} className="rounded-lg border border-hairline bg-surface p-3">
                <p className="text-h3 tabular-nums text-ink">{item.count}</p>
                <p className="text-caption text-slate">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Button href="/dictionary" className="h-11">К словарю</Button>
            <Button variant="secondary" href="/dashboard" className="h-11">
              На главную
            </Button>
          </div>

          {lastAnswer && (
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={undoBusy}
              className="mt-5 text-caption font-medium text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast hover:text-ink disabled:opacity-50"
            >
              {undoBusy ? 'Отменяем…' : 'Отменить последний ответ'}
            </button>
          )}
          {undoError && <p className="mt-3 text-caption text-semantic-error">{undoError}</p>}
        </motion.div>
      </ReviewShell>
    );
  }

  const progress = (ratings.length / words.length) * 100;

  return (
    <AppLayout immersive>
      <div className="min-h-[100dvh] bg-surface">
        <header className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setPaused(true)}
            className="icon-chip h-11 w-11"
            aria-label="Выйти из повторения"
            title="Выйти из повторения"
          >
            <ArrowLeftIcon size={20} />
          </button>
          <div className="text-center">
            <p className="text-caption font-semibold uppercase tracking-[0.16em] text-slate">Повторение</p>
            <p className="text-caption tabular-nums text-slate">
              Слово {currentIndex + 1} из {words.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPaused(true)}
            className="btn-secondary h-11 px-3 text-caption"
          >
            Пауза
          </button>
        </header>

        <main className="mx-auto w-full max-w-2xl px-4 pb-12 sm:px-6">
          <div className="mb-4">
            <div className="mb-2 flex justify-between text-caption text-slate">
              <span className="tabular-nums">Пройдено {ratings.length}</span>
              <span className="tabular-nums">{Math.round(progress)}%</span>
            </div>
            <ProgressBar value={progress} label={`Слово ${currentIndex + 1} из ${words.length}`} />
          </div>

          {saveError && (
            <div className="mb-4">
              <Notice tone="danger">{saveError}</Notice>
            </div>
          )}

          <span className="sr-only" aria-live="polite">
            {currentWord?.text}. Слово {currentIndex + 1} из {words.length}
          </span>

          <AnimatePresence mode="wait" custom={1}>
            <motion.div
              key={currentWord?.wordId}
              variants={slideVariants(1)}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="card flex min-h-[20rem] flex-col p-6 text-center sm:min-h-[22rem] sm:p-10"
            >
              <div className="flex flex-col items-center">
                <div className="mb-4 flex min-h-6 flex-wrap items-center justify-center gap-2">
                  {currentWord?.isNew && <Tag tone="info">Новое слово</Tag>}
                  {currentWord?.isLeech && <Tag tone="warning">Трудное слово</Tag>}
                  {currentWord?.definitions[0]?.partOfSpeech && (
                    <Tag tone="neutral">{currentWord.definitions[0].partOfSpeech}</Tag>
                  )}
                </div>

                {currentWord && (currentWord.emoji || currentWord.imageUrl) && (
                  <div className="mb-4">
                    <WordVisual
                      word={currentWord.text}
                      emoji={currentWord.emoji}
                      imageUrl={currentWord.imageUrl}
                      size="lg"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <h1 className="break-words text-h1 text-ink">
                    <button
                      type="button"
                      onClick={() => currentWord && speak(currentWord.text)}
                      className="transition-colors duration-fast hover:text-primary"
                    >
                      {currentWord?.text}
                    </button>
                  </h1>
                  <button
                    type="button"
                    onClick={() => currentWord && speak(currentWord.text)}
                    className="icon-chip shrink-0 border-transparent bg-transparent hover:bg-surface"
                    title="Произнести"
                    aria-label="Произнести слово"
                  >
                    {isSpeakingLoading
                      ? <SpinnerIcon size={20} className="animate-spin" label="Озвучиваем" />
                      : <VolumeIcon size={20} />}
                  </button>
                </div>
                <p className="mt-2 text-caption text-slate">Нажмите на слово или динамик, чтобы услышать</p>
              </div>

              <div className="mt-6 flex flex-1 flex-col justify-center border-t border-hairline pt-6">
                <AnimatePresence mode="wait">
                  {showAnswer ? (
                    <motion.div
                      key="answer"
                      variants={variants.fadeOnly}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="space-y-5"
                    >
                      {currentWord?.definitions.length ? (
                        currentWord.definitions.map((definition, index) => (
                          <div key={`${definition.definition}-${index}`}>
                            <p className="text-h3 text-ink">{definition.definition}</p>
                            {definition.partOfSpeech && index > 0 && (
                              <span className="mt-1 inline-block">
                                <Tag tone="neutral">{definition.partOfSpeech}</Tag>
                              </span>
                            )}
                            {definition.example && (
                              <div className="mt-2">
                                <p className="text-body italic text-slate">«{definition.example}»</p>
                                <button
                                  type="button"
                                  onClick={() => speak(definition.example!)}
                                  className="mx-auto mt-1 inline-flex items-center gap-1.5 text-body-sm font-medium text-primary hover:underline"
                                >
                                  <VolumeIcon size={16} />
                                  Озвучить пример
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-body-sm text-slate">Перевод для этого слова пока не добавлен.</p>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="question"
                      variants={variants.fadeOnly}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="flex flex-col items-center gap-3"
                    >
                      <Button variant="primary" onClick={() => setShowAnswer(true)} className="h-12 px-6">
                        Показать ответ
                      </Button>
                      <span className="text-caption text-slate">
                        или нажмите пробел
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </AnimatePresence>

          {showAnswer && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {QUALITY.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void handleQuality(option.value)}
                  disabled={isSaving}
                  aria-keyshortcuts={option.key}
                  className={`flex h-12 items-center justify-center gap-1.5 rounded-lg text-body-sm font-semibold transition-[background-color,color,transform] duration-fast ease-soft active:scale-97 disabled:cursor-not-allowed disabled:opacity-60 ${option.className}`}
                >
                  {option.label}
                  <kbd className="hidden rounded border border-current px-1 text-[11px] font-normal opacity-70 sm:inline-block">
                    {option.key}
                  </kbd>
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {lastAnswer ? (
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={undoBusy || isSaving}
                className="text-caption font-medium text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast hover:text-ink disabled:opacity-50"
              >
                {undoBusy ? 'Отменяем…' : 'Отменить последний ответ'}
              </button>
            ) : (
              <span />
            )}
            <p className="hidden text-caption text-slate sm:block">
              1–4 — оценка · Пробел — показать ответ · Esc — пауза
            </p>
          </div>
          {undoError && <p className="mt-2 text-caption text-semantic-error">{undoError}</p>}
        </main>

        <AnimatePresence>
          {paused && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPaused(false)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="pause-title"
                className="card w-full max-w-sm p-6"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="pause-title" className="text-h2 text-ink">Пауза</h2>
                <p className="mt-2 text-body-sm leading-relaxed text-slate">
                  Пройдено {ratings.length} из {words.length}. Ответы сохранены,
                  можно продолжить с этого же слова или выйти.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <Button autoFocus onClick={() => setPaused(false)} className="h-11 flex-1">
                    Продолжить
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => router.push('/dictionary')}
                    className="h-11 flex-1"
                  >
                    Выйти
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}

/** Скелетон повторяет фокусный экран: та же шапка, прогресс и карточка. */
function ReviewSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-4">
      <span className="sr-only">Загрузка слов на сегодня</span>
      <div className="mb-2 flex justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-10" />
      </div>
      <Skeleton className="mb-5 h-2 w-full rounded-full" />
      <div className="card flex min-h-[20rem] flex-col p-6 text-center sm:min-h-[22rem] sm:p-10">
        <Skeleton className="mx-auto mb-4 h-5 w-16 rounded-full" />
        <Skeleton className="mx-auto mb-3 h-10 w-56" />
        <Skeleton className="mx-auto mb-8 h-4 w-40" />
        <div className="mt-auto flex justify-center">
          <Skeleton className="h-11 w-40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
