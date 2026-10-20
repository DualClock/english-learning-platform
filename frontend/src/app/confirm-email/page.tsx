'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import AuthLayout from '@/app/auth-layout';

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
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[rgba(201,205,212,0.40)] animate-pulse" />
        <h1 className="text-2xl font-semibold text-ink mb-2">Подтверждаем email…</h1>
        <p className="text-slate">Это займёт пару секунд.</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">Не получилось подтвердить</h1>
        <p className="text-slate mb-6">{message}</p>
        <p className="text-sm text-slate mb-6">
          Войдите в аккаунт и запросите письмо заново в настройках — мы пришлём новую ссылку.
        </p>
        <Link href="/login" className="btn-primary inline-block w-full py-3">
          Ко входу
        </Link>
      </div>
    );
  }

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
      <h1 className="text-2xl font-semibold text-ink mb-2">
        {status === 'already' ? 'Email уже подтверждён' : 'Email подтверждён'}
      </h1>
      <p className="text-slate mb-6">
        {status === 'already'
          ? 'Всё в порядке — адрес уже был подтверждён ранее.'
          : 'Спасибо! Теперь мы сможем присылать напоминания и восстановить пароль, если он забудется.'}
      </p>
      <Link href="/dashboard" className="btn-primary inline-block w-full py-3">
        Перейти к занятиям
      </Link>
    </div>
  );
}

export default function ConfirmEmailPage() {
  return (
    <AuthLayout>
      {/* useSearchParams требует границу Suspense при статической отрисовке */}
      <Suspense fallback={<div className="card p-8 h-64 animate-pulse bg-white" />}>
        <ConfirmEmailInner />
      </Suspense>
    </AuthLayout>
  );
}
