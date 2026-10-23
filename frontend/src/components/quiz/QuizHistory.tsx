'use client';

import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import { BookOpenIcon, HeadphonesIcon } from '@/components/ui/icons';

interface QuizHistoryItem {
  id: number;
  mode: string;
  correct: number;
  total: number;
  createdAt: string;
}

interface QuizHistoryResponse {
  items?: QuizHistoryItem[];
}

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});

export default function QuizHistory() {
  const { status } = useSession();
  const { data } = useApiQuery<QuizHistoryResponse>('/api/review/quiz/history?limit=5', {
    enabled: status === 'authenticated',
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="card mb-6 p-6" aria-labelledby="quiz-history-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="quiz-history-title" className="text-h3 text-ink">
          Последние тесты
        </h2>
        <span className="text-caption text-slate">сохранённые результаты</span>
      </div>

      <ul className="divide-y divide-hairline">
        {items.map((item) => {
          const listening = item.mode === 'listening';
          const percentage = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
          const Icon = listening ? HeadphonesIcon : BookOpenIcon;
          const date = new Date(item.createdAt);
          const dateLabel = Number.isNaN(date.getTime())
            ? ''
            : DATE_FORMAT.format(date);

          return (
            <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-slate">
                <Icon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-ink">
                  {listening ? 'Аудирование' : 'Чтение'}
                </p>
                <p className="text-caption text-slate">
                  {item.correct} из {item.total} · {percentage}%
                </p>
              </div>
              {dateLabel && (
                <time
                  dateTime={item.createdAt}
                  className="shrink-0 text-caption text-slate"
                >
                  {dateLabel}
                </time>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
