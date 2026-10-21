'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import AuthLayout from '@/app/auth-layout';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import LoadingState from '@/components/ui/LoadingState';
import Notice from '@/components/ui/Notice';
import { CheckIcon } from '@/components/ui/icons';

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
        <div className="state-orb bg-surface-accent text-on-accent">
          <CheckIcon size={24} />
        </div>
        <h1 className="mb-2 text-h2 text-ink">Пароль изменён</h1>
        <p className="text-body text-slate">Сейчас перенаправим на страницу входа…</p>
      </div>
    );
  }

  if (!linkIsValid) {
    return (
      <div className="card p-8 text-center">
        <h1 className="mb-2 text-h2 text-ink">Ссылка неполная</h1>
        <p className="mb-6 text-body text-slate">
          В ссылке нет email или токена. Запросите письмо заново — оно придёт с новой ссылкой.
        </p>
        <Button href="/forgot-password" className="w-full">
          Запросить письмо заново
        </Button>
      </div>
    );
  }

  return (
    <div className="card p-8">
      <h1 className="mb-2 text-center text-h2 text-ink">Придумайте новый пароль</h1>
      <p className="mb-6 break-all text-center text-body text-slate">Для аккаунта {email}</p>

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

        {error && <Notice tone="danger">{error}</Notice>}

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
      <Suspense fallback={<LoadingState rows={3} label="Загрузка формы" />}>
        <ResetPasswordForm />
      </Suspense>

      <p className="mt-8 text-center text-body-sm text-slate">
        <Link href="/login" className="font-medium text-link hover:underline">
          ← Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  );
}
