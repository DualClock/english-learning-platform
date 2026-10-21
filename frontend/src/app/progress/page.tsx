'use client';

import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState, { Skeleton } from '@/components/ui/LoadingState';
import ProgressBar from '@/components/ui/ProgressBar';
import {
  BookOpenIcon,
  BookmarkIcon,
  BulbIcon,
  ChartIcon,
  FoldersIcon,
  HeadphonesIcon,
  NotebookIcon,
  PenIcon,
  RepeatIcon,
  RocketIcon,
  SpeechIcon,
  TargetIcon,
  TrendUpIcon,
  type IconProps,
} from '@/components/ui/icons';
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

/*
 * Бэкенд присылает в achievement.icon эмодзи. Мы его не рисуем: набор своих
 * иконок один на всё приложение, а код достижения — то, что реально приходит
 * в ответе. Ключи подбираются по подстроке, поэтому новый ачивк на сервере не
 * ломает экран — останется нейтральная иконка вместо случайного смайла.
 */
const ACHIEVEMENT_ICONS: { match: RegExp; Icon: (p: IconProps) => JSX.Element }[] = [
  { match: /streak|fire|day/i, Icon: TrendUpIcon },
  { match: /word|vocab|dictionar/i, Icon: BookmarkIcon },
  { match: /book|read|page|librar/i, Icon: BookOpenIcon },
  { match: /grammar/i, Icon: NotebookIcon },
  { match: /categor/i, Icon: FoldersIcon },
  { match: /review|repeat/i, Icon: RepeatIcon },
  { match: /listen|dictation|pronunci|sound/i, Icon: HeadphonesIcon },
  { match: /translat|speech|talk/i, Icon: SpeechIcon },
  { match: /writ|essay/i, Icon: PenIcon },
  { match: /quiz|test|perfect|score/i, Icon: TargetIcon },
  { match: /xp|level/i, Icon: ChartIcon },
  { match: /first|start|launch/i, Icon: RocketIcon },
];

function AchievementIcon({ code }: { code: string }) {
  const found = ACHIEVEMENT_ICONS.find((entry) => entry.match.test(code));
  const Icon = found ? found.Icon : BulbIcon;
  return <Icon size={20} />;
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

export default function ProgressPage() {
  const { status } = useSession();

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
  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

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
              <span className="text-body-sm text-slate">{weekMinutes} минут чтения</span>
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

        {/* Достижения */}
        <section aria-label="Достижения">
          <div className="mb-4 flex items-baseline justify-between">
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
              {unlocked.length > 0 && (
                <ul className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {unlocked.map((achievement) => (
                    <li key={achievement.code} className="card p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
                          <AchievementIcon code={achievement.code} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-body-sm font-semibold text-ink">{achievement.title}</div>
                          <p className="mt-0.5 text-caption text-slate">{achievement.description}</p>
                          {achievement.unlockedAt && (
                            <p className="mt-1 text-caption text-primary">
                              Получено {new Date(achievement.unlockedAt).toLocaleDateString('ru-RU')}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {locked.length > 0 && (
                <>
                  <h3 className="mb-3 text-body-sm font-medium text-slate">Впереди</h3>
                  <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {locked.map((achievement) => {
                      const percent = achievement.target > 0
                        ? Math.min(100, Math.round((achievement.progress / achievement.target) * 100))
                        : 0;
                      return (
                        <li key={achievement.code} className="card p-4">
                          <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-slate">
                              <AchievementIcon code={achievement.code} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-body-sm font-semibold text-ink">{achievement.title}</div>
                              <p className="mt-0.5 text-caption text-slate">{achievement.description}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <ProgressBar
                                  className="flex-1"
                                  value={percent}
                                  label={`${achievement.title}: ${achievement.progress} из ${achievement.target}`}
                                />
                                <span className="shrink-0 text-caption text-slate">
                                  {achievement.progress}/{achievement.target}
                                </span>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

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
