'use client';

import AppLayout from '@/components/AppLayout';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useTrack } from '@/app/lib/analytics';
import { useSpeech } from '@/hooks/useSpeech';
import { useApiQuery } from '@/app/lib/use-api';
import { apiMutate } from '@/app/lib/api-client';
import { pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';
import { slideVariants, variants } from '@/lib/motion';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import ProgressBar from '@/components/ui/ProgressBar';
import { Tag } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/LoadingState';
import { AlertIcon, VolumeIcon } from '@/components/ui/icons';

interface Word {
  wordId: number;
  text: string;
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

export default function ReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const trackEvent = useTrack();
  const { speak } = useSpeech();

  // Сессия повторения: колода всегда запрашивается свежей (maxAgeMs: 0),
  // но после первой загрузки работаем с локальным снимком — ответы и позиция
  // не должны «мигать» из-за фонового обновления или перерисовок.
  const { data, error: loadError, isLoading, refresh } = useApiQuery<ReviewTodayResponse>('/api/review/today', {
    maxAgeMs: 0,
    enabled: status === 'authenticated',
  });

  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [nextHint, setNextHint] = useState('');
  const [reviewCount, setReviewCount] = useState(0);
  const [newCount, setNewCount] = useState(0);

  // Один раз сохраняем загруженную колоду в state и дальше работаем с ней.
  useEffect(() => {
    if (!data || sessionStarted) return;
    setWords(data.words ?? []);
    setTotalCount(data.totalCount ?? data.words?.length ?? 0);
    setReviewCount(data.reviewCount ?? 0);
    setNewCount(data.newCount ?? 0);
  }, [data, sessionStarted]);

  // Авто-озвучка при показе нового слова
  useEffect(() => {
    if (words.length > 0 && currentIndex < words.length) {
      speak(words[currentIndex].text);
    }
  }, [currentIndex, words, speak]);

  const handleQuality = async (quality: number) => {
    const word = words[currentIndex];
    if (!word) return;

    setSessionStarted(true);
    setSaveError('');

    try {
      const outcome = await apiMutate<{ interval: number; intervalMinutes: number }>(
        `/api/review/${word.wordId}/quality/${quality}`,
        {
          token: session?.accessToken,
          method: 'POST',
          invalidate: ['/api/review/today', '/api/progress/streak'],
        }
      );
      trackEvent('word_reviewed', word.text);

      setNextHint(
        outcome?.intervalMinutes && outcome.intervalMinutes > 0
          ? `Следующее повторение через ${outcome.intervalMinutes} мин — слово вернётся в этой сессии`
          : `Следующее повторение через ${outcome?.interval ?? 1} дн.`
      );

      if (currentIndex < words.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setShowAnswer(false);
      } else {
        setIsFinished(true);
      }
    } catch {
      setSaveError('Не удалось сохранить ответ. Проверьте соединение и попробуйте ещё раз.');
    }
  };

  // Скелетон/спиннер — только пока данных ещё нет
  if (isLoading && data === undefined) {
    return (
      <AppLayout>
        <ReviewSkeleton />
      </AppLayout>
    );
  }

  if (loadError && data === undefined) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <ErrorState
            title="Расписание повторений не загрузилось"
            description="Сервер не прислал колоду на сегодня. Проверьте соединение и попробуйте снова."
            onRetry={refresh}
          />
        </div>
      </AppLayout>
    );
  }

  if (isFinished) {
    return (
      <AppLayout>
        <motion.div
          variants={variants.enter}
          initial="hidden"
          animate="visible"
          className="mx-auto max-w-md py-12 text-center"
        >
          <LexiMascot pose="celebrate" className="mx-auto mb-1 w-40" />
          <h1 className="mb-2 text-h1 text-ink">Повторение завершено</h1>
          <p className="mb-8 text-body-lg text-slate">
            Повторено {formatNumber(words.length)} {pluralWords(words.length)}
          </p>
          <Button onClick={() => router.push('/dashboard')}>На главную</Button>
        </motion.div>
      </AppLayout>
    );
  }

  if (words.length === 0) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md py-12 text-center">
          <LexiMascot pose="sleep" className="mx-auto mb-2 w-36" />
          <h1 className="mb-2 text-h1 text-ink">На сегодня слов нет</h1>
          <p className="mb-8 text-body-lg text-slate">
            Расписание пустое: все сохранённые слова уже повторены. Добавьте новые — из читалки или вручную.
          </p>
          <Button href="/dictionary/add">Добавить слово</Button>
        </div>
      </AppLayout>
    );
  }

  const currentWord = words[currentIndex];

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        {saveError && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-semantic-error bg-surface-danger p-4 text-body-sm text-on-danger"
          >
            <AlertIcon size={20} />
            <span>{saveError}</span>
          </div>
        )}

        {/* Прогресс */}
        <div className="mb-8">
          <div className="mb-2 flex justify-between text-body-sm text-slate">
            <span className="tabular-nums">Слово {currentIndex + 1} из {words.length}</span>
            <span>
              {reviewCount > 0 || newCount > 0
                ? `${reviewCount} на повторение · ${newCount} ${pluralWords(newCount)}`
                : `Всего на сегодня: ${totalCount}`}
            </span>
          </div>
          <ProgressBar
            value={((currentIndex + 1) / words.length) * 100}
            label={`Пройдено ${currentIndex + 1} из ${words.length}`}
          />
          {nextHint && (
            <p className="mt-2 text-caption text-slate">{nextHint}</p>
          )}
        </div>

        {/* Карточка */}
        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={currentWord.wordId}
            variants={slideVariants(1)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="card mb-6 p-8"
          >
            <div className="mb-6 text-center">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <h1 className="break-words text-h1 text-ink">
                  <button
                    onClick={() => speak(currentWord.text)}
                    className="transition-colors duration-fast hover:text-primary"
                  >
                    {currentWord.text}
                  </button>
                </h1>
                <button
                  onClick={() => speak(currentWord.text)}
                  className="icon-chip shrink-0 border-transparent bg-transparent hover:bg-surface"
                  title="Произнести"
                  aria-label="Произнести слово"
                >
                  <VolumeIcon size={20} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {currentWord.isNew && <Tag tone="info">Новое слово</Tag>}
                {currentWord.isLeech && <Tag tone="warning">Трудное слово</Tag>}
              </div>
              <p className="mt-2 text-body-sm text-slate">Нажмите на слово, чтобы услышать</p>
            </div>

            <AnimatePresence mode="wait">
              {showAnswer ? (
                <motion.div
                  key="answer"
                  variants={variants.fadeOnly}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="border-t border-hairline pt-6"
                >
                  {currentWord.definitions.map((def, idx) => (
                    <div key={idx} className="text-center">
                      <p className="text-h3 text-ink">{def.definition}</p>
                      {def.partOfSpeech && (
                        <span className="mt-2 inline-block">
                          <Tag tone="neutral">{def.partOfSpeech}</Tag>
                        </span>
                      )}
                      {def.example && (
                        <div className="mt-4">
                          <p className="text-body text-slate italic">«{def.example}»</p>
                          <button
                            onClick={() => speak(def.example!)}
                            className="mx-auto mt-1 inline-flex items-center gap-1.5 text-body-sm font-medium text-primary hover:underline"
                          >
                            <VolumeIcon size={16} />
                            Озвучить пример
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="question"
                  variants={variants.fadeOnly}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="text-center"
                >
                  <Button variant="secondary" onClick={() => setShowAnswer(true)}>
                    Показать ответ
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>

        {/* Оценка ответа: от «забыл» к «легко» цвет идёт по той же шкале, что и состояния */}
        {showAnswer && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUALITY.map((option) => (
              <button
                key={option.value}
                onClick={() => handleQuality(option.value)}
                className={`h-12 rounded-lg text-body font-semibold transition-[background-color,color,transform] duration-fast ease-soft active:scale-97 ${option.className}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

const QUALITY = [
  { value: 1, label: 'Забыл', className: 'bg-surface-danger text-on-danger hover:bg-semantic-error hover:text-on-primary' },
  { value: 3, label: 'Трудно', className: 'bg-surface-warning text-on-warning hover:bg-surface-highlight' },
  { value: 4, label: 'Хорошо', className: 'bg-surface-success text-on-success hover:bg-semantic-success hover:text-on-primary' },
  { value: 5, label: 'Легко', className: 'bg-primary text-on-primary hover:bg-primary-pressed' },
];

/** Скелет повторяет карточку повторения: та же колонка и тот же ритм. */
function ReviewSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-2xl animate-page-in">
      <span className="sr-only">Загрузка слов на сегодня</span>
      <Skeleton className="mb-2 h-4 w-48" />
      <Skeleton className="mb-8 h-2 w-full rounded-full" />
      <div className="card p-8 text-center">
        <Skeleton className="mx-auto mb-4 h-10 w-56" />
        <Skeleton className="mx-auto mb-8 h-4 w-40" />
        <Skeleton className="mx-auto h-11 w-40 rounded-lg" />
      </div>
    </div>
  );
}
