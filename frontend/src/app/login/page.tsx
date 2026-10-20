'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthLayout from '@/app/auth-layout';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Читаем значения из DOM, а не из state: менеджеры паролей
    // заполняют поля, минуя React onChange, и state остаётся пустым
    const formData = new FormData(e.currentTarget);
    const submittedEmail = String(formData.get('email') || '').trim();
    const submittedPassword = String(formData.get('password') || '');

    const result = await signIn('credentials', {
      email: submittedEmail,
      password: submittedPassword,
      redirect: false,
    });

    if (result?.error) {
      setError(await describeFailure());
    } else {
      router.push('/dashboard');
    }

    setIsLoading(false);
  };

  // signIn отдаёт одинаковую ошибку и на неверный пароль, и на упавший бэкенд.
  // Спрашиваем /health, чтобы не писать «неверный пароль», когда лежит база.
  const describeFailure = async (): Promise<string> => {
    try {
      // Короткий таймаут: сообщение об ошибке не должно ждать зависший health
      const res = await fetch('/api/backend-status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      const status = await res.json();
      if (!status?.ok) {
        return 'Сервис временно недоступен: нет связи с базой данных. Запустите Postgres (docker start english_platform_db) и попробуйте снова.';
      }
    } catch {
      // проверка не удалась — считаем, что дело в пароле
    }

    return 'Неверный email или пароль';
  };

  return (    <AuthLayout>
      <div className="card p-8 animate-pop-in">
        <h1 className="text-2xl font-semibold text-ink text-center mb-2">
          С возвращением 👋
        </h1>
        <p className="text-slate text-center mb-8">
          Продолжим читать?
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <Input
            type="password"
            name="password"
            label="Пароль"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          {error && (
            <div className="p-3 rounded-md bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? 'Вход...' : 'Войти'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/forgot-password" className="text-sm text-link hover:underline">
            Забыли пароль?
          </Link>
        </div>

        <div className="mt-6 text-center">
          <span className="text-slate">Нет аккаунта? </span>
          <Link href="/onboarding" className="text-link font-medium hover:underline">
            Зарегистрироваться
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
