'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import AuthLayout from '@/app/auth-layout';
import Button from '@/components/ui/Button';
import LoadingState from '@/components/ui/LoadingState';
import { CheckIcon } from '@/components/ui/icons';

type Status = 'checking' | 'ok' | 'already' | 'error';

// Подтверждение email по ссылке из письма (/confirm-email?email=…&token=…).
// Токен подтверждается сразу при открытии страницы.
function ConfirmEmailInner() {
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState('');

  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';

  const confirm = useCallback(async (mail: string, confirmationToken: string) => {
    setStatus('checking');
    try {
      const res = await fetch(`${API_URL}/api/auth/confirm-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail, token: confirmationToken }),
      });
      const body = await res.json().catch(() => null);

      if (res.ok && body?.alreadyConfirmed) {
        setStatus('already');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        setMessage(body?.message || 'Ссылка недействительна или устарела.');
        return;
      }

      setStatus('ok');
    } catch {
      setStatus('error');
      setMessage('Сервер недоступен. Попробуйте открыть ссылку позже.');
    }
  }, []);

  useEffect(() => {
    if (!email || !token) {
      setStatus('error');
      setMessage('В ссылке нет email или токена. Запросите письмо заново.');
      return;
    }
    void confirm(email, token);
  }, [email, token, confirm]);

  if (status === 'checking') {
    return (
      <div className="card p-8 text-center">
        <div className="state-orb animate-pulse bg-surface-sunken" aria-hidden="true" />
        <h1 className="mb-2 text-h2 text-ink">Подтверждаем email…</h1>
        <p className="text-body text-slate">Это займёт пару секунд.</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card p-8 text-center">
        <h1 className="mb-2 text-h2 text-ink">Не получилось подтвердить</h1>
        <p className="mb-2 text-body text-slate">{message}</p>
        <p className="mb-6 text-body-sm text-slate">
          Войдите в аккаунт и запросите письмо заново в настройках — мы пришлём новую ссылку.
        </p>
        <Button href="/login" className="w-full">
          Ко входу
        </Button>
      </div>
    );
  }

  return (
    <div className="card p-8 text-center">
      <div className="state-orb bg-surface-accent text-on-accent">
        <CheckIcon size={24} />
      </div>
      <h1 className="mb-2 text-h2 text-ink">
        {status === 'already' ? 'Email уже подтверждён' : 'Email подтверждён'}
      </h1>
      <p className="mb-6 text-body text-slate">
        {status === 'already'
          ? 'Всё в порядке — адрес уже был подтверждён ранее.'
          : 'Спасибо! Теперь мы сможем присылать напоминания и восстановить пароль, если он забудется.'}
      </p>
      <Button href="/dashboard" className="w-full">
        Перейти к занятиям
      </Button>
    </div>
  );
}

export default function ConfirmEmailPage() {
  return (
    <AuthLayout>
      {/* useSearchParams требует границу Suspense при статической отрисовке */}
      <Suspense fallback={<LoadingState rows={3} label="Загрузка страницы" />}>
        <ConfirmEmailInner />
      </Suspense>
    </AuthLayout>
  );
}
