'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
      setError('Неверный email или пароль');
    } else {
      router.push('/dashboard');
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col items-center justify-center p-6">
      {/* Лого */}
      <Link href="/" className="text-3xl font-bold text-[#20231F] mb-8">
        Lexicon
      </Link>

      {/* Карточка */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#D6D3CC] p-8">
        <h1 className="text-2xl font-bold text-[#20231F] text-center mb-2">
          С возвращением 👋
        </h1>
        <p className="text-[#5A5F5A] text-center mb-8">
          Продолжим читать?
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#20231F] mb-2">
              Email
            </label>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full px-4 py-3 rounded-lg border border-[#D6D3CC] focus:outline-none focus:ring-2 focus:ring-[#356B52] focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#20231F] mb-2">
              Пароль
            </label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-lg border border-[#D6D3CC] focus:outline-none focus:ring-2 focus:ring-[#356B52] focus:border-transparent"
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
            {isLoading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/forgot-password" className="text-sm text-[#5A5F5A] hover:text-[#356B52] hover:underline">
            Забыли пароль?
          </Link>
        </div>

        <div className="mt-6 text-center">
          <span className="text-[#5A5F5A]">Нет аккаунта? </span>
          <Link href="/onboarding" className="text-[#356B52] font-medium hover:underline">
            Зарегистрироваться
          </Link>
        </div>
      </div>

      {/* Футер */}
      <p className="text-sm text-[#5A5F5A] mt-8">
        Читай. Учи. Помни.
      </p>
    </div>
  );
}