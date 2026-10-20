'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_URL } from '@/app/lib/api-url';
import AuthLayout from '@/app/auth-layout';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

// Запрос письма со ссылкой на сброс пароля.
// Токен приходит письмом (страница /reset-password), в ответе API его больше нет.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const requestReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const submittedEmail = String(formData.get('email') || email).trim();

    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: submittedEmail }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setError(body?.message || 'Не удалось отправить письмо. Попробуйте ещё раз.');
        return;
      }

      setSent(true);
    } catch {
      setError('Сервер недоступен. Попробуйте позже.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="card p-8">
        {sent ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgba(14,124,123,0.10)] flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[var(--color-primary)]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-ink mb-2">Проверьте почту</h1>
            <p className="text-slate">
              Если аккаунт с адресом <span className="font-medium text-ink">{email}</span> существует,
              мы отправили письмо со ссылкой для сброса пароля. Ссылка действует 24 часа.
            </p>
            <p className="text-sm text-slate mt-4">
              Письма нет? Проверьте «Спам» или запросите ещё раз через пару минут.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-ink text-center mb-2">
              Восстановление пароля
            </h1>
            <p className="text-slate text-center mb-8">
              Введите email — пришлём ссылку для нового пароля
            </p>

            <form onSubmit={requestReset} className="space-y-4">
              <Input
                type="email"
                name="email"
                label="Email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                required
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
                {isLoading ? 'Отправляем…' : 'Отправить ссылку'}
              </Button>
            </form>
          </>
        )}
      </div>

      <p className="text-sm text-slate mt-8 text-center">
        <Link href="/login" className="text-link font-medium hover:underline">
          ← Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  );
}
