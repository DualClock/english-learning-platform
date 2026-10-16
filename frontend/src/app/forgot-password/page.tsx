'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';

const inputCls =
  'w-full px-4 py-3 rounded-lg border border-[var(--color-hairline-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent';

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const requestToken = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || 'Не удалось запросить восстановление. Попробуйте ещё раз.');
        return;
      }
      setResetToken(body?.resetToken || '');
    } catch {
      setError('Сервер недоступен. Попробуйте позже.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(resetToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // буфер обмена недоступен — токен можно скопировать вручную
    }
  };

  const resetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (newPassword !== repeatPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resetToken, newPassword }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || 'Не удалось сбросить пароль. Проверьте токен и попробуйте ещё раз.');
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch {
      setError('Сервер недоступен. Попробуйте позже.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col items-center justify-center p-6">
      <Link href="/" className="text-3xl font-bold text-[var(--color-ink)] mb-8">
        Lexicon
      </Link>

      <div className="w-full max-w-md bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-8">
        {success ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgba(14,124,123,0.10)] flex items-center justify-center">
              <svg className="w-8 h-8 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Пароль изменён</h1>
            <p className="text-[var(--color-slate)]">Теперь войдите с новым паролем…</p>
          </div>
        ) : resetToken ? (
          <>
            <h1 className="text-2xl font-bold text-[var(--color-ink)] text-center mb-2">
              Придумайте новый пароль
            </h1>
            <p className="text-[var(--color-slate)] text-center mb-6">
              Для аккаунта {email}
            </p>

            {/* Токен восстановления (бета) */}
            <div className="mb-6 p-4 rounded-xl bg-[rgba(249,231,159,0.20)] border border-[var(--color-tint-yellow-bold)]">
              <p className="text-sm font-medium text-[var(--color-ink)] mb-2">
                Токен восстановления{' '}
                <span className="font-normal text-[var(--color-slate)]">(бета: вместо письма)</span>
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs text-[var(--color-ink)] bg-white border border-[var(--color-hairline-strong)] rounded-lg px-3 py-2 break-all">
                  {resetToken}
                </code>
                <button
                  onClick={copyToken}
                  className="btn-secondary text-sm py-2 px-3 shrink-0"
                  title="Скопировать токен"
                >
                  {copied ? '✓' : 'Копировать'}
                </button>
              </div>
            </div>

            <form onSubmit={resetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">Новый пароль</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Минимум 6 символов"
                  className={inputCls}
                  required
                  minLength={6}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                  Повторите новый пароль
                </label>
                <input
                  type="password"
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                  autoComplete="new-password"
                  className={inputCls}
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary-pressed)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Сохраняем…' : 'Сменить пароль'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-[var(--color-ink)] text-center mb-2">
              Восстановление пароля
            </h1>
            <p className="text-[var(--color-slate)] text-center mb-8">
              Введите email — мы подготовим токен восстановления
            </p>

            <form onSubmit={requestToken} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="email@example.com"
                  className={inputCls}
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary-pressed)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Отправляем…' : 'Получить токен'}
              </button>
            </form>
          </>
        )}
      </div>

      <p className="text-sm text-[var(--color-slate)] mt-8">
        <Link href="/login" className="text-[var(--color-primary)] font-medium hover:underline">
          ← Вернуться ко входу
        </Link>
      </p>
    </div>
  );
}
