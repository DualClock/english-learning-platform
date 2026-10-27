'use client';

import AppLayout from '@/components/AppLayout';
import { useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import GreetingHeader from '@/components/dashboard/GreetingHeader';
import StatsRow from '@/components/dashboard/StatsRow';
import ContinueReading from '@/components/dashboard/ContinueReading';
import TodayReview from '@/components/dashboard/TodayReview';
import QuickActions from '@/components/dashboard/QuickActions';
import FirstLesson from '@/components/dashboard/FirstLesson';
import { useTrack } from '@/app/lib/analytics';
import DashboardSkeleton from '@/components/dashboard/DashboardSkeleton';
import StreakCard, { StreakData } from '@/components/dashboard/StreakCard';
import RecommendedShelf, { RecommendedBook } from '@/components/dashboard/RecommendedShelf';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import { ArrowRightIcon } from '@/components/ui/icons';
import { Book, pickContinueBook } from '@/components/dashboard/utils';
import { displayNameOf } from '@/lib/display-name';
import type { Paged } from '@/app/lib/paged';
import WelcomeBackModal from '@/components/WelcomeBackModal';
import DailyPlan from '@/components/dashboard/DailyPlan';
import NewsForYou from '@/components/dashboard/NewsForYou';
import LevelCard from '@/components/dashboard/LevelCard';
import CheckpointCard from '@/components/dashboard/CheckpointCard';
import { useApiQuery } from '@/app/lib/use-api';
import { widgetState } from '@/components/dashboard/dashboard-state';

/*
 * Дашборд.
 *
 * Здесь шесть независимых запросов, и раньше ошибка каждого из них, кроме
 * расписания, молча превращалась в ноль: `reviewToday?.totalCount ?? 0`,
 * `books?.totalCount`, `streak ?? null`. Из-за этого упавший бэкенд выглядел
 * как «у тебя ничего нет»: «0 слов в словаре», «Всё повторено», вечный
 * скелетон стрика. Человек делал вывод о себе вместо вывода о сервисе.
 *
 * Теперь у каждого виджета четыре явных состояния (`dashboard-state.ts`), и
 * прочерк ≠ ноль. Ошибка одного запроса не прячет остальной экран: книги
 * могли загрузиться, даже если не загрузилась серия дней.
 */

interface Profile {
  email: string;
  displayName: string;
  cefrLevel: string | null;
  studyGoal: string | null;
  dailyGoalMinutes: number;
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  createdAt: string;
}

interface ReviewToday {
  totalCount?: number;
}

export default function DashboardPage() {
  const { data: session } = useSession();

  const booksQuery = useApiQuery<Paged<Book>>('/api/books');
  const profileQuery = useApiQuery<Profile>('/api/profile');
  const streakQuery = useApiQuery<StreakData>('/api/progress/streak');
  const reviewQuery = useApiQuery<ReviewToday>('/api/review/today');
  // Для дашборда достаточно счётчика: просим одну строку и читаем totalCount
  const dictionaryQuery = useApiQuery<Paged<unknown>>('/api/dictionary?pageSize=1');
  const recommendedPath = profileQuery.data?.cefrLevel
    ? `/api/books/recommended?level=${encodeURIComponent(profileQuery.data.cefrLevel)}`
    : null;
  const recommendedQuery = useApiQuery<RecommendedBook[]>(recommendedPath);

  const trackEvent = useTrack();

  useEffect(() => {
    trackEvent('login');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bookList = useMemo(() => booksQuery.data?.items ?? [], [booksQuery.data]);
  const isBooksLoading = booksQuery.data === undefined && booksQuery.error === null;
  const profile = profileQuery.data;

  // Каждое состояние считается своей функцией, а не цепочкой `?? 0`.
  const booksState = widgetState({
    data: booksQuery.data,
    error: booksQuery.error,
    isEmpty: (paged: Paged<Book>) => paged.totalCount === 0,
  });
  const reviewState = widgetState({
    data: reviewQuery.data?.totalCount,
    error: reviewQuery.error,
  });
  const streakState = widgetState({
    data: streakQuery.data,
    error: streakQuery.error,
  });

  // Числа для счётчиков: `null` = «не знаем», и это не ноль.
  const reviewCount = reviewQuery.error ? null : (reviewQuery.data?.totalCount ?? null);
  const dictCount = dictionaryQuery.error
    ? null
    : (dictionaryQuery.data?.totalCount ?? null);
  const booksCount = booksQuery.error ? null : (booksQuery.data?.totalCount ?? null);
  const totalXp = streakQuery.error
    ? null
    : (streakQuery.data?.totalXp ?? profile?.totalXp ?? null);

  /*
   * Имя для приветствия. Никогда не email: у нового аккаунта displayName
   * пуст, и раньше сюда попадал локаль адреса («audit-1793045167713»).
   */
  const userName = displayNameOf(session?.user?.name || profile?.displayName);

  const isNewAccount = booksState === 'empty' && (dictCount === null || dictCount === 0);

  return (
    <AppLayout>
      <WelcomeBackModal />
      {isBooksLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className="animate-fade-in">
          <GreetingHeader name={userName} level={profile?.cefrLevel} />

          {/*
           * Две колонки вместо стопки из десяти блоков равного веса.
           * Слева — то, ради чего человек пришёл (продолжить чтение или
           * начать первую книгу). Справа — состояние: серия и уровень.
           * Раньше все блоки шли на всю ширину, и глазу не за что было
           * зацепиться: шесть белых карточек подряд, у новичка — все с нулями.
           */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              {booksState === 'error' ? (
                <section className="mb-6">
                  <ErrorState
                    title="Библиотека не загрузилась"
                    description="Остальное на этой странице может быть на месте — попробуйте обновить книги."
                    onRetry={booksQuery.refresh}
                  />
                </section>
              ) : bookList.length > 0 ? (
                (() => {
                  const hero = pickContinueBook(bookList);
                  return hero ? (
                    <ContinueReading
                      hero={hero}
                      others={bookList.filter((b) => b.id !== hero.id)}
                    />
                  ) : null;
                })()
              ) : booksState === 'empty' ? null : (
                <section className="mb-6">
                  <EmptyState
                    lexi="stand"
                    title="Библиотека пока пуста"
                    description="Добавьте первую книгу — и начните читать на английском, сохраняя новые слова по пути."
                    action={
                      <Button href="/books">
                        Перейти в библиотеку
                        <ArrowRightIcon size={16} />
                      </Button>
                    }
                  />
                </section>
              )}

              <DailyPlan />

              {/*
                * «Новости для тебя» — сразу под планом на сегодня, внутри той же
                * колонки. Блок рисует себя только при непустом списке
                * (`shouldShowNews` в lib/news.ts), поэтому пустой карточки на
                * дашборде не появляется. Отдельного пункта меню у новостей нет:
                * сайдбар на 16 пунктов уже не помещается в окно.
                */}
              <NewsForYou />

              {isNewAccount && <FirstLesson />}
            </div>

            <aside className="flex flex-col gap-6 lg:col-span-4">
              <StreakCard
                state={streakState}
                streak={streakQuery.error ? null : (streakQuery.data ?? null)}
                onRetry={streakQuery.refresh}
              />
              <LevelCard />
              <CheckpointCard level={profile?.cefrLevel} />
            </aside>
          </div>

          {/*
           * Счётчики решают внутри себя: нулевые плитки и пустой ряд не
           * рисуются. Комментировать логику здесь незачем — она в StatsRow.
           */}
          {booksState !== 'error' && (
            <StatsRow
              dictCount={dictCount}
              reviewCount={reviewCount}
              booksCount={booksCount}
              totalXp={totalXp}
            />
          )}

          {recommendedQuery.data != null && profile?.cefrLevel && (
            <RecommendedShelf level={profile.cefrLevel} books={recommendedQuery.data} />
          )}

          <TodayReview
            state={reviewState}
            reviewCount={reviewCount ?? 0}
            onRetry={reviewQuery.refresh}
          />

          <QuickActions />
        </div>
      )}
    </AppLayout>
  );
}
