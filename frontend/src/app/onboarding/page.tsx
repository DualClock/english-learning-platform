'use client';

import Button from '@/components/ui/Button';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger';
import Notice from '@/components/ui/Notice';
import ProgressBar from '@/components/ui/ProgressBar';
import {
  BookOpenIcon,
  BriefcaseIcon,
  BulbIcon,
  CheckIcon,
  FilmIcon,
  HomeIcon,
  NotebookIcon,
  PlaneIcon,
  SpeechIcon,
  SpinnerIcon,
  TargetIcon,
  type IconProps,
} from '@/components/ui/icons';
import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';
import { useTrack } from '@/app/lib/analytics';

type Step = 'level' | 'placement' | 'goal' | 'time' | 'account' | 'processing' | 'welcome';

interface PlacementQuestion {
  id: number;
  prompt: string;
  options: string[];
}

interface PlacementResult {
  cefrLevel: string;
  correctCount: number;
  total: number;
}

const levels = [
  { value: 'a1', name: 'A1 — Начальный', description: 'Я понимаю простые фразы' },
  { value: 'a2', name: 'A2 — Элементарный', description: 'Я могу вести базовый диалог' },
  { value: 'b1', name: 'B1 — Средний', description: 'Я понимаю основные идеи' },
  { value: 'b2', name: 'B2 — Выше среднего', description: 'Я свободно общаюсь' },
  { value: 'c1', name: 'C1 — Продвинутый', description: 'Я понимаю сложный текст' },
];

const goals: { value: string; name: string; Icon: (p: IconProps) => JSX.Element }[] = [
  { value: 'work', name: 'Для работы', Icon: BriefcaseIcon },
  { value: 'travel', name: 'Для путешествий', Icon: PlaneIcon },
  { value: 'study', name: 'Для учёбы', Icon: NotebookIcon },
  { value: 'life', name: 'Для повседневной жизни', Icon: HomeIcon },
  { value: 'movies', name: 'Фильмы и сериалы', Icon: FilmIcon },
  { value: 'books', name: 'Читать книги', Icon: BookOpenIcon },
  { value: 'friends', name: 'Общение с людьми', Icon: SpeechIcon },
  { value: 'brain', name: 'Тренировка мозга', Icon: BulbIcon },
];

const timeOptions = [
  { value: '5-10', name: '5–10 минут в день', minutes: 10 },
  { value: '15-20', name: '15–20 минут в день', minutes: 20 },
  { value: '30+', name: '30+ минут в день', minutes: 30 },
];

const goalName = (value: string) => goals.find((g) => g.value === value)?.name ?? value;

const levelLabel = (value: string) =>
  levels.find((l) => l.value === value)?.name.split(' — ')[0].toUpperCase() || value.toUpperCase();

/**
 * Вариант с одиночным выбором: уровень, вопрос теста и время занятий —
 * одна карточка на все три шага, чтобы выбор не выглядел по-разному.
 */
