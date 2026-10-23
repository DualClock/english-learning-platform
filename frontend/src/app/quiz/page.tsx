'use client';

import AppLayout from '@/components/AppLayout';
import LexiPeek from '@/components/brand/lexi/LexiPeek';
import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, apiMutate } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import { useTts } from '@/hooks/useTts';
import { pluralQuestions, pluralWords } from '@/lib/plural';
import { slideVariants, variants } from '@/lib/motion';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Notice from '@/components/ui/Notice';
import ProgressBar from '@/components/ui/ProgressBar';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Skeleton } from '@/components/ui/LoadingState';
import {
  BookOpenIcon,
  CheckCircleIcon,
  CloseCircleIcon,
  HeadphonesIcon,
  InboxIcon,
  SpinnerIcon,
  VolumeIcon,
} from '@/components/ui/icons';

interface Question {
  wordId: number;
  text: string;
  options: string[];
  correctIndex: number;
}

interface QuizResponse {
  questions?: Question[];
  quizToken?: string;
  // Поля чекпоинта: обычный quiz их не присылает
  level?: string;
  reason?: string;
  passScore?: number;
  totalQuestions?: number;
  matchedWords?: number;
  dictionaryWords?: number;
}

interface QuizResultResponse {
  xpEarned: number;
  goalBonus: number;
  total: number;
  correct: number;
}

type QuizMode = 'reading' | 'listening';
type ResultState = 'idle' | 'saving' | 'saved' | 'error';

const LEVEL_LABELS: Record<string, string> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
};

function QuizContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Отдельный маршрут /listening открывает то же упражнение сразу в режиме
  // аудирования. Чекпоинт остаётся только у /quiz — там это чтение уровня.
  const isListeningRoute = pathname === '/listening';
  const mode: QuizMode = isListeningRoute ? 'listening' : 'reading';

  // ?checkpoint=b1 переключает страницу в режим чекпоинт-теста уровня:
  // те же вопросы quiz, но отобранные по CEFR-уровню слов пользователя
  const checkpointLevel = !isListeningRoute
    ? (searchParams.get('checkpoint') ?? '').trim().toLowerCase() || null
    : null;
  const levelLabel = checkpointLevel ? LEVEL_LABELS[checkpointLevel] ?? checkpointLevel.toUpperCase() : null;

  // Колода теста всегда запрашивается свежей: maxAgeMs: 0. Ответы нигде
  // не сохраняются, поэтому между заходами вопросы не «залипают».
  const { data, error, isLoading, refresh: refreshQuiz } = useApiQuery<QuizResponse>(
    checkpointLevel
      ? `/api/practice/checkpoint?level=${encodeURIComponent(checkpointLevel)}`
      : '/api/review/quiz?count=10',
    {
      maxAgeMs: 0,
      enabled: status === 'authenticated',
    }
  );

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [nod, setNod] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [deckLocked, setDeckLocked] = useState(false);
  const [quizToken, setQuizToken] = useState<string | null>(null);
  const [resultState, setResultState] = useState<ResultState>('idle');
  const [resultXp, setResultXp] = useState(0);
  const [resultError, setResultError] = useState('');
  const resultInFlightRef = useRef(false);

  const { play, isLoading: audioLoading } = useTts();

  // Один раз сохраняем загруженную колоду в state и работаем с ней: фоновое
  // обновление не должно подменять вопросы посреди прохождения.
  useEffect(() => {
    if (!data || deckLocked) return;
    setQuestions(data.questions ?? []);
    setQuizToken(data.quizToken ?? null);
  }, [data, deckLocked]);

  const deck = useMemo(
    () => questions ?? data?.questions ?? [],
    [questions, data?.questions],
  );

  const handleAnswer = useCallback((index: number) => {
    if (showResult) return;

    // Дальше колода зафиксирована — поздний ответ сети её не заменит.
    setDeckLocked(true);
    setSelectedAnswer(index);
    setShowResult(true);

    if (index === deck[currentIndex]?.correctIndex) {
      setScore((value) => value + 1);
      setNod((value) => value + 1);
    }
  }, [showResult, deck, currentIndex]);

  const saveResult = useCallback(async () => {
    if (!quizToken || resultInFlightRef.current || resultState === 'saved') return;

    resultInFlightRef.current = true;
    setResultState('saving');
    setResultError('');

    try {
      const result = await apiMutate<QuizResultResponse>('/api/review/quiz/result', {
        token: session?.accessToken,
        method: 'POST',
        body: {
          token: quizToken,
          correct: score,
          mode,
        },
        invalidate: ['/api/review/quiz/history'],
      });

      setResultXp((result?.xpEarned ?? 0) + (result?.goalBonus ?? 0));
      setResultState('saved');
    } catch (error) {
      setResultError(
        error instanceof ApiError
          ? error.message
          : 'Результат не сохранился. Проверьте соединение и попробуйте ещё раз.',
      );
      setResultState('error');
    } finally {
      resultInFlightRef.current = false;
    }
  }, [quizToken, resultState, score, mode, session?.accessToken]);

  const handleNext = useCallback(() => {
    if (currentIndex < deck.length - 1) {
      setCurrentIndex((index) => index + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setIsFinished(true);
      // Один завершённый тест — один серверный результат. Токен выдаётся
      // вместе с колодой и принимается только один раз.
      void saveResult();
    }
  }, [currentIndex, deck.length, saveResult]);

  const restartHref = checkpointLevel
    ? `/quiz?checkpoint=${encodeURIComponent(checkpointLevel)}`
    : mode === 'listening'
      ? '/listening'
      : '/quiz';

  // Режим аудирования: слово не показываем — звучит озвучка, варианты остаются
  // переводами. Переозвучиваем при переходе к следующему вопросу.
  useEffect(() => {
    if (mode !== 'listening' || isFinished) return;
    const question = deck[currentIndex];
    if (!question) return;
    const timer = window.setTimeout(() => {
      void play(question.text);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentIndex, isFinished, deck.length]);

  // Ответы с клавиатуры: 1–4 выбирают вариант, Enter продолжает,
  // пробел в аудировании повторяет слово, пока ответ не выбран.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (isFinished) return;

      if (!showResult && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        handleAnswer(Number(event.key) - 1);
        return;
      }

      if (!showResult && mode === 'listening' && event.key === ' ') {
        const question = deck[currentIndex];
        if (!question) return;
        event.preventDefault();
        void play(question.text);
        return;
      }

      if (showResult && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deck, currentIndex, handleAnswer, handleNext, isFinished, mode, play, showResult]);

  // Скелет — только пока данных ещё нет
  if (isLoading && data === undefined) {
    return (
      <AppLayout>
        <QuizSkeleton />
      </AppLayout>
    );
  }

  // Ошибка загрузки — показываем её и даём повторить, а не уводим молча
  if (error && data === undefined) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <ErrorState
            title="Тест не загрузился"
            description={error}
            onRetry={refreshQuiz}
            action={
              <Button variant="secondary" href="/dictionary">
                В словарь
              </Button>
            }
          />
        </div>
      </AppLayout>
    );
  }

  // Колода пустая — не крутим вечный спиннер, а объясняем, что делать
  if (deck.length === 0) {
    const checkpointStats = checkpointLevel && data
      ? ` Сейчас в словаре ${data.dictionaryWords ?? 0} ${pluralWords(data.dictionaryWords ?? 0)}` +
        (data.matchedWords != null ? `, из них уровня ${levelLabel} — ${data.matchedWords}.` : '.')
      : '';

    return (
      <AppLayout>
        <EmptyState
          icon={<InboxIcon size={24} />}
          title={
            checkpointLevel
              ? `Чекпоинт ${levelLabel} пока недоступен`
              : mode === 'listening'
                ? 'Пока нечего слушать'
                : 'Пока нечего тестировать'
          }
          description={(checkpointLevel
            ? 'Для чекпоинта нужно хотя бы 4 слова с переводами в словаре — иначе не собрать варианты ответов.'
            : mode === 'listening'
              ? 'Для аудирования нужно хотя бы 4 слова с переводами в словаре — иначе не собрать варианты. Добавьте слова из книги или сборника.'
              : 'Для теста нужно хотя бы 4 слова в словаре. Добавьте слова из книги или готового сборника — и возвращайтесь.') + checkpointStats}
          action={
            <>
              <Button href="/dictionary?tab=lists">Открыть сборники</Button>
              <Button href="/dictionary" variant="secondary">
                Мой словарь
              </Button>
            </>
          }
        />
      </AppLayout>
    );
  }

  if (isFinished) {
    const percentage = Math.round((score / deck.length) * 100);
    const passed = checkpointLevel ? score >= (data?.passScore ?? Math.ceil(deck.length * 0.8)) : percentage >= 80;
    const passScore = data?.passScore ?? Math.ceil(deck.length * 0.8);
    const tone = passed
      ? 'bg-surface-accent text-on-accent'
      : percentage >= 50
        ? 'bg-surface-warning text-on-warning'
        : 'bg-surface-danger text-on-danger';
    // Число не должно выглядеть фирменной зеленью там, где тест не сдан.
    const numberTone = passed ? 'text-primary' : percentage >= 50 ? 'text-semantic-warning' : 'text-semantic-error';

    return (
      <AppLayout>
        <motion.div
          variants={variants.enter}
          initial="hidden"
          animate="visible"
          className="mx-auto max-w-md py-12 text-center"
        >
          <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-lg ${tone}`}>
            {passed ? <CheckCircleIcon size={24} /> : <CloseCircleIcon size={24} />}
          </div>
          <h1 className="mb-2 text-h1 text-ink">
            {checkpointLevel
              ? `Чекпоинт ${levelLabel}: ${passed ? 'сдан' : 'не сдан'}`
              : mode === 'listening'
                ? 'Аудирование завершено'
                : 'Тест завершён'}
          </h1>
          <p className={`my-4 text-h1 tabular-nums ${numberTone}`}>
            <AnimatedNumber value={percentage} />%
          </p>
          <p className="mb-2 text-body-lg text-slate">
            Верных ответов {score} из {deck.length}
          </p>
          {checkpointLevel && (
            <p className="mb-8 text-body-sm text-slate">
              {passed
                ? `Порог ${passScore} пройден — уровень ${levelLabel} можно подтверждать дальше.`
                : `Для зачёта нужно ${passScore} верных ответов из ${deck.length}. Повторите слова уровня и попробуйте снова.`}
            </p>
          )}

          {quizToken && (
            <div className="mb-8 mt-4">
              {resultState === 'saving' && (
                <p role="status" className="flex items-center justify-center gap-2 text-body-sm text-slate">
                  <SpinnerIcon size={16} />
                  Сохраняем результат…
                </p>
              )}
              {resultState === 'saved' && (
                <p role="status" className="text-body-sm font-medium text-semantic-success">
                  Результат сохранён{resultXp > 0 ? ` · +${resultXp} XP` : ''}
                </p>
              )}
              {resultState === 'error' && (
                <div className="space-y-2 text-left">
                  <Notice tone="danger">{resultError}</Notice>
                  <div className="text-center">
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => {
                        setResultError('');
                        void saveResult();
                      }}
                    >
                      Повторить сохранение
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button
              className="min-h-11"
              onClick={() => window.location.assign(restartHref)}
              disabled={resultState === 'saving'}
            >
              Ещё раз
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => router.push('/dashboard')}
              disabled={resultState === 'saving'}
            >
              На главную
            </Button>
          </div>
        </motion.div>
      </AppLayout>
    );
  }

  const currentQuestion = deck[currentIndex];
  const answered = selectedAnswer === currentQuestion.correctIndex;

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        {checkpointLevel && (
          <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-caption uppercase tracking-wide text-slate">Чекпоинт-тест</p>
              <p className="text-h3 text-ink">
                Уровень {levelLabel} · {deck.length} {pluralQuestions(deck.length)}
              </p>
            </div>
            <div className="text-right text-body-sm text-slate">
              <p>
                Порог: <strong className="font-semibold text-ink">{data?.passScore ?? Math.ceil(deck.length * 0.8)}</strong> верных
              </p>
              {data?.matchedWords != null && (
                <p>
                  Слов {levelLabel} в словаре: <strong className="font-semibold text-ink">{data.matchedWords}</strong>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Режим: чтение или аудирование */}
        {!checkpointLevel && (
          <nav className="mb-6 flex justify-center gap-2" aria-label="Режим теста">
            {([
              { id: 'reading', href: '/quiz', label: 'Чтение', icon: <BookOpenIcon size={16} /> },
              { id: 'listening', href: '/listening', label: 'Аудирование', icon: <HeadphonesIcon size={16} /> },
            ] as const).map((option) => (
              <Link
                key={option.id}
                href={option.href}
                aria-current={mode === option.id ? 'page' : undefined}
                className={`${mode === option.id ? 'pill-tab-active' : 'pill-tab'} min-h-11`}
              >
                {option.icon}
                {option.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Прогресс */}
        <div className="mb-8 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex justify-between text-body-sm text-slate">
              <span className="tabular-nums">Вопрос {currentIndex + 1} из {deck.length}</span>
              <span className="tabular-nums">Верных: {score}</span>
            </div>
            <ProgressBar
              value={((currentIndex + 1) / deck.length) * 100}
              label={`Отвечено ${currentIndex + 1} из ${deck.length}`}
            />
          </div>
          <LexiPeek
            mood={showResult ? (answered ? 'happy' : 'thinking') : 'neutral'}
            reaction={nod}
            className="w-12 shrink-0"
          />
        </div>

        {/* Вопрос */}
        <AnimatePresence mode="wait" custom={1}>
          <motion.div
            key={`${currentQuestion.wordId}-${currentIndex}`}
            variants={slideVariants(1)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="card p-8"
          >
            <h1 className="mb-4 text-center text-body text-slate">
              {mode === 'listening'
                ? 'Выберите перевод того, что слышите:'
                : 'Выберите правильный перевод:'}
            </h1>

            {mode === 'listening' ? (
              <div className="mb-8 flex flex-col items-center">
                <button
                  onClick={() => play(currentQuestion.text)}
                  disabled={audioLoading}
                  aria-label="Прослушать слово"
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-on-primary transition-transform duration-fast ease-soft hover:bg-primary-pressed active:scale-97 disabled:opacity-60"
                >
                  {audioLoading ? (
                    <SpinnerIcon size={24} className="animate-spin" label="Загрузка озвучки" />
                  ) : (
                    <VolumeIcon size={24} />
                  )}
                </button>
                <button
                  onClick={() => play(currentQuestion.text)}
                  className="mt-3 inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-slate transition-colors duration-fast hover:text-primary"
                >
                  Прослушать ещё раз
                </button>
                <AnimatePresence>
                  {showResult && (
                    <motion.p
                      variants={variants.fadeOnly}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="mt-4 text-h2 text-ink"
                    >
                      {currentQuestion.text}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                onClick={() => play(currentQuestion.text)}
                className="mx-auto mb-8 flex items-center justify-center gap-3 text-h1 text-ink transition-colors duration-fast hover:text-primary"
              >
                {currentQuestion.text}
                <VolumeIcon size={20} className="text-slate" />
              </button>
            )}

            {/* Варианты ответов */}
            <div className="space-y-3">
              {currentQuestion.options.map((option, index) => {
                const isCorrect = index === currentQuestion.correctIndex;
                const isChosen = index === selectedAnswer;
                let tone = 'border-hairline-strong text-ink hover:border-primary hover:bg-surface-accent';
                if (showResult) {
                  if (isCorrect) tone = 'border-semantic-success bg-surface-success text-on-success';
                  else if (isChosen) tone = 'border-semantic-error bg-surface-danger text-on-danger';
                  else tone = 'border-hairline-strong text-slate';
                }

                return (
                  <motion.button
                    key={index}
                    onClick={() => handleAnswer(index)}
                    disabled={showResult}
                    whileTap={{ scale: 0.99 }}
                    aria-keyshortcuts={String(index + 1)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-lg border-2 p-4 text-left transition-[background-color,border-color,color] duration-fast ease-soft ${tone}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-caption font-semibold ${
                        showResult && isCorrect
                          ? 'border-semantic-success'
                          : showResult && isChosen
                            ? 'border-semantic-error'
                            : 'border-current opacity-60'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 font-medium">{option}</span>
                  </motion.button>
                );
              })}
            </div>

            <p className="mt-4 text-center text-caption text-slate">
              {showResult
                ? 'Enter — следующий вопрос'
                : `1–4 — выбрать ответ${mode === 'listening' ? ' · Пробел — повторить слово' : ''}`}
            </p>

            {/* Результат ответа */}
            <AnimatePresence>
              {showResult && (
                <motion.div
                  variants={variants.enter}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="mt-6 text-center"
                >
                  <p className={`text-h3 ${answered ? 'text-semantic-success' : 'text-semantic-error'}`}>
                    {answered
                      ? 'Верно'
                      : `Неверно. Правильный ответ: ${currentQuestion.options[currentQuestion.correctIndex]}`}
                  </p>
                  <Button className="mt-4" onClick={handleNext}>
                    {currentIndex < deck.length - 1 ? 'Следующий вопрос' : 'Завершить'}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}

/** Скелет повторяет карточку теста: тот же блок вопроса и столбик вариантов. */
function QuizSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-2xl animate-page-in">
      <span className="sr-only">Загрузка вопросов теста</span>
      <div className="mb-6 flex justify-center gap-2">
        <Skeleton className="h-10 w-24 rounded-md" />
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-8 h-2 w-full rounded-full" />
      <div className="card p-8">
        <Skeleton className="mx-auto mb-4 h-4 w-56" />
        <Skeleton className="mx-auto mb-8 h-10 w-64" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="mb-3 h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// useSearchParams требует Suspense-границы при статическом рендере
export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <QuizSkeleton />
        </AppLayout>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
