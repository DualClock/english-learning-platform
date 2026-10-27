'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useApiQuery } from '@/app/lib/use-api';
import type { Paged } from '@/app/lib/paged';
import UserAvatar from '@/components/UserAvatar';
import { plural } from '@/lib/plural';
import { formatNumber } from '@/lib/format';
import { Book, pickContinueBook } from '@/components/dashboard/utils';
import AchievementIcon from '@/components/progress/AchievementIcon';
import XpRulesTable from '@/components/progress/XpRulesTable';
import type { Leaderboard } from '@/components/progress/leagueTypes';
import BookCover from '@/components/library/BookCover';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ProgressBar from '@/components/ui/ProgressBar';
import { displayNameOf } from '@/lib/display-name';
import { Skeleton } from '@/components/ui/LoadingState';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckCircleIcon,
  SlidersIcon,
  TrendUpIcon,
  TrophyIcon,
} from '@/components/ui/icons';

interface Profile {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarFrame?: string | null;
  accentTheme?: string | null;
  cefrLevel: string | null;
  studyGoal: string | null;
  dailyGoalMinutes: number;
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  createdAt: string;
  lastActivityDate?: string | null;
}

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

function joinedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });
}

function dateLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function QuickStat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <li className="card p-4">
      <p className="text-h2 leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-body-sm text-slate">{label}</p>
      {hint && <p className="mt-0.5 text-caption text-slate">{hint}</p>}
    </li>
  );
}

