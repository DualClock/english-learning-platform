'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import WeeklyLeague from '@/components/progress/WeeklyLeague';

interface Achievement {
  code: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  target: number;
}

interface UserProgress {
  xp: number;
  level: number;
  levelTitle: string;
  levelStartXp: number;
  nextLevelXp: number | null;
  xpToNextLevel: number | null;
  levelProgressPercent: number;
  metrics: {
    words: number;
    reviews: number;
    books: number;
    pages: number;
    grammarUnits: number;
    categoriesLearned: number;
    activeDays: number;
    streak: number;
    xp: number;
  };
  achievements: Achievement[];
  unlockedCount: number;
}

interface WeekDay {
  date: string;
  goalMet: boolean;
  minutesRead: number;
}

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  dailyGoalMinutes: number;
  week: WeekDay[];
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function weekdayShort(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : WEEKDAYS[parsed.getDay()];
}

/** Русская плюрализация: plural(1, ['слово','слова','слов']) → 'слово'. */
function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-bold text-[var(--color-ink)] leading-none">{value}</div>
      <div className="text-sm text-[var(--color-slate)] mt-1.5">{label}</div>
      {hint && <div className="text-xs text-[var(--color-slate)] mt-0.5 opacity-80">{hint}</div>}
    </div>
  );
}

