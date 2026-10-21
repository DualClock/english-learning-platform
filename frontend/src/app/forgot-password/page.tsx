'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_URL } from '@/app/lib/api-url';
import AuthLayout from '@/app/auth-layout';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import { MailIcon } from '@/components/ui/icons';

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
            <div className="state-orb bg-surface-accent text-on-accent">
              <MailIcon size={24} />
            </div>
            <h1 className="mb-2 text-h2 text-ink">Проверьте почту</h1>
            <p className="text-body text-slate">
              Если аккаунт с адресом <span className="font-medium text-ink">{email}</span> существует,
              мы отправили письмо со ссылкой для сброса пароля. Ссылка действует 24 часа.
            </p>
            <p className="mt-4 text-body-sm text-slate">
              Письма нет? Проверьте «Спам» или запросите ещё раз через пару минут.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mb-2 text-center text-h2 text-ink">Восстановление пароля</h1>
            <p className="mb-8 text-center text-body text-slate">
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

              {error && <Notice tone="danger">{error}</Notice>}

              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? 'Отправляем…' : 'Отправить ссылку'}
              </Button>
            </form>
          </>
        )}
      </div>

      <p className="mt-8 text-center text-body-sm text-slate">
        <Link href="/login" className="font-medium text-link hover:underline">
          ← Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  );
}
