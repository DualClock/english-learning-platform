'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Notice from '@/components/ui/Notice';
import { API_URL } from '@/app/lib/api-url';

interface FeedbackItem {
  id: number;
  subject: string;
  body: string;
  createdAt: string;
  delivered: boolean;
  to: string;
}

const KEY_STORAGE = 'lexicon-feedback-admin-key';

export default function AdminFeedbackClient() {
  const [adminKey, setAdminKey] = useState('');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (key.trim()) headers['X-Seed-Key'] = key.trim();

      const response = await fetch(`${API_URL}/api/feedback?limit=100`, {
        headers,
        cache: 'no-store',
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error('Неверный ключ доступа.');
      }
      if (!response.ok) {
        throw new Error('API не отдал отзывы. Попробуйте ещё раз.');
      }

      const data = (await response.json()) as FeedbackItem[];
      setItems(data);
      try {
        window.sessionStorage.setItem(KEY_STORAGE, key.trim());
      } catch {
        // приватный режим — ключ просто не запомнится
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить отзывы.');
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) {
        setAdminKey(saved);
        void load(saved);
      }
    } catch {
      // sessionStorage недоступен — ждём ключ вручную
    }
  }, [load]);

  return (
    <div className="min-h-screen bg-surface py-10">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <header className="mb-6">
          <p className="text-caption font-medium uppercase tracking-wide text-primary">Админка</p>
          <h1 className="mt-1 text-h1 text-ink">Отзывы беты</h1>
          <p className="mt-2 max-w-measure text-body-sm text-slate">
            Все сообщения из формы обратной связи. Копия каждого отзыва хранится в таблице
            EmailMessages, поэтому письма и SMTP здесь ни при чём.
          </p>
        </header>

        <form
          className="card mb-6 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void load(adminKey);
          }}
        >
          <div className="w-full flex-1">
            <Input
              label="Ключ доступа"
              type="password"
              hint="Seeder__Key из окружения API."
              placeholder="••••••••"
              autoComplete="off"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading} className="shrink-0">
            {loading ? 'Загружаю…' : 'Показать отзывы'}
          </Button>
        </form>

        {error && (
          <div className="mb-6">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        {items && (
          <div className="space-y-4">
            <p className="text-body-sm text-slate">
              {items.length === 0 ? 'Отзывов пока нет.' : `Отзывов: ${items.length}`}
            </p>

            {items.map((item) => (
              <article key={item.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 text-h3 text-ink">{item.subject}</h2>
                  <span
                    className={`badge ${
                      item.delivered
                        ? 'bg-surface-success text-on-success'
                        : 'bg-surface-warning text-on-warning'
                    }`}
                  >
                    {item.delivered ? 'письмо доставлено' : 'сохранено в журнале'}
                  </span>
                </div>
                <p className="mt-1 text-caption text-slate">
                  {new Date(item.createdAt).toLocaleString('ru-RU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {' · '}
                  {item.to}
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-body-sm leading-relaxed text-charcoal">
                  {item.body}
                </pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