export default function ProfilePage() {
  const { data: session, status } = useSession();

  const {
    data: profile,
    error: profileError,
    isLoading: profileLoading,
    refresh: refreshProfile,
  } = useApiQuery<Profile>('/api/profile', { enabled: status === 'authenticated' });

  const {
    data: progress,
    error: progressError,
    isLoading: progressLoading,
    refresh: refreshProgress,
  } = useApiQuery<UserProgress>('/api/progress/achievements', {
    enabled: status === 'authenticated',
  });

  const { data: streak, isLoading: streakLoading } = useApiQuery<StreakData>('/api/progress/streak', {
    enabled: status === 'authenticated',
  });

  const { data: league, isLoading: leagueLoading } = useApiQuery<Leaderboard>('/api/progress/leaderboard', {
    enabled: status === 'authenticated',
  });

  const {
    data: books,
    isLoading: booksLoading,
    error: booksError,
    refresh: refreshBooks,
  } = useApiQuery<Paged<Book>>('/api/books', {
    enabled: status === 'authenticated',
  });

  if (status === 'loading' || ((profileLoading || progressLoading) && (!profile || !progress))) {
    return (
      <AppLayout>
        <ProfileSkeleton />
      </AppLayout>
    );
  }

  if (!profile || !progress || (profileError && !profile) || (progressError && !progress)) {
    return (
      <AppLayout>
        <PageHeader title="Профиль" subtitle="Ваш путь, ритм и последние успехи" />
        <div className="mx-auto max-w-md">
          <ErrorState
            title="Профиль не загрузился"
            description="Не удалось получить данные профиля. Проверьте соединение и попробуйте снова."
            onRetry={() => {
              refreshProfile();
              refreshProgress();
            }}
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

  /*
   * Имя для показа. `profile.email.split('@')[0]` убран: у нового аккаунта
   * displayName пуст, и в заголовок профиля попадал локаль адреса.
   */
  const name = displayNameOf(profile.displayName?.trim() || session?.user?.name);
  const joined = joinedLabel(profile.createdAt);
  const currentStreak = streak?.currentStreak ?? profile.currentStreak;
  const longestStreak = streak?.longestStreak ?? profile.longestStreak;

  const recentAchievements = [...progress.achievements]
    .filter((achievement) => achievement.unlocked)
    .sort((a, b) => new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime())
    .slice(0, 3);

  const nextAchievements = [...progress.achievements]
    .filter((achievement) => !achievement.unlocked)
    .sort((a, b) => {
      const aPercent = a.target > 0 ? a.progress / a.target : 0;
      const bPercent = b.target > 0 ? b.progress / b.target : 0;
      return bPercent - aPercent;
    })
    .slice(0, 2);

  const currentBook = books ? pickContinueBook(books.items) : undefined;
  const week = streak?.week ?? [];
  const weekMinutes = week.reduce((sum, day) => sum + day.minutesRead, 0);
  const maxMinutes = Math.max(10, ...week.map((day) => day.minutesRead));
  const leagueMe = league?.me;

  return (
    <AppLayout>
      <PageHeader
        title="Профиль"
        subtitle="Ваш путь, ритм и последние успехи"
        actions={
          <Button href="/settings" variant="secondary">
            <SlidersIcon size={16} />
            Настройки
          </Button>
        }
      />

      {/* Личность и три опоры: уровень, стрик, лига */}
      <section className="mb-6 overflow-hidden rounded-lg border border-hairline bg-canvas">
        <div className="bg-navy px-5 py-6 text-on-dark sm:px-8 sm:py-7">
          <div className="flex flex-wrap items-center gap-5">
            <UserAvatar
              avatarUrl={profile.avatarUrl ?? session?.avatarUrl}
              frame={profile.avatarFrame ?? session?.avatarFrame}
              name={name}
              className="h-20 w-20 shrink-0 ring-2 ring-white/20"
            />

            <div className="min-w-0 flex-1">
              <h2 className="truncate text-h1 text-on-dark">{name}</h2>
              <p className="mt-1 truncate text-body-sm text-on-dark-muted">{profile.email}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {profile.cefrLevel && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-caption font-semibold text-on-dark">
                    CEFR {profile.cefrLevel.toUpperCase()}
                  </span>
                )}
                <span className="rounded-full border border-white/15 px-2.5 py-1 text-caption text-on-dark-muted">
                  {profile.dailyGoalMinutes} мин в день
                </span>
                {profile.studyGoal && (
                  <span className="max-w-[16rem] truncate rounded-full border border-white/15 px-2.5 py-1 text-caption text-on-dark-muted">
                    {profile.studyGoal}
                  </span>
                )}
                {joined && (
                  <span className="rounded-full border border-white/15 px-2.5 py-1 text-caption text-on-dark-muted">
                    с {joined}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid divide-y divide-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <p className="text-caption font-medium uppercase tracking-wide text-slate">Уровень</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-h2 leading-none text-ink">{progress.level}</span>
              <span className="text-body-sm text-slate">{progress.levelTitle}</span>
            </div>
            <ProgressBar
              className="mt-3"
              value={progress.levelProgressPercent}
              label="Прогресс до следующего уровня"
            />
            <p className="mt-2 text-caption text-slate">
              {formatNumber(progress.xp)} XP
              {progress.xpToNextLevel != null && ` · ещё ${formatNumber(progress.xpToNextLevel)} XP до ${progress.level + 1} уровня`}
            </p>
          </div>

          <div className="p-5">
            <p className="text-caption font-medium uppercase tracking-wide text-slate">Стрик</p>
            {currentStreak > 0 ? (
              <>
                <p className="mt-1 text-h2 leading-none tabular-nums text-ink">{currentStreak}</p>
                <p className="mt-1 text-body-sm text-slate">
                  {plural(currentStreak, ['день', 'дня', 'дней'])} подряд
                </p>
                <p className="mt-2 text-caption text-slate">Лучший — {longestStreak}</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-h3 text-ink">Пока без стрика</p>
                <p className="mt-1 text-body-sm text-slate">Первый день можно начать сегодня.</p>
              </>
            )}
          </div>

          <div className="p-5">
            <p className="text-caption font-medium uppercase tracking-wide text-slate">Лига недели</p>
            {leagueMe ? (
              <>
                <div className="mt-1 flex items-center gap-2">
                  <TrophyIcon size={20} className="shrink-0 text-primary" />
                  <span className="text-h3 text-ink">{leagueMe.leagueTitle}</span>
                </div>
                <p className="mt-1 text-body-sm text-slate">
                  {leagueMe.rank != null
                    ? `№ ${leagueMe.rank} из ${leagueMe.participants}`
                    : 'Пока без места'}
                  {` · ${formatNumber(leagueMe.weeklyXp)} XP за неделю`}
                </p>
                <p className="mt-2 text-caption text-slate">
                  {league?.group.forming
                    ? 'Лига формируется'
                    : leagueMe.rank == null
                      ? 'На этой неделе XP пока нет'
                      : leagueMe.zone === 'promotion'
                        ? 'Зона повышения'
                        : leagueMe.zone === 'demotion'
                          ? 'Зона вылета'
                          : 'Середина группы'}
                </p>
              </>
            ) : leagueLoading ? (
              <>
                <Skeleton className="mt-2 h-6 w-28" />
                <Skeleton className="mt-2 h-4 w-40" />
              </>
            ) : (
              <>
                <p className="mt-1 text-h3 text-ink">Лига формируется</p>
                <p className="mt-1 text-body-sm text-slate">Неделя начнётся с первого XP.</p>
              </>
            )}
            <Link
              href="/progress"
              className="mt-3 inline-flex items-center gap-1 text-caption font-medium text-primary hover:underline"
            >
              Смотреть лигу
              <ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Четыре главных числа — без дубля всей аналитики */}
      <section className="mb-6" aria-labelledby="profile-stats-title">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="profile-stats-title" className="text-h3 text-ink">Главное</h2>
          <Link href="/progress" className="text-body-sm font-medium text-primary hover:underline">
            Подробная статистика
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <QuickStat
            value={formatNumber(progress.metrics.words)}
            label={`${plural(progress.metrics.words, ['слово', 'слова', 'слов'])} в словаре`}
          />
          <QuickStat
            value={formatNumber(progress.metrics.books)}
            label={`${plural(progress.metrics.books, ['книга', 'книги', 'книг'])} в библиотеке`}
            hint={`${formatNumber(progress.metrics.pages)} ${plural(progress.metrics.pages, ['страница', 'страницы', 'страниц'])} прочитано`}
          />
          <QuickStat
            value={formatNumber(progress.metrics.activeDays)}
            label={`${plural(progress.metrics.activeDays, ['день', 'дня', 'дней'])} с целью`}
            hint="цель выполнена"
          />
          <QuickStat
            value={`${progress.unlockedCount} / ${progress.achievements.length}`}
            label="достижений"
            hint={progress.unlockedCount > 0 ? 'можно собирать' : 'первое впереди'}
          />
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Достижения: последние открытые или ближайшие цели */}
          <section aria-labelledby="profile-achievements-title">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="profile-achievements-title" className="text-h3 text-ink">
                {recentAchievements.length > 0 ? 'Последние достижения' : 'Достижения'}
              </h2>
              <Link
                href="/progress#achievements"
                className="text-body-sm font-medium text-primary hover:underline"
              >
                Все достижения
              </Link>
            </div>

            {recentAchievements.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-3">
                {recentAchievements.map((achievement) => (
                  <li key={achievement.code} className="card p-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
                      <AchievementIcon code={achievement.code} />
                    </span>
                    <h3 className="mt-3 text-body-sm font-semibold text-ink">{achievement.title}</h3>
                    <p className="mt-1 line-clamp-2 text-caption leading-snug text-slate">
                      {achievement.description}
                    </p>
                    {achievement.unlockedAt && (
                      <p className="mt-2 text-caption text-primary">
                        Получено {dateLabel(achievement.unlockedAt)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : nextAchievements.length > 0 ? (
              <ul className="space-y-3">
                {nextAchievements.map((achievement) => {
                  const percent = achievement.target > 0
                    ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
                    : 0;
                  return (
                    <li key={achievement.code} className="card flex items-start gap-3 p-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-slate">
                        <AchievementIcon code={achievement.code} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-body-sm font-semibold text-ink">{achievement.title}</h3>
                          <span className="text-caption tabular-nums text-slate">
                            {achievement.progress}/{achievement.target}
                          </span>
                        </div>
                        <p className="mt-0.5 text-caption leading-snug text-slate">
                          {achievement.description}
                        </p>
                        <ProgressBar
                          className="mt-2"
                          value={percent}
                          label={`${achievement.title}: ${achievement.progress} из ${achievement.target}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                variant="inline"
                className="border border-hairline"
                icon={<TrophyIcon size={24} />}
                title="Достижения ещё впереди"
                description="Первое появится после страницы книги или первого повторения."
                action={<Button href="/review" variant="secondary">К повторению</Button>}
              />
            )}
          </section>

          {/* Текущая книга — живая активность, не дубль библиотеки */}
          <section className="card p-5" aria-labelledby="profile-book-title">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="profile-book-title" className="text-h3 text-ink">Сейчас читаете</h2>
              <Link href="/books" className="text-body-sm font-medium text-primary hover:underline">
                Библиотека
              </Link>
            </div>

            {booksLoading && !books ? (
              <div className="flex items-center gap-4">
                <Skeleton className="h-24 w-16 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              </div>
            ) : booksError && !books ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-slate">
                <span>Библиотека не загрузилась.</span>
                <Button variant="secondary" onClick={refreshBooks}>
                  Повторить
                </Button>
              </div>
            ) : currentBook ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <BookCover
                  title={currentBook.title}
                  coverUrl={currentBook.coverUrl}
                  className="h-24 w-16"
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-body-lg font-semibold text-ink">{currentBook.title}</h3>
                  {currentBook.author && (
                    <p className="mt-0.5 truncate text-body-sm text-slate">{currentBook.author}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <ProgressBar
                      className="flex-1"
                      value={Math.round(currentBook.progress ?? 0)}
                      label={`Прочитано ${Math.round(currentBook.progress ?? 0)}%`}
                    />
                    <span className="shrink-0 text-caption tabular-nums text-slate">
                      {Math.round(currentBook.progress ?? 0)}%
                    </span>
                  </div>
                  {currentBook.currentPage && currentBook.totalPages ? (
                    <p className="mt-1.5 text-caption text-slate">
                      Страница {currentBook.currentPage} из {currentBook.totalPages}
                    </p>
                  ) : null}
                </div>
                <Button href={`/reader/${currentBook.id}`} className="shrink-0">
                  Продолжить
                  <ArrowRightIcon size={16} />
                </Button>
              </div>
            ) : (
              <EmptyState
                variant="inline"
                icon={<BookOpenIcon size={24} />}
                title="Ещё не начали книгу"
                description="Откройте библиотеку и выберите первую — она появится здесь."
                action={<Button href="/books" variant="secondary">В библиотеку</Button>}
              />
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Ритм недели */}
          <section className="card p-5" aria-labelledby="profile-week-title">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="profile-week-title" className="text-h3 text-ink">Ритм недели</h2>
              <span className="text-caption text-slate">{profile.dailyGoalMinutes} мин в день</span>
            </div>

            {streakLoading && !streak ? (
              <div className="space-y-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-20 w-full rounded-md" />
              </div>
            ) : week.length > 0 ? (
              weekMinutes > 0 ? (
                <>
                  <div className="flex h-20 items-end justify-between gap-2">
                    {week.map((day) => {
                      const height = day.minutesRead > 0
                        ? Math.max(8, Math.round((day.minutesRead / maxMinutes) * 64))
                        : 4;
                      return (
                        <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                          <div
                            role="img"
                            aria-label={`${weekdayShort(day.date)}: ${day.minutesRead} мин${day.goalMet ? ', цель выполнена' : ''}`}
                            title={`${day.date}: ${day.minutesRead} мин${day.goalMet ? ' · цель выполнена' : ''}`}
                            className={`w-full rounded-t-md ${
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
                  <p className="mt-3 text-caption text-slate">
                    {weekMinutes} {plural(weekMinutes, ['минута', 'минуты', 'минут'])} чтения за неделю
                  </p>
                </>
              ) : (
                <>
                  <p className="text-body-sm leading-relaxed text-slate">
                    На этой неделе пока тихо. Одна страница сегодня — и здесь появится первый столбик.
                  </p>
                  <Link
                    href="/books"
                    className="mt-3 inline-flex items-center gap-1 text-body-sm font-medium text-primary hover:underline"
                  >
                    Открыть библиотеку
                    <ArrowRightIcon size={16} />
                  </Link>
                </>
              )
            ) : (
              <p className="text-body-sm text-slate">Ритм появится после первого дня с целью.</p>
            )}
          </section>

          {/* Как это работает */}
          <section className="card p-5" aria-labelledby="profile-how-title">
            <h2 id="profile-how-title" className="text-h3 text-ink">Как это работает</h2>
            <ul className="mt-4 space-y-4">
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-accent text-on-accent">
                  <TrendUpIcon size={16} />
                </span>
                <div>
                  <p className="text-body-sm font-medium text-ink">XP и уровень</p>
                  <p className="mt-0.5 text-caption leading-relaxed text-slate">
                    XP растёт за страницы, повторения, грамматику и практики. Уровень — сумма XP, она не сгорает.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-accent text-on-accent">
                  <TrophyIcon size={16} />
                </span>
                <div>
                  <p className="text-body-sm font-medium text-ink">Лига недели</p>
                  <p className="mt-0.5 text-caption leading-relaxed text-slate">
                    С понедельника считается XP за неделю. Лига растёт вместе с вашей практикой.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-accent text-on-accent">
                  <CheckCircleIcon size={16} />
                </span>
                <div>
                  <p className="text-body-sm font-medium text-ink">Стрик</p>
                  <p className="mt-0.5 text-caption leading-relaxed text-slate">
                    День засчитывается, когда выполнена дневная цель. Пропуск не обнуляет уже заработанные XP.
                  </p>
                </div>
              </li>
            </ul>
            {league?.xpRules && league.xpRules.length > 0 && (
              <details className="mt-5 rounded-lg border border-hairline">
                <summary className="cursor-pointer px-3 py-2.5 text-body-sm font-medium text-ink">
                  За что дают XP
                </summary>
                <div className="border-t border-hairline px-3 py-2">
                  <XpRulesTable rules={league.xpRules} />
                </div>
              </details>
            )}

            <Link
              href="/progress"
              className="mt-5 inline-flex items-center gap-1.5 text-body-sm font-medium text-primary hover:underline"
            >
              Смотреть прогресс и лигу
              <ArrowRightIcon size={16} />
            </Link>
          </section>
        </div>
      </div>
    </AppLayout>
  );
}

/** Скелетон повторяет шапку личности и главные блоки. */
function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-5xl" role="status" aria-busy="true">
      <span className="sr-only">Загрузка профиля</span>
      <div className="mb-8 space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="mb-6 overflow-hidden rounded-lg border border-hairline bg-canvas">
        <div className="bg-navy px-5 py-6 sm:px-8 sm:py-7">
          <div className="flex items-center gap-5">
            <Skeleton className="h-20 w-20 rounded-full bg-white/15" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-56 bg-white/15" />
              <Skeleton className="h-4 w-40 bg-white/10" />
              <Skeleton className="h-3 w-64 bg-white/10" />
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-2 p-4">
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
