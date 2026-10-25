'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { SignInPage } from '@/components/ui/sign-in';
import Notice from '@/components/ui/Notice';

// Имя СУБД и команда запуска — только для локальной разработки: там это
// экономит минуту на поиске причины. Пользователю на боевом стенде показываем
// нейтральное сообщение.
const DEV_OPS_HINT =
  process.env.NODE_ENV === 'development'
    ? ' Проверьте, что база запущена: docker start english_platform_db.'
    : '';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionExpired(params.get('reason') === 'session-expired');
    setAccountDeleted(params.get('reason') === 'account-deleted');
  }, []);

  const nextPath = (): string => {
    const callback = new URLSearchParams(window.location.search).get('callbackUrl');
    // Только внутренний путь: протокол-относительные //host и внешние URL отсекаем.
    return callback && callback.startsWith('/') && !callback.startsWith('//')
      ? callback
      : '/dashboard';
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
      router.push(nextPath());
    }

    setIsLoading(false);
  };

  return (
    <SignInPage
      title="С возвращением"
      description="Продолжите с того места, где остановились: книги, слова и прогресс уже ждут."
      onSignIn={handleSubmit}
      isLoading={isLoading}
      error={error}
      notices={
        sessionExpired || accountDeleted ? (
          <>
            {sessionExpired && (
              <Notice tone="info">
                Сессия истекла. Войдите снова — книги, слова и прогресс на месте.
              </Notice>
            )}

            {/*
             * Финал пути удаления аккаунта (W2.5.3): сюда попадает человек после
             * «Удалить аккаунт и все данные». Сообщить нужно здесь, а не в
             * настройках, — аккаунта уже нет, и форма настроек больше не откроется.
             */}
            {accountDeleted && (
              <Notice tone="info">
                Аккаунт удалён вместе со словами, прогрессом и загруженными книгами. Если это было
                ошибкой — напишите на hello@lexicon.app, а новый профиль можно завести заново этим же
                адресом.
              </Notice>
            )}
          </>
        ) : undefined
      }
    />
  );
}
