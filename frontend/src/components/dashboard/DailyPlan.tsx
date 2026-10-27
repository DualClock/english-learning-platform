'use client';

import { CardInteractive } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/LoadingState';
import { CheckIcon } from '@/components/ui/icons';
import { useApiQuery } from '@/app/lib/use-api';
import { pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';

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

function StepMark({ done, index }: { done: boolean; index: number }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold transition-colors duration-fast ease-soft ${
        done ? 'bg-primary text-on-primary' : 'border border-hairline-strong bg-canvas text-slate'
      }`}
      aria-hidden="true"
    >
      {done ? <CheckIcon size={16} /> : index}
    </span>
  );
}

export default function DailyPlan() {
  const { data, isLoading } = useApiQuery<TodayPlan>('/api/progress/today-plan');

  if (isLoading && !data) {
    return (
      <section className="mb-8" aria-busy="true">
        <Skeleton className="mb-4 h-6 w-44" />
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const items: PlanItem[] = [
    {
      key: 'review',
      title:
        data.review.due > 0
          ? `Повторить ${formatNumber(data.review.due)} ${pluralWords(data.review.due)}`
          : 'Повторение на сегодня',
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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <div>
          <h2 className="text-h3 text-ink">План на сегодня</h2>
          <p className="mt-1 text-body-sm text-slate">
            {data.itemsCompleted >= data.itemsTotal
              ? 'Всё выполнено — можно читать в удовольствие'
              : 'Три шага, чтобы день засчитался'}
          </p>
        </div>
        <span className="text-body-sm font-medium text-primary tabular-nums">
          {data.itemsCompleted} из {data.itemsTotal}
        </span>
      </div>

      <div className="stagger grid gap-3 md:grid-cols-3">
        {items.map((item, index) => (
          <CardInteractive
            key={item.key}
            href={item.href}
            className={`flex items-start gap-3 p-4 ${item.done ? 'bg-surface-success' : ''}`}
          >
            <StepMark done={item.done} index={index + 1} />
            <span className="min-w-0">
              <span className="block text-body-sm font-medium text-ink">{item.title}</span>
              <span className="mt-1 block text-caption text-slate">{item.subtitle}</span>
            </span>
          </CardInteractive>
        ))}
      </div>
    </section>
  );
}
