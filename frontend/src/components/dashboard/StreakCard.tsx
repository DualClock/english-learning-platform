'use client';

import ProgressBar from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/LoadingState';
import { AlertIcon, CheckIcon, FlameIcon } from '@/components/ui/icons';
import { pluralDays } from '@/lib/plural';
import type { WidgetState } from '@/components/dashboard/dashboard-state';

/*
 * Карточка серии дней.
 *
 * Было: `if (!streak) return <Скелетон/>`. Ветка не различала «ещё грузится»
 * и «не пришло никогда», поэтому при упавшем /api/progress/streak человек
 * видел бесконечный пульсирующий прямоугольник — интерфейс, который выглядит
 * сломанным и ничего не объясняет.
 *
 * Теперь состояние приходит снаружи: скелетон только на `loading`, на ошибке —
 * короткая строка «не удалось загрузить» вместо украденного места на экране.
 */

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  dailyGoalMinutes: number;
  today: { minutesRead: number; wordsReviewed: number; goalMet: boolean };
  week: { date: string; goalMet: boolean; minutesRead: number }[];
}

interface Props {
  state: WidgetState;
  streak: StreakData | null;
  onRetry?: () => void;
}

export default function StreakCard({ state, streak, onRetry }: Props) {
  if (state === 'loading') {
    return (
      <section className="card mb-8" aria-busy="true">
        <Skeleton className="mb-3 h-8 w-44" />
        <Skeleton className="mb-5 h-4 w-56" />
        <Skeleton className="h-2 w-full rounded-full" />
      </section>
    );
  }

  if (state === 'error' || !streak) {
    return (
      <section className="card mb-8" aria-live="polite">
        <div className="flex items-center gap-3 text-body-sm text-slate">
          <AlertIcon size={16} className="shrink-0 text-semantic-error" />
          <span>Серия дней не загрузилась.</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-auto shrink-0 text-primary underline decoration-hairline-strong underline-offset-4 hover:text-ink"
            >
              Повторить
            </button>
          )}
        </div>
      </section>
    );
  }

  const { currentStreak, longestStreak, dailyGoalMinutes, today, week } = streak;
  const weekDays = week.slice(-7);
  const progress =
    dailyGoalMinutes > 0 ? Math.min(100, (today.minutesRead / dailyGoalMinutes) * 100) : 0;

  return (
    <section className="card animate-rise-in mb-8" aria-label="Серия дней">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface-highlight text-primary">
            <FlameIcon size={20} />
          </span>
          <span>
            <p className="text-h2 text-ink tabular-nums">
              {currentStreak} {pluralDays(currentStreak)} подряд
            </p>
            <p className="mt-1 text-body-sm text-slate tabular-nums">
              Лучшая серия: {longestStreak} {pluralDays(longestStreak)}
            </p>
          </span>
        </div>

        <ul className="flex gap-1.5 pt-2" aria-label="Последние семь дней">
          {weekDays.map((day) => (
            <li
              key={day.date}
              title={`${day.date}: ${day.goalMet ? 'цель выполнена' : 'цель не выполнена'}`}
              className={`h-3 w-3 rounded-full ${
                day.goalMet ? 'bg-primary' : 'bg-hairline-strong'
              }`}
            />
          ))}
        </ul>
      </div>

      <div className="mb-2 flex items-center justify-between text-body-sm">
        <span className="text-slate tabular-nums">
          Сегодня: {today.minutesRead} из {dailyGoalMinutes} минут
        </span>
        {today.goalMet && (
          <span className="inline-flex items-center gap-1.5 font-medium text-primary">
            <CheckIcon size={16} />
            Цель выполнена
          </span>
        )}
      </div>
      <ProgressBar value={progress} />
    </section>
  );
}
