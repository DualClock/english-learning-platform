'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import AuthLayout from '@/app/auth-layout';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

// Форма нового пароля. Email и токен приходят в ссылке из письма
// (/reset-password?email=…&token=…), поэтому вводить их вручную не нужно.
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setEmail(searchParams.get('email') ?? '');
    setToken(searchParams.get('token') ?? '');
  }, [searchParams]);

  const linkIsValid = email.length > 0 && token.length > 0;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
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
        body: JSON.stringify({ email, resetToken: token, newPassword }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // Identity отдаёт список ошибок (слабый пароль и т.п.)
        const details = Array.isArray(body?.errors) ? body.errors.join(' ') : '';
        setError(details || body?.message || 'Не удалось сбросить пароль. Запросите новую ссылку.');
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

  if (success) {
    return (
      <div className="card p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgba(14,124,123,0.10)] flex items-center justify-center">
          <svg
            className="w-8 h-8 text-[var(--color-primary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-ink mb-2">Пароль изменён</h1>
        <p className="text-slate">Сейчас перенаправим на страницу входа…</p>
      </div>
    );
  }

  if (!linkIsValid) {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">Ссылка неполная</h1>
        <p className="text-slate mb-6">
          В ссылке нет email или токена. Запросите письмо заново — оно придёт с новой ссылкой.
        </p>
        <Link href="/forgot-password" className="btn-primary inline-block w-full py-3">
          Запросить письмо заново
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-8">
      <h1 className="text-2xl font-semibold text-ink text-center mb-2">Придумайте новый пароль</h1>
      <p className="text-slate text-center mb-6 break-all">Для аккаунта {email}</p>

      <form onSubmit={submit} className="space-y-4">
        <Input
          type="password"
          name="new-password"
          label="Новый пароль"
          autoComplete="new-password"
          placeholder="Минимум 6 символов"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={6}
        />

        <Input
          type="password"
          name="repeat-password"
          label="Повторите новый пароль"
          autoComplete="new-password"
          value={repeatPassword}
          onChange={(e) => setRepeatPassword(e.target.value)}
          required
          minLength={6}
        />

        {error && (
          <div
            className="p-3 rounded-md bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm"
            role="alert"
          >
            {error}
          </div>
        )}

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'Сохраняем…' : 'Сменить пароль'}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      {/* useSearchParams требует границу Suspense при статической отрисовке */}
      <Suspense fallback={<div className="card p-8 h-64 animate-pulse bg-white" />}>
        <ResetPasswordForm />
      </Suspense>

      <p className="text-sm text-slate mt-8 text-center">
        <Link href="/login" className="text-link font-medium hover:underline">
          ← Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  );
}
