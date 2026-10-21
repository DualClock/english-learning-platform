'use client';

import ProgressBar from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/LoadingState';
import { CheckIcon, FlameIcon } from '@/components/ui/icons';

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  dailyGoalMinutes: number;
  today: { minutesRead: number; wordsReviewed: number; goalMet: boolean };
  week: { date: string; goalMet: boolean; minutesRead: number }[];
}

interface Props {
  streak: StreakData | null;
}

function pluralizeDays(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

export default function StreakCard({ streak }: Props) {
  if (!streak) {
    return (
      <section className="card mb-8" aria-busy="true">
        <Skeleton className="mb-3 h-8 w-44" />
        <Skeleton className="mb-5 h-4 w-56" />
        <Skeleton className="h-2 w-full rounded-full" />
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
              {currentStreak} {pluralizeDays(currentStreak)} подряд
            </p>
            <p className="mt-1 text-body-sm text-slate tabular-nums">
              Лучшая серия: {longestStreak} {pluralizeDays(longestStreak)}
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
