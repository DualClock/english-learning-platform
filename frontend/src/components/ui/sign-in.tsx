'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import Notice from '@/components/ui/Notice';
import { BookOpenIcon, RepeatIcon, SparklesIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import styles from './sign-in.module.css';

// --- HELPER COMPONENTS (ICONS) ---

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
  </svg>
);

const EyeIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2" />
    <path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 5.4-1.4" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M2 2l20 20" />
  </svg>
);

// --- TYPE DEFINITIONS ---

export interface Testimonial {
  avatarSrc: string;
  name: string;
  handle: string;
  text: string;
}

export interface SignInPageProps {
  title?: ReactNode;
  description?: ReactNode;
  /**
   * Оставлено для совместимости публичного API. Не рендерится: на странице
   * входа проекта нет внешних изображений, правая колонка собрана из
   * брендового маскота и реальных свойств продукта.
   */
  heroImageSrc?: string;
  /**
   * Оставлено для совместимости публичного API. Не рендерится: выдуманные
   * отзывы с именами и хэштегами на странице входа недопустимы.
   */
  testimonials?: Testimonial[];
  onSignIn?: (event: React.FormEvent<HTMLFormElement>) => void;
  onGoogleSignIn?: () => void;
  onResetPassword?: () => void;
  onCreateAccount?: () => void;
  /** Куда ведёт ссылка восстановления, если не передан onResetPassword */
  resetPasswordHref?: string;
  /** Куда ведёт ссылка регистрации, если не передан onCreateAccount */
  createAccountHref?: string;
  /** Блокирует кнопку и показывает «Вход…», пока идёт запрос */
  isLoading?: boolean;
  /** Текст ошибки; выводится как Notice с role="alert" */
  error?: string;
  /** Уведомления над формой: истёкшая сессия, удалённый аккаунт */
  notices?: ReactNode;
}

// --- PRODUCT HIGHLIGHTS ---

/*
 * Только реальные свойства продукта. Никаких отзывов, имён и хэштегов:
 * справа от формы — то, что пользователь действительно получит после входа.
 */
const FEATURES = [
  {
    Icon: BookOpenIcon,
    title: 'Классика и свои книги',
    text: 'Public-domain классика уже в библиотеке — или загрузите собственный EPUB.',
    tint: 'bg-surface-info text-on-info',
  },
  {
    Icon: SparklesIcon,
    title: 'Перевод по нажатию',
    text: 'Нажмите на слово — перевод появится прямо в тексте, с учётом контекста.',
    tint: 'bg-surface-success text-on-success',
  },
  {
    Icon: RepeatIcon,
    title: 'Повторения SM-2',
    text: 'Слова возвращаются в тот момент, когда вы почти готовы их забыть.',
    tint: 'bg-surface-decor text-on-decor',
  },
] as const;

const CARD_DELAYS = [styles.card1, styles.card2, styles.card3];

// --- MAIN COMPONENT ---

