'use client';

import { useState } from 'react';
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

const goals = [
  { value: 'work', name: 'Для работы', icon: '💼' },
  { value: 'travel', name: 'Для путешествий', icon: '✈️' },
  { value: 'study', name: 'Для учёбы', icon: '📚' },
  { value: 'life', name: 'Для повседневной жизни', icon: '🏠' },
  { value: 'movies', name: 'Фильмы и сериалы', icon: '🎬' },
  { value: 'books', name: 'Читать книги', icon: '📖' },
  { value: 'friends', name: 'Общение с людьми', icon: '💬' },
  { value: 'brain', name: 'Тренировка мозга', icon: '🧠' },
];

const timeOptions = [
  { value: '5-10', name: '5–10 минут в день', minutes: 10 },
  { value: '15-20', name: '15–20 минут в день', minutes: 20 },
  { value: '30+', name: '30+ минут в день', minutes: 30 },
];

const goalName = (value: string) => goals.find((g) => g.value === value)?.name ?? value;

const levelLabel = (value: string) =>
  levels.find((l) => l.value === value)?.name.split(' — ')[0].toUpperCase() || value.toUpperCase();

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
  const currentStepNumber = step === 'level' ? 1 :
                          step === 'goal' ? 2 :
                          step === 'time' ? 3 :
                          step === 'account' ? 4 : 4;

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
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] px-4">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
          <p className="text-[var(--color-ink)] text-lg">Создаём ваш аккаунт...</p>
        </div>
      </div>
    );
  }

  if (step === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] px-4">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-4">
            Добро пожаловать, {data.name || 'друг'}!
          </h1>
          <p className="text-[var(--color-slate)] text-lg mb-8">
            Ваш аккаунт готов. Уровень: <b>{levelLabel(data.level)}</b>
            {data.goals.length > 0 && (
              <> · Цели: {data.goals.map(goalName).join(', ')}</>
            )}
          </p>
          <button
            onClick={handleComplete}
            className="btn-primary w-full"
          >
            Начать обучение
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col">
      {/* Header */}
      <header className="border-b border-[var(--color-hairline-strong)]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-semibold text-[var(--color-ink)]">Lexicon</span>
          <span className="text-sm text-[var(--color-slate)]">
            Шаг {currentStepNumber} из {totalSteps}
          </span>
        </div>
      </header>

      {/* Progress bar */}
      <div className="bg-white border-b border-[var(--color-hairline-strong)]">
        <div className="max-w-4xl mx-auto px-6 py-3">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(currentStepNumber / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          {step === 'level' && (
            <div className="animate-fade-in">
              <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">
                Какой у вас уровень?
              </h1>
              <p className="text-[var(--color-slate)] mb-8">Это поможет подобрать подходящий материал</p>

              <div className="space-y-3 mb-6">
                {levels.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setData({ ...data, level: level.value })}
                    className={`w-full p-5 rounded-xl border-2 text-left transition-all ${
                      data.level === level.value
                        ? 'border-[var(--color-primary)] bg-[var(--color-tint-mint)]'
                        : 'border-[var(--color-hairline-strong)] bg-white hover:border-[var(--color-primary-pressed)]'
                    }`}
                  >
                    <div className="font-medium text-[var(--color-ink)] mb-1">{level.name}</div>
                    <div className="text-sm text-[var(--color-slate)]">{level.description}</div>
                  </button>
                ))}
              </div>

              <button
                onClick={startPlacement}
                disabled={isPlacementLoading}
                className="w-full mb-8 py-3 rounded-xl border-2 border-dashed border-[var(--color-primary-pressed)] text-[var(--color-primary)] font-medium hover:bg-[var(--color-tint-mint)] disabled:opacity-50 transition-all"
              >
                {isPlacementLoading ? 'Загружаем тест...' : 'Не знаю свой уровень — пройти тест'}
              </button>

              {placementError && step === 'level' && (
                <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm mb-6">
                  {placementError}
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={handleBack} className="btn-ghost">
                  Назад
                </button>
                <button
                  onClick={handleNext}
                  disabled={!data.level}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Продолжить
                </button>
              </div>
            </div>
          )}

          {step === 'placement' && (
            <div className="animate-fade-in">
              {placementResult ? (
                <>
                  <div className="text-center">
                    <div className="text-6xl mb-6">🎯</div>
                    <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-4">
                      Ваш уровень: {levelLabel(placementResult.cefrLevel)}
                    </h1>
                    <p className="text-[var(--color-slate)] text-lg mb-8">
                      Правильных ответов: {placementResult.correctCount} из {placementResult.total}
                    </p>
                    <button
                      onClick={() => {
                        setData({ ...data, level: placementResult.cefrLevel.toLowerCase() });
                        setStep('goal');
                      }}
                      className="btn-primary w-full"
                    >
                      Продолжить
                    </button>
                  </div>
                </>
              ) : placementQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                  <p className="text-[var(--color-slate)]">Загружаем вопросы...</p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-[var(--color-primary-pressed)] mb-1">
                    Вопрос {placementIndex + 1} из {placementQuestions.length}
                  </p>
                  <div className="progress-bar mb-6">
                    <div
                      className="progress-fill"
                      style={{ width: `${((placementIndex + 1) / placementQuestions.length) * 100}%` }}
                    />
                  </div>

                  <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-8">
                    {placementQuestions[placementIndex].prompt}
                  </h1>

                  <div className="space-y-3 mb-8">
                    {placementQuestions[placementIndex].options.map((option, i) => (
                      <button
                        key={i}
                        onClick={() => setPlacementChoice(i)}
                        className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                          placementChoice === i
                            ? 'border-[var(--color-primary)] bg-[var(--color-tint-mint)]'
                            : 'border-[var(--color-hairline-strong)] bg-white hover:border-[var(--color-primary-pressed)]'
                        }`}
                      >
                        <span className="font-medium text-[var(--color-ink)]">{option}</span>
                      </button>
                    ))}
                  </div>

                  {placementError && (
                    <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm mb-6">
                      {placementError}
                    </div>
                  )}

                  <div className="flex justify-between">
                    <button
                      onClick={() => setStep('level')}
                      className="btn-ghost"
                    >
                      Назад
                    </button>
                    <button
                      onClick={submitPlacementAnswer}
                      disabled={placementChoice === null}
                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {placementIndex < placementQuestions.length - 1 ? 'Далее' : 'Завершить тест'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'goal' && (
            <div className="animate-fade-in">
              <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">
                Зачем вам английский?
              </h1>
              <p className="text-[var(--color-slate)] mb-2">Можно выбрать несколько вариантов</p>
              <p className="text-xs text-[var(--color-slate)] mb-8">Выбрано: {data.goals.length}</p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                {goals.map((goal) => {
                  const selected = data.goals.includes(goal.value);
                  return (
                    <button
                      key={goal.value}
                      onClick={() => toggleGoal(goal.value)}
                      className={`relative p-6 rounded-xl border-2 transition-all ${
                        selected
                          ? 'border-[var(--color-primary)] bg-[var(--color-tint-mint)]'
                          : 'border-[var(--color-hairline-strong)] bg-white hover:border-[var(--color-primary-pressed)]'
                      }`}
                    >
                      {selected && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--color-primary)] text-white text-xs flex items-center justify-center">
                          ✓
                        </span>
                      )}
                      <div className="text-3xl mb-3">{goal.icon}</div>
                      <div className="font-medium text-[var(--color-ink)]">{goal.name}</div>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-between">
                <button onClick={handleBack} className="btn-ghost">
                  Назад
                </button>
                <button
                  onClick={handleNext}
                  disabled={data.goals.length === 0}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Продолжить
                </button>
              </div>
            </div>
          )}

          {step === 'time' && (
            <div className="animate-fade-in">
              <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">
                Сколько времени вы сможете уделять?
              </h1>
              <p className="text-[var(--color-slate)] mb-8">Это поможет составить оптимальный план</p>

              <div className="space-y-3 mb-8">
                {timeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setData({ ...data, time: option.value })}
                    className={`w-full p-5 rounded-xl border-2 text-left transition-all ${
                      data.time === option.value
                        ? 'border-[var(--color-primary)] bg-[var(--color-tint-mint)]'
                        : 'border-[var(--color-hairline-strong)] bg-white hover:border-[var(--color-primary-pressed)]'
                    }`}
                  >
                    <div className="font-medium text-[var(--color-ink)]">{option.name}</div>
                  </button>
                ))}
              </div>

              <div className="flex justify-between">
                <button onClick={handleBack} className="btn-ghost">
                  Назад
                </button>
                <button
                  onClick={handleNext}
                  disabled={!data.time}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Продолжить
                </button>
              </div>
            </div>
          )}

          {step === 'account' && (
            <div className="animate-fade-in">
              <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">
                Создайте аккаунт
              </h1>
              <p className="text-[var(--color-slate)] mb-8">Последний шаг перед началом</p>

              <form onSubmit={(e) => { e.preventDefault(); handleAccountSubmit(); }} className="space-y-5 mb-8">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                    Имя
                  </label>
                  <input
                    type="text"
                    required
                    value={data.name}
                    onChange={(e) => setData({ ...data, name: e.target.value })}
                    placeholder="Как к вам обращаться"
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={data.email}
                    onChange={(e) => setData({ ...data, email: e.target.value })}
                    placeholder="example@mail.com"
                    className="input"
                  />
                  {data.email && !emailValid && (
                    <p className="text-sm text-[var(--color-error)] mt-1">Введите корректный email</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                    Пароль
                  </label>
                  <input
                    type="password"
                    required
                    value={data.password}
                    onChange={(e) => setData({ ...data, password: e.target.value })}
                    placeholder="Минимум 6 символов"
                    className="input"
                  />
                  {data.password && data.password.length < 6 && (
                    <p className="text-sm text-[var(--color-error)] mt-1">Пароль должен быть не короче 6 символов</p>
                  )}
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.notifications}
                    onChange={(e) => setData({ ...data, notifications: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-[var(--color-hairline-strong)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                  />
                  <span className="text-sm text-[var(--color-slate)]">
                    Я согласен получать уведомления о прогрессе и напоминания о занятиях
                  </span>
                </label>
              </form>

              {accountError && (
                <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm mb-6">
                  {accountError}
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={handleBack} className="btn-ghost">
                  Назад
                </button>
                <button
                  onClick={handleAccountSubmit}
                  disabled={!data.name.trim() || !emailValid || data.password.length < 6 || isRegistering}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRegistering ? 'Создаём...' : 'Создать аккаунт'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
