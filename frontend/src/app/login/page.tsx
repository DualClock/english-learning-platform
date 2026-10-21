'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthLayout from '@/app/auth-layout';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';

// Имя СУБД и команда запуска — только для локальной разработки: там это
// экономит минуту на поиске причины. Пользователю на боевом стенде показываем
// нейтральное сообщение.
const DEV_OPS_HINT =
  process.env.NODE_ENV === 'development'
    ? ' Проверьте, что база запущена: docker start english_platform_db.'
    : '';

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
        return `Сервис временно недоступен: нет связи с сервером.${DEV_OPS_HINT}`;
      }
    } catch {
      // проверка не удалась — считаем, что дело в пароле
    }

    return 'Неверный email или пароль';
  };

  return (
    <AuthLayout>
      <div className="card animate-pop-in p-8">
        <h1 className="mb-2 text-center text-h2 text-ink">С возвращением</h1>
        <p className="mb-8 text-center text-body text-slate">Продолжим читать?</p>

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

          {error && <Notice tone="danger">{error}</Notice>}

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? 'Вход…' : 'Войти'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/forgot-password" className="text-body-sm text-link hover:underline">
            Забыли пароль?
          </Link>
        </div>

        <div className="mt-6 text-center text-body text-slate">
          <span>Нет аккаунта? </span>
          <Link href="/onboarding" className="font-medium text-link hover:underline">
            Зарегистрироваться
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
