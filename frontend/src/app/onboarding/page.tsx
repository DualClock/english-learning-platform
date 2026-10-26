'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';
import ChoiceCard from '@/components/ui/ChoiceCard';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger';
import Notice from '@/components/ui/Notice';
import ProgressBar from '@/components/ui/ProgressBar';
import {
  BriefcaseIcon,
  HomeIcon,
  NotebookIcon,
  PlaneIcon,
  SpinnerIcon,
  type IconProps,
} from '@/components/ui/icons';
import { AnimatePresence, motion } from 'motion/react';
import { variants } from '@/lib/motion';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useTrack } from '@/app/lib/analytics';
import { getActiveAttribution, registrationPayload } from '@/lib/attribution';
import {
  POST_SIGNUP_PATH,
  NOTIFY_COPY,
  canSubmitAccount,
  isValidEmail,
  isValidPassword,
  levelFromQuery,
  stepNumber,
  totalSteps,
  welcomeHeadline,
  type OnboardingStep,
} from '@/lib/onboarding-flow';
import {
  HONEYPOT_WRAPPER_STYLE,
  buildRegistrationPayload,
  detectTimeZoneId,
  honeypotInputProps,
} from '@/lib/signup-payload';

/*
 * Онбординг: два шага и ни одного обязательного вопроса сверх доступа.
 *
 * Что было и почему это дорого стоило. Путь начинался с выбора уровня, затем
 * шёл тест из 16 вопросов, затем цель, затем время в день, и только на
 * четвёртом шаге появлялась форма. Человек, который пришёл «читать книгу»,
 * три минуты отвечал на вопросы до первого слова — причём тест уровня он к
 * этому моменту мог уже пройти на /test, и проходил его заново.
 *
 * Что теперь. Шаг 1 — email и пароль; имя необязательно и спрятано, бэкенд
 * выводит его из адреса. Шаг 2 — зачем пришёл, и его можно пропустить одной
 * кнопкой. Уровень приходит адресом (`?level=b1`) из /test или из ссылки
 * лендинга; если его нет — остаётся пустым, а не «a1 по умолчанию»: уровень
 * влияет на рекомендации книг, и врать в профиле нельзя.
 *
 * После регистрации ведём в библиотеку (`/books?first=1`), а не на дашборд:
 * дашборд у нового аккаунта состоит из нулей и пустых карточек, библиотека —
 * из книг, и первое действие там осмысленное.
 */

type Step = OnboardingStep | 'processing' | 'welcome';

const goals: { value: string; name: string; Icon: (p: IconProps) => JSX.Element }[] = [
  { value: 'work', name: 'Для работы', Icon: BriefcaseIcon },
  { value: 'travel', name: 'Для путешествий', Icon: PlaneIcon },
  { value: 'study', name: 'Для учёбы', Icon: NotebookIcon },
  { value: 'life', name: 'Для повседневной жизни', Icon: HomeIcon },
];

/** Заголовок шага: вопрос сверху, пояснение под ним. */
function StepHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-h1 text-ink">{title}</h1>
      {hint && <p className="mt-2 text-body text-slate">{hint}</p>}
    </div>
  );
}

/**
 * `useSearchParams` в Next 14 требует границы Suspense при пререндере:
 * без неё сборка ругается и страница уходит в клиентский рендер целиком.
 */
function OnboardingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackEvent = useTrack();

  // Уровень из адреса читается один раз на монтирование: если позже он
  // появится в URL, анкета не должна перерисовываться под человеком.
  const levelFromUrl = levelFromQuery(searchParams?.get('level'));
  const cameFromTest = Boolean(levelFromUrl);

  const [step, setStep] = useState<Step>('account');
  const [data, setData] = useState({
    goals: [] as string[],
    name: '',
    email: '',
    password: '',
    // Напоминания включены по умолчанию: без письма у нового пользователя нет
    // ни одного канала возврата (пушей в продукте нет, подтверждение почты не
    // требуется), а отписка есть в настройках.
    notifications: true,
    // Honeypot (W1.4.4): поле «website» для ботов-автозаполнителей. Человек его
    // не видит и не трогает, поэтому для живого пользователя это всегда ''.
    website: '',
  });
  const [accountError, setAccountError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showName, setShowName] = useState(false);

  // Сколько времени в день человек готов тратить. Отдельным шагом больше не
  // спрашиваем: уходит вместе с целью, по умолчанию 20 минут — середина из
  // трёх вариантов, которые были раньше.
  const minutes = 20;

  const currentStepNumber = stepNumber(step === 'goal' ? 'goal' : 'account');
  const stepsTotal = totalSteps();

  const toggleGoal = (value: string) => {
    setData((prev) => ({
      ...prev,
      goals: prev.goals.includes(value)
        ? prev.goals.filter((g) => g !== value)
        : [...prev.goals, value],
    }));
  };

  const register = async (aheadGoal?: string[]) => {
    setAccountError('');
    setIsRegistering(true);
    setStep('processing');

    const goalsToSend = aheadGoal ?? data.goals;

    // Канал, по которому человек пришёл (utm/ref из cookie). Пустой объект,
    // если меток не было: аккаунт остаётся «без источника», а не «с пустым».
    const attribution =
      typeof window === 'undefined'
        ? {}
        : registrationPayload(getActiveAttribution(document.cookie, window.sessionStorage));

    try {
      const res = await fetch('/api/next/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Тело собирается в одном месте (src/lib/signup-payload.ts), потому что
        // имена ключей — контракт с серверным RegisterDto: опечатку MVC не
        // показывает, поле просто перестаёт приходить.
        body: JSON.stringify(
          buildRegistrationPayload(
            {
              email: data.email.trim(),
              password: data.password,
              name: data.name.trim(),
              level: levelFromUrl ?? '',
              goals: goalsToSend,
              minutes,
              notifications: data.notifications,
              // Часовой пояс нужен, чтобы стрик и дневная цель считались по местному времени
              timezone: detectTimeZoneId(),
              website: data.website,
            },
            attribution
          )
        ),
      });

      if (!res.ok) {
        /*
         * Сообщение строится по КОДУ ответа, а не одной фразой «попробуйте ещё раз».
         *
         * Живой случай: сервер отвечал 429 (лимит 50 регистраций в час на IP),
         * а форма показывала «Не удалось создать аккаунт. Попробуйте ещё раз» —
         * человек повторял действие, упирался в тот же лимит и не понимал
         * причины. Код ответа известен здесь же, скрывать его незачем.
         */
        let message = `Не удалось создать аккаунт (код ${res.status}). Попробуйте ещё раз.`;

        if (res.status === 429) {
          message =
            'Слишком много попыток регистрации с этого адреса. ' +
            'Лимит — 50 в час. Попробуйте позже или войдите в существующий аккаунт.';
        } else if (res.status === 409) {
          message = 'Аккаунт с таким email уже существует. Войдите или восстановите пароль.';
        } else if (res.status === 502 || res.status === 503) {
          message = 'Сервер недоступен (код ' + res.status + '). Проверьте, запущен ли API.';
        }

        try {
          const body = await res.json();
          if (Array.isArray(body) && body.length > 0) {
            // Ошибки валидации модели: MVC отдаёт массив с описаниями.
            const details = body
              .map((e: { description?: string }) => e.description)
              .filter(Boolean)
              .join(' ');
            if (details) message = details;
          } else if (typeof body?.message === 'string') {
            message = body.message;
          } else if (typeof body?.error === 'string') {
            message = body.error + ' (код ' + res.status + ')';
          }
        } catch {
          // тело не JSON — оставляем сообщение по коду
        }

        // Диагностика в консоль браузера: при разборе жалоб «не создаётся
        // аккаунт» первым делом нужно видеть статус и тело ответа.
        console.error('[регистрация] ответ сервера', res.status, res.url);

        setAccountError(message);
        setStep('account');
        setIsRegistering(false);
        return;
      }

      const result = await signIn('credentials', {
        email: data.email.trim(),
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

  const handleAccountSubmit = () => {
    if (!canSubmitAccount({ email: data.email, password: data.password })) return;
    setStep('goal');
  };

  const skipGoal = () => {
    trackEvent('onboarding_goal_skipped');
    void register([]);
  };

  const handleComplete = () => {
    router.push(POST_SIGNUP_PATH);
  };

  const emailValid = isValidEmail(data.email);
  const passwordValid = isValidPassword(data.password);

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
          <h1 className="mb-4 text-h1 text-ink">{welcomeHeadline(data.name)}</h1>
          <p className="mb-8 text-body-lg text-slate">
            Аккаунт готов. Первый шаг — открыть книгу: слова попадут в словарь сами,
            когда вы нажмёте на них в тексте.
          </p>
          <Button onClick={handleComplete} className="w-full" data-testid="onboarding-finish">
            Выбрать первую книгу
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <span className="font-heading text-h2 text-ink">Lexicon</span>
          <div className="flex items-center gap-4">
            <FeedbackTrigger className="text-caption text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink">
              Отзыв
            </FeedbackTrigger>
            <span className="text-body-sm text-slate">
              Шаг {currentStepNumber} из {stepsTotal}
            </span>
          </div>
        </div>
      </header>

      <div className="border-b border-hairline bg-canvas">
        <div className="mx-auto w-full max-w-4xl px-6 py-3">
          <ProgressBar
            value={(currentStepNumber / stepsTotal) * 100}
            label={`Шаг ${currentStepNumber} из ${stepsTotal}`}
          />
        </div>
      </div>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {step === 'account' && (
                <div>
                  <StepHeading
                    title="Создайте аккаунт"
                    hint={
                      cameFromTest
                        ? 'Уровень из теста уже учтён — остались почта и пароль.'
                        : 'Email и пароль — всё, что нужно. Имя спросим позже, если захотите.'
                    }
                  />

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAccountSubmit();
                    }}
                    className="mb-8 space-y-5"
                  >
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
                        autoComplete="email"
                        value={data.email}
                        onChange={(e) => setData({ ...data, email: e.target.value })}
                        placeholder="example@mail.com"
                        className="input"
                        data-testid="onboarding-email"
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
                        autoComplete="new-password"
                        value={data.password}
                        onChange={(e) => setData({ ...data, password: e.target.value })}
                        placeholder="Минимум 6 символов"
                        className="input"
                        data-testid="onboarding-password"
                      />
                      {data.password && !passwordValid && (
                        <p className="mt-1 text-body-sm text-semantic-error">
                          Пароль должен быть не короче 6 символов
                        </p>
                      )}
                    </div>

                    {/* Имя — необязательное и спрятанное: требовать строку ради
                        доступа к продукту незачем, бэкенд выведет её из email. */}
                    {showName ? (
                      <div>
                        <label
                          htmlFor="onboarding-name"
                          className="mb-2 block text-body-sm font-medium text-ink"
                        >
                          Имя <span className="font-normal text-slate">(необязательно)</span>
                        </label>
                        <input
                          id="onboarding-name"
                          type="text"
                          autoComplete="given-name"
                          value={data.name}
                          onChange={(e) => setData({ ...data, name: e.target.value })}
                          placeholder="Как к вам обращаться"
                          className="input"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowName(true)}
                        className="text-body-sm text-primary underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
                      >
                        Указать имя (необязательно)
                      </button>
                    )}

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
                        data-testid="onboarding-notify"
                      />
                      <span className="text-body-sm text-slate">
                        {NOTIFY_COPY.label}
                        <span className="block text-caption text-slate">{NOTIFY_COPY.hint}</span>
                      </span>
                    </label>

                    {/* Honeypot (W1.4.4, SECURITY_GATE R-09): автозаполнитель
                        бота заполняет всё, что видит в разметке, — человек это
                        поле не видит и не трогает. Спрятано смещением и
                        clipping-ом вокруг самого поля, а не display:none над
                        блоком полей: во втором случае из доступности выпадала бы
                        вся форма. tabIndex={-1} и aria-hidden выносят поле из
                        клавиатурной обходки и из озвучки скринридером. */}
                    <div aria-hidden="true" style={HONEYPOT_WRAPPER_STYLE}>
                      <label htmlFor="onboarding-website">Website</label>
                      <input
                        id="onboarding-website"
                        {...honeypotInputProps(data.website, (event) =>
                          setData({ ...data, website: event.target.value })
                        )}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <Link
                        href="/login"
                        className="text-body-sm text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
                      >
                        У меня есть аккаунт
                      </Link>
                      <Button
                        type="submit"
                        disabled={!emailValid || !passwordValid}
                        data-testid="onboarding-submit"
                      >
                        Далее
                      </Button>
                    </div>

                    {/*
                     * Согласие просим в тот момент, когда его действительно
                     * дают: человек вводит email и пароль. Ссылки ведут на
                     * /privacy (что делаем с данными) и /terms (правила беты) —
                     * обе страницы публичные и открываются без аккаунта.
                     */}
                    <p className="text-caption leading-snug text-slate">
                      Создавая аккаунт, вы принимаете{' '}
                      <Link
                        href="/terms"
                        className="underline decoration-hairline-strong underline-offset-2 hover:text-ink"
                      >
                        правила беты
                      </Link>{' '}
                      и ознакомляетесь с{' '}
                      <Link
                        href="/privacy"
                        className="underline decoration-hairline-strong underline-offset-2 hover:text-ink"
                      >
                        политикой конфиденциальности
                      </Link>
                      . Удалить аккаунт и все данные можно в настройках.
                    </p>
                  </form>

                  {accountError && <Notice tone="danger">{accountError}</Notice>}
                </div>
              )}

              {step === 'goal' && (
                <div>
                  <StepHeading
                    title="Зачем вам английский?"
                    hint="Это необязательно — можно пропустить и сразу начать читать."
                  />

                  <div className="mb-6 space-y-3">
                    {goals.map((goal) => (
                      <ChoiceCard
                        key={goal.value}
                        title={goal.name}
                        selected={data.goals.includes(goal.value)}
                        onSelect={() => toggleGoal(goal.value)}
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Button variant="ghost" onClick={skipGoal} disabled={isRegistering}>
                      Пропустить
                    </Button>
                    <Button
                      onClick={() => void register()}
                      disabled={isRegistering}
                      data-testid="onboarding-goal-continue"
                    >
                      {isRegistering ? 'Создаём…' : 'Начать'}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-surface">
          <span role="status" className="text-body text-slate">
            Загрузка…
          </span>
        </main>
      }
    >
      <OnboardingForm />
    </Suspense>
  );
}