export const SignInPage: React.FC<SignInPageProps> = ({
  title = 'С возвращением',
  description = 'Продолжите с того места, где остановились: книги, слова и прогресс уже ждут.',
  onSignIn,
  onGoogleSignIn,
  onResetPassword,
  onCreateAccount,
  resetPasswordHref = '/forgot-password',
  createAccountHref = '/onboarding',
  isLoading = false,
  error,
  notices,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  return (
    <div className="flex min-h-[100dvh] bg-canvas">
      {/* Left column: sign-in form */}
      <main className="flex w-full flex-1 items-start justify-center px-6 pb-10 pt-[max(2.5rem,18dvh)] sm:px-8 lg:w-1/2 lg:px-10">
        <div className="w-full max-w-[26.5rem]">
          <Link
            href="/"
            className={cn(
              styles.enter,
              'mb-9 inline-flex items-center gap-2.5 rounded-md text-ink',
            )}
          >
            <Image
              src="/brand/lexi-mark.svg"
              alt=""
              width={32}
              height={32}
              priority
              className="h-8 w-8 rounded-[9px]"
            />
            <span className="font-heading text-h3">Lexicon</span>
          </Link>

          <h1 className={cn(styles.enter, styles.d1, 'text-h1 leading-[1.3] text-ink')}>{title}</h1>
          <p className={cn(styles.enter, styles.d2, 'mt-3 max-w-[42ch] text-body text-slate')}>
            {description}
          </p>

          {notices ? (
            <div className={cn(styles.enter, styles.d3, 'mt-6 space-y-3')}>{notices}</div>
          ) : null}

          <form
            className="mt-8 space-y-5"
            onSubmit={(event) => {
              if (onSignIn) onSignIn(event);
              else event.preventDefault();
            }}
          >
            <div className={cn(styles.enter, styles.d3)}>
              <label htmlFor={emailId} className="mb-2 block text-body-sm font-medium text-charcoal">
                Email
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="email@example.com"
                required
                aria-describedby={error ? errorId : undefined}
                className={styles.field}
              />
            </div>

            <div className={cn(styles.enter, styles.d4)}>
              <label htmlFor={passwordId} className="mb-2 block text-body-sm font-medium text-charcoal">
                Пароль
              </label>
              <div className="relative">
                <input
                  id={passwordId}
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  aria-describedby={error ? errorId : undefined}
                  className={cn(styles.field, styles.fieldPassword)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-steel transition-colors duration-fast ease-soft hover:text-ink"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              <div className="mt-2 flex justify-end">
                {onResetPassword ? (
                  <button
                    type="button"
                    onClick={onResetPassword}
                    className="rounded text-body-sm text-link transition-colors duration-fast ease-soft hover:text-primary-deep hover:underline"
                  >
                    Забыли пароль?
                  </button>
                ) : (
                  <Link
                    href={resetPasswordHref}
                    className="rounded text-body-sm text-link transition-colors duration-fast ease-soft hover:text-primary-deep hover:underline"
                  >
                    Забыли пароль?
                  </Link>
                )}
              </div>
            </div>

            {error ? (
              <div id={errorId} className={styles.alert}>
                <Notice tone="danger">{error}</Notice>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading || undefined}
              className={cn(styles.enter, styles.d6, 'btn-primary h-12 w-full text-body')}
            >
              {isLoading ? (
                <>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="animate-spin"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                  </svg>
                  Вход…
                </>
              ) : (
                'Войти'
              )}
            </button>
          </form>

          {onGoogleSignIn ? (
            <>
              <div className={cn(styles.enter, styles.d6, 'relative my-6 flex items-center justify-center')}>
                <span className="h-px w-full bg-hairline" aria-hidden="true" />
                <span className="absolute bg-canvas px-4 text-caption text-steel">Или продолжите с</span>
              </div>
              <button
                type="button"
                onClick={onGoogleSignIn}
                className={cn(
                  styles.enter,
                  styles.d7,
                  'flex h-12 w-full items-center justify-center gap-3 rounded-md border border-hairline-strong bg-canvas text-body-sm font-medium text-ink transition-colors duration-fast ease-soft hover:bg-surface',
                )}
              >
                <GoogleIcon />
                Продолжить с Google
              </button>
            </>
          ) : null}

          <p className={cn(styles.enter, styles.d7, 'mt-6 text-center text-body-sm text-slate')}>
            Нет аккаунта?{' '}
            {onCreateAccount ? (
              <button
                type="button"
                onClick={onCreateAccount}
                className="rounded font-medium text-link transition-colors duration-fast ease-soft hover:text-primary-deep hover:underline"
              >
                Зарегистрироваться
              </button>
            ) : (
              <Link
                href={createAccountHref}
                className="rounded font-medium text-link transition-colors duration-fast ease-soft hover:text-primary-deep hover:underline"
              >
                Зарегистрироваться
              </Link>
            )}
          </p>
        </div>
      </main>

      {/* Right column: hero panel with the brand mascot and real product properties */}
      <aside className="hidden w-1/2 p-4 lg:block">
        <div
          className={cn(
            styles.panel,
            'relative flex h-full min-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-3xl border border-hairline bg-surface-accent p-7 xl:p-10',
          )}
        >
          <div className="relative z-10">
            <p className="text-caption font-semibold uppercase tracking-[0.16em] text-on-accent">
              Lexicon
            </p>
            <h2 className="mt-3 text-h2 text-ink">Английский из настоящих книг</h2>
            <p className="mt-3 max-w-[34ch] text-body-sm text-slate">
              Читайте то, что интересно. Незнакомые слова — на расстоянии одного нажатия.
            </p>
          </div>

          <div className="relative z-10 flex flex-1 items-center justify-center py-4 xl:py-6">
            <LexiMascot pose="read" className="w-[clamp(9.5rem,18vw,16rem)]" />
          </div>

          <ul className="relative z-10 space-y-2.5 xl:space-y-3">
            {FEATURES.map((feature, index) => {
              const Icon = feature.Icon;
              return (
                <li
                  key={feature.title}
                  className={cn(
                    styles.card,
                    CARD_DELAYS[index],
                    'flex items-start gap-3 rounded-2xl border border-hairline bg-surface-soft p-3.5 shadow-soft xl:p-4',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      feature.tint,
                    )}
                  >
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-sm font-semibold text-ink">{feature.title}</p>
                    <p className="mt-1 text-caption text-slate">{feature.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
};
