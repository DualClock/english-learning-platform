'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';

const inputCls =
  'w-full px-4 py-3 rounded-lg border border-[#D6D3CC] focus:outline-none focus:ring-2 focus:ring-[#356B52] focus:border-transparent';

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
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col items-center justify-center p-6">
      <Link href="/" className="text-3xl font-bold text-[#20231F] mb-8">
        Lexicon
      </Link>

      <div className="w-full max-w-md bg-white rounded-2xl border border-[#D6D3CC] p-8">
        {success ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#356B52]/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#356B52]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[#20231F] mb-2">Пароль изменён</h1>
            <p className="text-[#5A5F5A]">Теперь войдите с новым паролем…</p>
          </div>
        ) : resetToken ? (
          <>
            <h1 className="text-2xl font-bold text-[#20231F] text-center mb-2">
              Придумайте новый пароль
            </h1>
            <p className="text-[#5A5F5A] text-center mb-6">
              Для аккаунта {email}
            </p>

            {/* Токен восстановления (бета) */}
            <div className="mb-6 p-4 rounded-xl bg-[#EBCB75]/20 border border-[#EBCB75]">
              <p className="text-sm font-medium text-[#20231F] mb-2">
                Токен восстановления{' '}
                <span className="font-normal text-[#5A5F5A]">(бета: вместо письма)</span>
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs text-[#20231F] bg-white border border-[#D6D3CC] rounded-lg px-3 py-2 break-all">
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
                <label className="block text-sm font-medium text-[#20231F] mb-2">Новый пароль</label>
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
                <label className="block text-sm font-medium text-[#20231F] mb-2">
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
                <div className="p-3 rounded-lg bg-[#B85C5C]/10 border border-[#B85C5C] text-[#B85C5C] text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Сохраняем…' : 'Сменить пароль'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-[#20231F] text-center mb-2">
              Восстановление пароля
            </h1>
            <p className="text-[#5A5F5A] text-center mb-8">
              Введите email — мы подготовим токен восстановления
            </p>

            <form onSubmit={requestToken} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#20231F] mb-2">Email</label>
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
                <div className="p-3 rounded-lg bg-[#B85C5C]/10 border border-[#B85C5C] text-[#B85C5C] text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Отправляем…' : 'Получить токен'}
              </button>
            </form>
          </>
        )}
      </div>

      <p className="text-sm text-[#5A5F5A] mt-8">
        <Link href="/login" className="text-[#356B52] font-medium hover:underline">
          ← Вернуться ко входу
        </Link>
      </p>
    </div>
  );
}
