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
      <div className="animate-pulse bg-white rounded-2xl border border-[#D6D3CC] p-5 mb-8">
        <div className="h-8 w-40 bg-[#E7ECE4] rounded mb-3"></div>
        <div className="h-4 w-56 bg-[#E7ECE4] rounded mb-4"></div>
        <div className="h-2 w-full bg-[#E7ECE4] rounded-full"></div>
      </div>
    );
  }

  const { currentStreak, longestStreak, dailyGoalMinutes, today, week } = streak;
  const weekDays = week.slice(-7);
  const progress = dailyGoalMinutes > 0 ? Math.min(100, (today.minutesRead / dailyGoalMinutes) * 100) : 0;

  return (
    <section className="bg-white rounded-2xl border border-[#D6D3CC] p-5 shadow-sm mb-8">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-2xl font-bold text-[#20231F] leading-tight">
            🔥 {currentStreak} {pluralizeDays(currentStreak)} подряд
          </p>
          <p className="text-sm text-[#5A5F5A] mt-1">
            Лучшая серия: {longestStreak} {pluralizeDays(longestStreak)}
          </p>
        </div>
        <div className="flex gap-1.5 pt-1">
          {weekDays.map((day) => (
            <span
              key={day.date}
              title={`${day.date}: ${day.goalMet ? 'цель выполнена' : 'цель не выполнена'}`}
              className={`w-3 h-3 rounded-full ${
                day.goalMet ? 'bg-[#EBCB75]' : 'bg-[#D6D3CC]'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-[#5A5F5A]">
          Сегодня: {today.minutesRead} из {dailyGoalMinutes} минут
        </span>
        {today.goalMet && <span className="text-[#356B52] font-medium">Цель выполнена ✓</span>}
      </div>
      <div className="h-2 bg-[#E7ECE4] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#356B52] rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </section>
  );
}