function OptionCard({
  selected,
  title,
  description,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-4 rounded-lg border p-5 text-left transition-[background-color,border-color] duration-fast ease-soft ${
        selected
          ? 'border-primary bg-surface-success'
          : 'border-hairline-strong bg-canvas hover:border-primary'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{title}</span>
        {description && <span className="mt-1 block text-body-sm text-slate">{description}</span>}
      </span>
      {selected && <CheckIcon size={20} className="shrink-0 text-primary" />}
    </button>
  );
}

/** Заголовок шага: вопрос сверху, пояснение и, если нужно, счётчик выбора под ним. */
function StepHeading({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-h1 text-ink">{title}</h1>
      <p className="mt-2 max-w-measure text-body text-slate">{hint}</p>
      {children && <p className="mt-1 text-caption text-slate">{children}</p>}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const trackEvent = useTrack();
  const [step, setStep] = useState<Step>('level');
  const [data, setData] = useState({
    level: '',
    goals: [] as string[],
    time: '',
    name: '',
    email: '',
    password: '',
    notifications: false,
  });
  const [accountError, setAccountError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Тест уровня
  const [placementQuestions, setPlacementQuestions] = useState<PlacementQuestion[]>([]);
  const [placementIndex, setPlacementIndex] = useState(0);
  const [placementChoice, setPlacementChoice] = useState<number | null>(null);
  const [placementAnswers, setPlacementAnswers] = useState<{ id: number; choice: number }[]>([]);
  const [placementResult, setPlacementResult] = useState<PlacementResult | null>(null);
  const [placementError, setPlacementError] = useState('');
  const [isPlacementLoading, setIsPlacementLoading] = useState(false);

  const totalSteps = 4;
  /* Тест на уровень — часть первого шага, а не пятый: иначе полоса врёт «Шаг 4 из 4» в самом начале */
  const STEP_NUMBER: Record<Step, number> = {
    level: 1,
    placement: 1,
    goal: 2,
    time: 3,
    account: 4,
    processing: 4,
    welcome: 4,
  };
  const currentStepNumber = STEP_NUMBER[step];

  const startPlacement = async () => {
    setPlacementError('');
    setIsPlacementLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/profile/placement`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = await res.json();
      setPlacementQuestions(body.questions || []);
      setPlacementIndex(0);
      setPlacementChoice(null);
      setPlacementAnswers([]);
      setPlacementResult(null);
      setStep('placement');
    } catch {
      setPlacementError('Не удалось загрузить тест. Попробуйте ещё раз или выберите уровень вручную.');
    } finally {
      setIsPlacementLoading(false);
    }
  };

  const submitPlacementAnswer = async () => {
    if (placementChoice === null) return;
    const answers = [...placementAnswers, { id: placementQuestions[placementIndex].id, choice: placementChoice }];
    setPlacementAnswers(answers);

    if (placementIndex < placementQuestions.length - 1) {
      setPlacementIndex(placementIndex + 1);
      setPlacementChoice(null);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/profile/placement/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const result: PlacementResult = await res.json();
      setPlacementResult(result);
    } catch {
      setPlacementError('Не удалось отправить результаты. Попробуйте ещё раз.');
    }
  };

  const handleNext = () => {
    if (step === 'level') setStep('goal');
    else if (step === 'goal') setStep('time');
    else if (step === 'time') setStep('account');
  };

  const handleBack = () => {
    if (step === 'level') setStep('level');
    else if (step === 'goal') setStep('level');
    else if (step === 'time') setStep('goal');
    else if (step === 'account') setStep('time');
  };

  const toggleGoal = (value: string) => {
    setData((prev) => ({
      ...prev,
      goals: prev.goals.includes(value)
        ? prev.goals.filter((g) => g !== value)
        : [...prev.goals, value],
    }));
  };

  const register = async () => {
    setAccountError('');
    setIsRegistering(true);
    setStep('processing');

    const timeOption = timeOptions.find((t) => t.value === data.time);

    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          displayName: data.name || undefined,
          cefrLevel: data.level || undefined,
          studyGoal: data.goals.length > 0 ? data.goals.join(',') : undefined,
          dailyGoalMinutes: timeOption?.minutes,
          // Часовой пояс нужен, чтобы стрик и дневная цель считались по местному времени
          timeZoneId: (() => {
            try {
              return Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch {
              return undefined;
            }
          })(),
          notifyEnabled: data.notifications,
        }),
      });

      if (!res.ok) {
        let message = 'Не удалось создать аккаунт. Попробуйте ещё раз.';
        try {
          const body = await res.json();
          if (Array.isArray(body) && body.length > 0) {
            message = body.map((e: { description?: string }) => e.description).filter(Boolean).join(' ');
          } else if (typeof body?.message === 'string') {
            message = body.message;
          }
        } catch {
          // оставляем сообщение по умолчанию
        }
        setAccountError(message);
        setStep('account');
        setIsRegistering(false);
        return;
      }

      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setAccountError('Аккаунт создан, но автовход не удался — войдите вручную');
        router.push('/login');
        return;
      }

      setStep('welcome');
      trackEvent('register');
    } catch {
      setAccountError('Сервер недоступен, попробуйте позже');
      setStep('account');
    } finally {
      setIsRegistering(false);
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);

  const handleAccountSubmit = () => {
    if (!data.name.trim() || !emailValid || data.password.length < 6) return;
    register();
  };

  const handleComplete = () => {
    router.push('/dashboard');
  };

  if (step === 'processing') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
        <div role="status" className="text-center">
          <span className="state-orb bg-surface-accent text-on-accent">
            <SpinnerIcon size={24} className="h-8 w-8" />
          </span>
          <p className="text-body-lg text-ink">Создаём ваш аккаунт…</p>
        </div>
      </main>
    );
  }

  if (step === 'welcome') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md text-center">
          <LexiMascot pose="wave" className="mx-auto -mt-4 mb-3 w-40" />
          <h1 className="mb-4 text-h1 text-ink">Добро пожаловать, {data.name || 'друг'}!</h1>
          <p className="mb-8 text-body-lg text-slate">
            Ваш аккаунт готов. Уровень: <b className="font-semibold text-ink">{levelLabel(data.level)}</b>
            {data.goals.length > 0 && (
              <> · Цели: {data.goals.map(goalName).join(', ')}</>
            )}
          </p>
          <Button onClick={handleComplete} className="w-full">
            Начать обучение
          </Button>
        </div>
      </main>
    );
  }

  /* Ключ кадра: шаг, а внутри теста — ещё и номер вопроса и результат */
  const frameKey =
    step === 'placement' ? `placement:${placementResult ? 'result' : placementIndex}` : step;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Header */}
      <header className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-heading text-h2 text-ink">Lexicon</span>
          <div className="flex items-center gap-4">
            <FeedbackTrigger className="text-caption text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink">
              Отзыв
            </FeedbackTrigger>
            <span className="text-body-sm text-slate">
              Шаг {currentStepNumber} из {totalSteps}
            </span>
          </div>
        </div>
      </header>

      {/* Прогресс прохождения */}
      <div className="border-b border-hairline bg-canvas">
        <div className="mx-auto w-full max-w-4xl px-6 py-3">
          <ProgressBar
            value={(currentStepNumber / totalSteps) * 100}
            label={`Шаг ${currentStepNumber} из ${totalSteps}`}
          />
        </div>
      </div>

      {/* Content */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={frameKey}
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {step === 'level' && (
                <div>
                  <StepHeading
                    title="Какой у вас уровень?"
                    hint="Это поможет подобрать подходящий материал"
                  />

                  <div className="mb-6 space-y-3">
                    {levels.map((level) => (
                      <OptionCard
                        key={level.value}
                        title={level.name}
                        description={level.description}
                        selected={data.level === level.value}
                        onSelect={() => setData({ ...data, level: level.value })}
                      />
                    ))}
                  </div>

                  <Button
                    variant="secondary"
                    onClick={startPlacement}
                    disabled={isPlacementLoading}
                    className="mb-8 w-full"
                  >
                    <TargetIcon size={16} />
                    {isPlacementLoading ? 'Загружаем тест…' : 'Пройти тест на уровень'}
                  </Button>

                  {placementError && (
                    <div className="mb-6">
                      <Notice tone="danger">{placementError}</Notice>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button onClick={handleNext} disabled={!data.level}>
                      Продолжить
                    </Button>
                  </div>
                </div>
              )}

              {step === 'placement' && (
                <div>
                  {placementResult ? (
                    <div className="text-center">
                      <span className="state-orb animate-pop-in bg-surface-accent text-on-accent">
                        <TargetIcon size={24} className="h-8 w-8" />
                      </span>
                      <h1 className="mb-4 text-h1 text-ink">
                        Ваш уровень: {levelLabel(placementResult.cefrLevel)}
                      </h1>
                      <p className="mb-8 text-body-lg text-slate">
                        Правильных ответов: {placementResult.correctCount} из {placementResult.total}
                      </p>
                      <Button
                        onClick={() => {
                          setData({ ...data, level: placementResult.cefrLevel.toLowerCase() });
                          setStep('goal');
                        }}
                        className="w-full"
                      >
                        Продолжить
                      </Button>
                    </div>
                  ) : placementQuestions.length === 0 ? (
                    <div role="status" className="py-12 text-center">
                      <span className="state-orb bg-surface-accent text-on-accent">
                        <SpinnerIcon size={24} className="h-8 w-8" />
                      </span>
                      <p className="text-body text-slate">Загружаем вопросы…</p>
                    </div>
                  ) : (
                    <>
                      <p className="mb-1 text-body-sm font-medium text-primary">
                        Вопрос {placementIndex + 1} из {placementQuestions.length}
                      </p>
                      <ProgressBar
                        value={((placementIndex + 1) / placementQuestions.length) * 100}
                        label={`Вопрос ${placementIndex + 1} из ${placementQuestions.length}`}
                        className="mb-6"
                      />

                      <h1 className="mb-8 text-h2 text-ink">
                        {placementQuestions[placementIndex].prompt}
                      </h1>

                      <div className="mb-8 space-y-3">
                        {placementQuestions[placementIndex].options.map((option, i) => (
                          <OptionCard
                            key={i}
                            title={option}
                            selected={placementChoice === i}
                            onSelect={() => setPlacementChoice(i)}
                          />
                        ))}
                      </div>

                      {placementError && (
                        <div className="mb-6">
                          <Notice tone="danger">{placementError}</Notice>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3">
                        <Button variant="ghost" onClick={() => setStep('level')}>
                          Назад
                        </Button>
                        <Button
                          onClick={submitPlacementAnswer}
                          disabled={placementChoice === null}
                        >
                          {placementIndex < placementQuestions.length - 1 ? 'Далее' : 'Завершить тест'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 'goal' && (
                <div>
                  <StepHeading
                    title="Зачем вам английский?"
                    hint="Можно выбрать несколько вариантов"
                  >
                    Выбрано: {data.goals.length}
                  </StepHeading>

                  <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4">
                    {goals.map(({ value, name, Icon }) => {
                      const selected = data.goals.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleGoal(value)}
                          aria-pressed={selected}
                          className={`relative rounded-lg border p-5 text-left transition-[background-color,border-color] duration-fast ease-soft ${
                            selected
                              ? 'border-primary bg-surface-success'
                              : 'border-hairline-strong bg-canvas hover:border-primary'
                          }`}
                        >
                          {selected && (
                            <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-on-primary">
                              <CheckIcon size={16} />
                            </span>
                          )}
                          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
                            <Icon size={24} />
                          </span>
                          <span className="block text-body-sm font-medium text-ink">{name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Button variant="ghost" onClick={handleBack}>
                      Назад
                    </Button>
                    <Button onClick={handleNext} disabled={data.goals.length === 0}>
                      Продолжить
                    </Button>
                  </div>
                </div>
              )}

              {step === 'time' && (
                <div>
                  <StepHeading
                    title="Сколько времени вы сможете уделять?"
                    hint="Это поможет составить оптимальный план"
                  />

                  <div className="mb-8 space-y-3">
                    {timeOptions.map((option) => (
                      <OptionCard
                        key={option.value}
                        title={option.name}
                        selected={data.time === option.value}
                        onSelect={() => setData({ ...data, time: option.value })}
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Button variant="ghost" onClick={handleBack}>
                      Назад
                    </Button>
                    <Button onClick={handleNext} disabled={!data.time}>
                      Продолжить
                    </Button>
                  </div>
                </div>
              )}

              {step === 'account' && (
                <div>
                  <StepHeading title="Создайте аккаунт" hint="Последний шаг перед началом" />

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAccountSubmit();
                    }}
                    className="mb-8 space-y-5"
                  >
                    <div>
                      <label
                        htmlFor="onboarding-name"
                        className="mb-2 block text-body-sm font-medium text-ink"
                      >
                        Имя
                      </label>
                      <input
                        id="onboarding-name"
                        type="text"
                        required
                        value={data.name}
                        onChange={(e) => setData({ ...data, name: e.target.value })}
                        placeholder="Как к вам обращаться"
                        className="input"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="onboarding-email"
                        className="mb-2 block text-body-sm font-medium text-ink"
                      >
                        Email
                      </label>
                      <input
                        id="onboarding-email"
                        type="email"
                        required
                        value={data.email}
                        onChange={(e) => setData({ ...data, email: e.target.value })}
                        placeholder="example@mail.com"
                        className="input"
                      />
                      {data.email && !emailValid && (
                        <p className="mt-1 text-body-sm text-semantic-error">
                          Введите корректный email
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="onboarding-password"
                        className="mb-2 block text-body-sm font-medium text-ink"
                      >
                        Пароль
                      </label>
                      <input
                        id="onboarding-password"
                        type="password"
                        required
                        value={data.password}
                        onChange={(e) => setData({ ...data, password: e.target.value })}
                        placeholder="Минимум 6 символов"
                        className="input"
                      />
                      {data.password && data.password.length < 6 && (
                        <p className="mt-1 text-body-sm text-semantic-error">
                          Пароль должен быть не короче 6 символов
                        </p>
                      )}
                    </div>

                    <label
                      htmlFor="onboarding-notify"
                      className="flex cursor-pointer items-start gap-3"
                    >
                      <input
                        id="onboarding-notify"
                        type="checkbox"
                        checked={data.notifications}
                        onChange={(e) => setData({ ...data, notifications: e.target.checked })}
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="text-body-sm text-slate">
                        Я согласен получать уведомления о прогрессе и напоминания о занятиях
                      </span>
                    </label>

                    {/* Кнопки внутри формы: submit уходит один раз, Enter в поле тоже работает */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <Button type="button" variant="ghost" onClick={handleBack}>
                        Назад
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          !data.name.trim() ||
                          !emailValid ||
                          data.password.length < 6 ||
                          isRegistering
                        }
                      >
                        {isRegistering ? (
                          <>
                            <SpinnerIcon size={16} />
                            Создаём…
                          </>
                        ) : (
                          'Создать аккаунт'
                        )}
                      </Button>
                    </div>
                  </form>

                  {accountError && <Notice tone="danger">{accountError}</Notice>}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
