'use client';

import Link from 'next/link';
import { useApiQuery } from '@/app/lib/use-api';

interface TodayPlan {
  date: string;
  goal: {
    minutesRead: number;
    goalMinutes: number;
    wordsReviewed: number;
    goalMet: boolean;
  };
  review: {
    due: number;
    target: number;
    done: number;
    completed: boolean;
  };
  reading: {
    bookId: number;
    title: string;
    page: number;
    totalPages: number;
    percent: number;
    coverUrl?: string | null;
    completed: boolean;
  } | null;
  grammar: {
    unitId: number;
    title: string;
    level: string;
    section?: string | null;
    completed: boolean;
  } | null;
  itemsCompleted: number;
  itemsTotal: number;
}

interface PlanItem {
  key: string;
  title: string;
  subtitle: string;
  href: string;
  done: boolean;
}

function pluralWords(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} слово`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} слова`;
  return `${n} слов`;
}

function CheckCircle({ done, index }: { done: boolean; index: number }) {
  return (
    <span
      className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
        done
          ? 'bg-[var(--color-primary)] text-white'
          : 'bg-white border-2 border-[var(--color-hairline-strong)] text-[var(--color-slate)]'
      }`}
      aria-hidden="true"
    >
      {done ? '✓' : index}
    </span>
  );
}

export default function DailyPlan() {
  const { data, isLoading } = useApiQuery<TodayPlan>('/api/progress/today-plan');

  if (isLoading && !data) {
    return (
      <section className="mb-8">
        <div className="h-6 w-40 rounded bg-[var(--color-tint-mint)] animate-pulse mb-4" />
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-4 h-24 animate-pulse bg-white" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const items: PlanItem[] = [
    {
      key: 'review',
      title: data.review.due > 0 ? `Повторить ${pluralWords(data.review.due)}` : 'Повторение на сегодня',
      subtitle: data.review.due > 0
        ? `Пройдено ${data.review.done} из ${data.review.target}`
        : 'Нет слов к повторению',
      href: '/review',
      done: data.review.completed,
    },
    {
      key: 'reading',
      title: data.reading ? `Продолжить «${data.reading.title}»` : 'Добавить книгу',
      subtitle: data.reading
        ? `Страница ${data.reading.page} из ${data.reading.totalPages} · ${Math.round(data.reading.percent)}%`
        : 'Выберите книгу в библиотеке',
      href: data.reading ? `/reader/${data.reading.bookId}` : '/books',
      done: data.reading?.completed ?? false,
    },
    {
      key: 'grammar',
      title: data.grammar ? `Грамматика: ${data.grammar.title}` : 'Все юниты пройдены',
      subtitle: data.grammar
        ? `Уровень ${data.grammar.level?.toUpperCase()}${data.grammar.section ? ` · ${data.grammar.section}` : ''}`
        : 'Отличная работа!',
      href: data.grammar ? `/grammar/${data.grammar.unitId}` : '/grammar',
      done: data.grammar?.completed ?? true,
    },
  ];

  return (
    <section className="mb-8" aria-label="План на сегодня">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">План на сегодня</h2>
          <p className="text-sm text-[var(--color-slate)]">
            {data.itemsCompleted >= data.itemsTotal
              ? 'Всё выполнено — можно читать в удовольствие'
              : 'Три шага, чтобы день засчитался'}
          </p>
        </div>
        <span className="text-sm font-semibold text-[var(--color-primary)]">
          {data.itemsCompleted} из {data.itemsTotal}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3 stagger">
        {items.map((item, index) => (
          <Link
            key={item.key}
            href={item.href}
            className={`card p-4 flex items-start gap-3 transition-shadow hover:shadow-md ${
              item.done ? 'bg-[var(--color-tint-mint)]' : ''
            }`}
          >
            <CheckCircle done={item.done} index={index + 1} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--color-ink)] leading-snug">
                {item.title}
              </span>
              <span className="block text-xs text-[var(--color-slate)] mt-1">{item.subtitle}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
