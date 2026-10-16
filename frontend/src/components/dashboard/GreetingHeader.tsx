'use client';

import Link from 'next/link';

interface Props {
  name?: string | null;
  level?: string | null;
}

export default function GreetingHeader({ name, level }: Props) {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour >= 5 && hour < 12
      ? 'Доброе утро'
      : hour >= 12 && hour < 18
        ? 'Добрый день'
        : hour >= 18 && hour < 23
          ? 'Добрый вечер'
          : 'Доброй ночи';

  const dateStr = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);

  return (
    <header className="mb-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-[var(--color-primary-pressed)] mb-1 capitalize">{dateStr}</p>
          <h1 className="text-2xl md:text-3xl font-bold text-[var(--color-ink)] tracking-tight">
            {greeting}, {name?.trim() || 'друг'}
          </h1>
          <p className="text-[var(--color-slate)] mt-2">
            Немного чтения каждый день — и словарный запас растёт сам.
          </p>
        </div>
        {level ? (
          <span
            title="Пересдать тест можно в настройках"
            className="shrink-0 text-sm font-semibold px-3 py-1.5 rounded-full bg-[rgba(249,231,159,0.30)] border border-[var(--color-tint-yellow-bold)] text-[var(--color-ink)]"
          >
            Уровень: {level.toUpperCase()}
          </span>
        ) : (
          <Link
            href="/onboarding"
            className="shrink-0 text-sm font-semibold px-3 py-1.5 rounded-full border-2 border-dashed border-[var(--color-primary-pressed)] text-[var(--color-primary)] hover:bg-[var(--color-tint-mint)] transition-colors"
          >
            Определить уровень
          </Link>
        )}
      </div>
    </header>
  );
}
