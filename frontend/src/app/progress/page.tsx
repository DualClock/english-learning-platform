'use client';

import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState, { Skeleton } from '@/components/ui/LoadingState';
import ProgressBar from '@/components/ui/ProgressBar';
import { ArrowRightIcon, BookOpenIcon, BulbIcon, CheckCircleIcon, CloseIcon } from '@/components/ui/icons';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import WeeklyLeague from '@/components/progress/WeeklyLeague';
import QuizHistory from '@/components/quiz/QuizHistory';
import AchievementIcon from '@/components/progress/AchievementIcon';
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABEL,
  ACHIEVEMENT_RARITY_CLASS,
  ACHIEVEMENT_RARITY_LABEL,
  achievementCategory,
  achievementRarity,
  type AchievementCategory,
} from '@/components/progress/achievementMeta';
import { plural } from '@/lib/plural';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';

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

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <li className="card p-4">
      <div className="text-h2 leading-none text-ink">{value}</div>
      <div className="mt-1.5 text-body-sm text-slate">{label}</div>
      {hint && <div className="mt-0.5 text-caption text-slate">{hint}</div>}
    </li>
  );
}

function AchievementCard({
  achievement,
  onSelect,
}: {
  achievement: Achievement;
  onSelect: () => void;
}) {
  const rarity = achievementRarity(achievement.target);
  const percent = achievement.target > 0
    ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
    : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-haspopup="dialog"
      className="card-interactive w-full p-4 text-left"
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
            achievement.unlocked
              ? 'bg-surface-accent text-on-accent'
              : 'bg-surface-sunken text-slate'
          }`}
        >
          <AchievementIcon code={achievement.code} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-body-sm font-semibold text-ink">{achievement.title}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold ${
                ACHIEVEMENT_RARITY_CLASS[rarity]
              }`}
            >
              {ACHIEVEMENT_RARITY_LABEL[rarity]}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-slate">
            {achievement.description}
          </p>
          {achievement.unlocked ? (
            <p className="mt-2 flex items-center gap-1.5 text-caption text-primary">
              <CheckCircleIcon size={16} />
              {achievement.unlockedAt
                ? `Получено ${new Date(achievement.unlockedAt).toLocaleDateString('ru-RU')}`
                : 'Получено'}
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar
                className="flex-1"
                value={percent}
                label={`${achievement.title}: ${achievement.progress} из ${achievement.target}`}
              />
              <span className="shrink-0 text-caption tabular-nums text-slate">
                {achievement.progress}/{achievement.target}
              </span>
            </div>
          )}
        </div>

        <ArrowRightIcon size={16} className="mt-1 shrink-0 text-slate" />
      </div>
    </button>
  );
}

