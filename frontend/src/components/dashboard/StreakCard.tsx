'use client';

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
      <div className="animate-pulse bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5 mb-8">
        <div className="h-8 w-40 bg-[var(--color-tint-mint)] rounded mb-3"></div>
        <div className="h-4 w-56 bg-[var(--color-tint-mint)] rounded mb-4"></div>
        <div className="h-2 w-full bg-[var(--color-tint-mint)] rounded-full"></div>
      </div>
    );
  }

  const { currentStreak, longestStreak, dailyGoalMinutes, today, week } = streak;
  const weekDays = week.slice(-7);
  const progress = dailyGoalMinutes > 0 ? Math.min(100, (today.minutesRead / dailyGoalMinutes) * 100) : 0;

  return (
    <section className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5 shadow-sm mb-8">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-2xl font-bold text-[var(--color-ink)] leading-tight">
            🔥 {currentStreak} {pluralizeDays(currentStreak)} подряд
          </p>
          <p className="text-sm text-[var(--color-slate)] mt-1">
            Лучшая серия: {longestStreak} {pluralizeDays(longestStreak)}
          </p>
        </div>
        <div className="flex gap-1.5 pt-1">
          {weekDays.map((day) => (
            <span
              key={day.date}
              title={`${day.date}: ${day.goalMet ? 'цель выполнена' : 'цель не выполнена'}`}
              className={`w-3 h-3 rounded-full ${
                day.goalMet ? 'bg-[var(--color-tint-yellow-bold)]' : 'bg-[var(--color-hairline-strong)]'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-[var(--color-slate)]">
          Сегодня: {today.minutesRead} из {dailyGoalMinutes} минут
        </span>
        {today.goalMet && <span className="text-[var(--color-primary)] font-medium">Цель выполнена ✓</span>}
      </div>
      <div className="h-2 bg-[var(--color-tint-mint)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-primary)] rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </section>
  );
}