export default function ProgressPage() {
  const { status } = useSession();

  const { data: progress, isLoading: progressLoading } = useApiQuery<UserProgress>(
    '/api/progress/achievements',
    { enabled: status === 'authenticated' }
  );

  const { data: streak } = useApiQuery<StreakData>('/api/progress/streak', {
    enabled: status === 'authenticated',
  });

  if (status === 'loading' || (progressLoading && !progress)) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto">
          <div className="h-8 w-48 rounded bg-[var(--color-tint-mint)] animate-pulse mb-6" />
          <div className="card p-6 h-32 animate-pulse bg-white mb-6" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-4 h-24 animate-pulse bg-white" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!progress) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto card p-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--color-ink)] mb-2">Прогресс недоступен</h1>
          <p className="text-[var(--color-slate)] mb-6">Не удалось загрузить статистику. Попробуйте обновить страницу.</p>
          <Link href="/dashboard" className="btn-primary">
            На главную
          </Link>
        </div>
      </AppLayout>
    );
  }

  const { metrics, achievements } = progress;
  const week = streak?.week ?? [];
  const weekMinutes = week.reduce((sum, day) => sum + day.minutesRead, 0);
  const maxMinutes = Math.max(10, ...week.map((d) => d.minutesRead));
  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">Прогресс</h1>
          <p className="text-[var(--color-slate)]">Как идёт обучение и что уже получилось</p>
        </div>

        {/* Уровень */}
        <section className="card p-6 mb-6">
          <div className="flex flex-wrap items-center gap-5">
            <div className="w-16 h-16 shrink-0 rounded-2xl bg-[var(--color-tint-mint)] flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-slate)]">уровень</span>
              <span className="text-2xl font-bold text-[var(--color-primary)] leading-none">{progress.level}</span>
            </div>
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{progress.levelTitle}</h2>
                <span className="text-sm text-[var(--color-slate)]">{progress.xp} XP</span>
              </div>
              <div
                className="h-2.5 rounded-full bg-[rgba(201,205,212,0.40)] overflow-hidden"
                role="progressbar"
                aria-valuenow={progress.levelProgressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-[var(--color-primary)] transition-all"
                  style={{ width: `${progress.levelProgressPercent}%` }}
                />
              </div>
              <p className="text-xs text-[var(--color-slate)] mt-2">
                {progress.xpToNextLevel != null
                  ? `До ${progress.level + 1} уровня — ${progress.xpToNextLevel} XP`
                  : 'Максимальный уровень — вы легенда'}
              </p>
            </div>
          </div>
        </section>

        {/* Цифры */}
        <section className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <StatTile label={`${plural(metrics.words, ['слово', 'слова', 'слов'])} в словаре`} value={metrics.words} />
          <StatTile
            label={`${plural(metrics.reviews, ['повторение', 'повторения', 'повторений'])} сделано`}
            value={metrics.reviews}
          />
          <StatTile
            label={`${plural(metrics.books, ['книга', 'книги', 'книг'])} в библиотеке`}
            value={metrics.books}
            hint={`${metrics.pages} ${plural(metrics.pages, ['страница', 'страницы', 'страниц'])} прочитано`}
          />
          <StatTile
            label={`${plural(metrics.grammarUnits, ['юнит', 'юнита', 'юнитов'])} грамматики`}
            value={metrics.grammarUnits}
          />
          <StatTile
            label={`${plural(streak?.currentStreak ?? metrics.streak, ['день', 'дня', 'дней'])} подряд`}
            value={streak?.currentStreak ?? metrics.streak}
            hint={streak ? `лучший стрик — ${streak.longestStreak}` : undefined}
          />
          <StatTile
            label={`${plural(metrics.activeDays, ['день', 'дня', 'дней'])} с целью`}
            value={metrics.activeDays}
            hint="цель выполнена"
          />
        </section>

        {/* Неделя */}
        {week.length > 0 && (
          <section className="card p-6 mb-6">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="text-lg font-semibold text-[var(--color-ink)]">Эта неделя</h2>
              <span className="text-sm text-[var(--color-slate)]">{weekMinutes} минут чтения</span>
            </div>

            {weekMinutes === 0 ? (
              <p className="text-sm text-[var(--color-slate)]">
                На этой неделе чтения пока не было — начните с одной страницы.
              </p>
            ) : (
              <div className="flex items-end justify-between gap-2 h-32">
                {week.map((day) => {
                  const height = day.minutesRead > 0
                    ? Math.max(10, Math.round((day.minutesRead / maxMinutes) * 112))
                    : 4;
                  return (
                    <div key={day.date} className="flex-1 h-full flex flex-col items-center justify-end gap-2">
                      <div
                        className={`w-full rounded-t-lg transition-all ${
                          day.goalMet
                            ? 'bg-[var(--color-primary)]'
                            : day.minutesRead > 0
                              ? 'bg-[rgba(14,124,123,0.35)]'
                              : 'bg-[rgba(201,205,212,0.40)]'
                        }`}
                        style={{ height: `${height}px` }}
                        title={`${day.date}: ${day.minutesRead} мин${day.goalMet ? ' · цель выполнена' : ''}`}
                      />
                      <span className="text-xs text-[var(--color-slate)]">{weekdayShort(day.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Лига недели */}
        <WeeklyLeague />

        {/* Достижения */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">Достижения</h2>
            <span className="text-sm text-[var(--color-slate)]">
              {progress.unlockedCount} из {achievements.length}
            </span>
          </div>

          {unlocked.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-4">
              {unlocked.map((achievement) => (
                <div key={achievement.code} className="card p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl" aria-hidden="true">{achievement.icon}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--color-ink)]">{achievement.title}</div>
                      <p className="text-xs text-[var(--color-slate)] mt-0.5">{achievement.description}</p>
                      {achievement.unlockedAt && (
                        <p className="text-[11px] text-[var(--color-primary)] mt-1">
                          Получено {new Date(achievement.unlockedAt).toLocaleDateString('ru-RU')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {locked.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-[var(--color-slate)] mb-3">Впереди</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {locked.map((achievement) => {
                  const percent = achievement.target > 0
                    ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
                    : 0;
                  return (
                    <div key={achievement.code} className="card p-4 opacity-80">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl grayscale" aria-hidden="true">{achievement.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-[var(--color-ink)]">{achievement.title}</div>
                          <p className="text-xs text-[var(--color-slate)] mt-0.5">{achievement.description}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-[rgba(201,205,212,0.40)] overflow-hidden">
                              <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="text-[11px] text-[var(--color-slate)] shrink-0">
                              {achievement.progress}/{achievement.target}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary">
            Продолжить обучение
          </Link>
          <Link href="/review" className="btn-secondary">
            К повторению
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