function AchievementDialog({
  achievement,
  onClose,
  closeRef,
}: {
  achievement: Achievement;
  onClose: () => void;
  closeRef: RefObject<HTMLButtonElement>;
}) {
  const rarity = achievementRarity(achievement.target);
  const category = achievementCategory(achievement.code);
  const percent = achievement.target > 0
    ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
    : 0;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-dialog-title"
        className="card relative max-h-[90dvh] w-full max-w-md overflow-y-auto p-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
        >
          <CloseIcon size={20} />
        </button>

        <div className="flex items-start gap-4 pr-12">
          <span
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg ${
              achievement.unlocked
                ? 'bg-surface-accent text-on-accent'
                : 'bg-surface-sunken text-slate'
            }`}
          >
            <AchievementIcon code={achievement.code} size={24} />
          </span>
          <div className="min-w-0">
            <p className="text-caption font-medium uppercase tracking-wide text-slate">
              Достижение
            </p>
            <h2 id="achievement-dialog-title" className="mt-1 text-h2 text-ink">
              {achievement.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${ACHIEVEMENT_RARITY_CLASS[rarity]}`}>
                {ACHIEVEMENT_RARITY_LABEL[rarity]}
              </span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-caption text-slate">
                {ACHIEVEMENT_CATEGORY_LABEL[category]}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-surface p-4">
          <h3 className="text-body-sm font-semibold text-ink">Как получить</h3>
          <p className="mt-1 text-body-sm leading-relaxed text-slate">{achievement.description}</p>
          <div className="mt-4 flex items-center justify-between gap-2 text-caption text-slate">
            <span>Прогресс</span>
            <span className="tabular-nums text-ink">
              {achievement.progress} из {achievement.target}
            </span>
          </div>
          <ProgressBar
            className="mt-2"
            value={percent}
            label={`${achievement.title}: ${achievement.progress} из ${achievement.target}`}
          />
        </div>

        <p className={`mt-4 text-body-sm ${achievement.unlocked ? 'text-primary' : 'text-slate'}`}>
          {achievement.unlocked
            ? achievement.unlockedAt
              ? `Получено ${new Date(achievement.unlockedAt).toLocaleDateString('ru-RU')}`
              : 'Уже в коллекции'
            : `Осталось ${Math.max(0, achievement.target - achievement.progress)}`}
        </p>

        <Button variant="secondary" onClick={onClose} className="mt-5 h-11 w-full">
          Закрыть
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default function ProgressPage() {
  const { status } = useSession();
  const [achievementFilter, setAchievementFilter] = useState<'all' | AchievementCategory>('all');
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const achievementCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selectedAchievement) return;
    achievementCloseRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAchievement(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedAchievement]);

  const {
    data: progress,
    isLoading: progressLoading,
    refresh: reloadProgress,
  } = useApiQuery<UserProgress>('/api/progress/achievements', {
    enabled: status === 'authenticated',
  });

  const { data: streak } = useApiQuery<StreakData>('/api/progress/streak', {
    enabled: status === 'authenticated',
  });

  if (status === 'loading' || (progressLoading && !progress)) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-5xl">
          <PageHeader title="Прогресс" />
          <div className="stagger mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card space-y-2 p-4">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
          <div className="card p-6">
            <LoadingState rows={3} label="Загрузка лиги недели" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!progress) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-md">
          <PageHeader title="Прогресс" />
          <ErrorState
            title="Прогресс недоступен"
            description="Не удалось загрузить статистику. Попробуйте обновить страницу."
            onRetry={reloadProgress}
            action={
              <Button href="/dashboard" variant="secondary">
                На главную
              </Button>
            }
          />
        </div>
      </AppLayout>
    );
  }

  const { metrics, achievements } = progress;
  const week = streak?.week ?? [];
  const weekMinutes = week.reduce((sum, day) => sum + day.minutesRead, 0);
  const maxMinutes = Math.max(10, ...week.map((d) => d.minutesRead));
  const categoryCounts = achievements.reduce<Record<AchievementCategory, number>>((acc, achievement) => {
    const category = achievementCategory(achievement.code);
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, { words: 0, reading: 0, reviews: 0, grammar: 0, streak: 0, challenges: 0 });
  const visibleAchievements = achievements.filter(
    (achievement) => achievementFilter === 'all' || achievementCategory(achievement.code) === achievementFilter
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Прогресс" subtitle="Как идёт обучение и что уже получилось" />

        {/* Уровень */}
        <section className="card mb-6 p-6">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-accent text-on-accent">
              <span className="text-caption uppercase tracking-wide">уровень</span>
              <span className="text-h2 leading-none">{progress.level}</span>
            </div>
            <div className="min-w-56 flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-h3 text-ink">{progress.levelTitle}</h2>
                <span className="text-body-sm text-slate">{progress.xp} XP</span>
              </div>
              <ProgressBar
                value={progress.levelProgressPercent}
                label="Прогресс до следующего уровня"
              />
              <p className="mt-2 text-caption text-slate">
                {progress.xpToNextLevel != null
                  ? `До ${progress.level + 1} уровня — ${progress.xpToNextLevel} XP`
                  : 'Максимальный уровень — вы легенда'}
              </p>
            </div>
          </div>
        </section>

        {/* Цифры */}
        <ul className="stagger mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
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
        </ul>

        {/* Неделя */}
        {week.length > 0 && (
          <section className="card mb-6 p-6">
            <div className="mb-5 flex items-baseline justify-between">
              <h2 className="text-h3 text-ink">Эта неделя</h2>
              <span className="text-body-sm text-slate">
                {weekMinutes} {plural(weekMinutes, ['минута', 'минуты', 'минут'])} чтения
              </span>
            </div>

            {weekMinutes === 0 ? (
              <EmptyState
                variant="inline"
                className="border border-hairline"
                icon={<BookOpenIcon size={24} />}
                title="На этой неделе чтения пока не было"
                description="Начните с одной страницы."
                action={
                  <Button href="/books" variant="secondary">
                    Открыть библиотеку
                  </Button>
                }
              />
            ) : (
              <div className="flex h-32 items-end justify-between gap-2">
                {week.map((day) => {
                  const height = day.minutesRead > 0
                    ? Math.max(10, Math.round((day.minutesRead / maxMinutes) * 112))
                    : 4;
                  return (
                    <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                      {/* Высота столбца — это и есть данные, поэтому задаётся инлайном. */}
                      <div
                        role="img"
                        aria-label={`${weekdayShort(day.date)}: ${day.minutesRead} мин${day.goalMet ? ', цель выполнена' : ''}`}
                        title={`${day.date}: ${day.minutesRead} мин${day.goalMet ? ' · цель выполнена' : ''}`}
                        className={`w-full rounded-t-lg transition-[height] duration-slow ease-soft ${
                          day.goalMet
                            ? 'bg-primary'
                            : day.minutesRead > 0
                              ? 'bg-surface-accent'
                              : 'bg-hairline-soft'
                        }`}
                        style={{ height: `${height}px` }}
                      />
                      <span className="text-caption text-slate">{weekdayShort(day.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Лига недели */}
        <WeeklyLeague />

        {/* Сохранённые результаты тестов */}
        <QuizHistory />

        {/* Достижения */}
        <section id="achievements" aria-label="Достижения" className="scroll-mt-20">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-h3 text-ink">Достижения</h2>
            <span className="text-body-sm text-slate">
              {progress.unlockedCount} из {achievements.length}
            </span>
          </div>

          {achievements.length === 0 ? (
            <EmptyState
              icon={<BulbIcon size={24} />}
              title="Достижений пока нет"
              description="Первое появится, как только закончите повторение или откроете страницу книги."
              action={
                <Button href="/review" variant="secondary">
                  К повторению
                </Button>
              }
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Категории достижений">
                <button
                  type="button"
                  onClick={() => setAchievementFilter('all')}
                  aria-pressed={achievementFilter === 'all'}
                  className={`min-h-11 ${achievementFilter === 'all' ? 'pill-tab-active' : 'pill-tab'}`}
                >
                  Все
                  <span className="tabular-nums opacity-70">{achievements.length}</span>
                </button>
                {ACHIEVEMENT_CATEGORIES.map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => setAchievementFilter(category.value)}
                    aria-pressed={achievementFilter === category.value}
                    className={`min-h-11 ${achievementFilter === category.value ? 'pill-tab-active' : 'pill-tab'}`}
                  >
                    {category.label}
                    <span className="tabular-nums opacity-70">{categoryCounts[category.value]}</span>
                  </button>
                ))}
              </div>

              {visibleAchievements.length === 0 ? (
                <EmptyState
                  variant="inline"
                  className="border border-hairline"
                  icon={<BulbIcon size={24} />}
                  title="В этой категории пока пусто"
                  description="Выберите другую категорию — достижения никуда не исчезли."
                />
              ) : (
                <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleAchievements.map((achievement) => (
                    <li key={achievement.code}>
                      <AchievementCard
                        achievement={achievement}
                        onSelect={() => setSelectedAchievement(achievement)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <AnimatePresence>
          {selectedAchievement && (
            <AchievementDialog
              key={selectedAchievement.code}
              achievement={selectedAchievement}
              onClose={() => setSelectedAchievement(null)}
              closeRef={achievementCloseRef}
            />
          )}
        </AnimatePresence>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button href="/dashboard">Продолжить обучение</Button>
          <Button href="/review" variant="secondary">
            К повторению
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
