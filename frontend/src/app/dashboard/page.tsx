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
import { ArrowRightIcon, BookOpenIcon } from '@/components/ui/icons';
import { Book, pickContinueBook } from '@/components/dashboard/utils';
import type { Paged } from '@/app/lib/paged';
import WelcomeBackModal from '@/components/WelcomeBackModal';
import DailyPlan from '@/components/dashboard/DailyPlan';
import LevelCard from '@/components/dashboard/LevelCard';
import CheckpointCard from '@/components/dashboard/CheckpointCard';
import { useApiQuery } from '@/app/lib/use-api';

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
  // Все запросы идут параллельно и берутся из кэша при повторном заходе
  const {
    data: books,
    error: booksError,
    isLoading: booksLoading,
    refresh: refreshBooks,
  } = useApiQuery<Paged<Book>>('/api/books');
  const { data: profile } = useApiQuery<Profile>('/api/profile');
  const { data: streak } = useApiQuery<StreakData>('/api/progress/streak');
  const { data: reviewToday } = useApiQuery<ReviewToday>('/api/review/today');
  // Для дашборда достаточно счётчика: просим одну строку и читаем totalCount
  const { data: dictionary } = useApiQuery<Paged<unknown>>('/api/dictionary?pageSize=1');
  const recommendedPath = profile?.cefrLevel
    ? `/api/books/recommended?level=${encodeURIComponent(profile.cefrLevel)}`
    : null;
  const { data: recommended } = useApiQuery<RecommendedBook[]>(recommendedPath);

  const trackEvent = useTrack();

  useEffect(() => {
    trackEvent('login');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bookList = useMemo(() => books?.items ?? [], [books]);
  const isLoading = booksLoading && books === undefined;
  const hasError = Boolean(booksError);
  const reviewCount = reviewToday?.totalCount ?? 0;
  const dictCount = dictionary ? dictionary.totalCount : null;
  const booksCount = books ? books.totalCount : null;
  const streakLoaded = books !== undefined;

  const userName =
    session?.user?.name || profile?.displayName || session?.user?.email?.split('@')[0] || profile?.email?.split('@')[0];

  return (
    <AppLayout>
      <WelcomeBackModal />
      {isLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className="animate-fade-in">
          <GreetingHeader name={userName} level={profile?.cefrLevel} />

          <DailyPlan />

          {hasError ? (
            <ErrorState onRetry={refreshBooks} />
          ) : (
            <>
              <StatsRow
                dictCount={dictCount}
                reviewCount={reviewCount}
                booksCount={booksCount ?? bookList.length}
                totalXp={streak?.totalXp ?? profile?.totalXp ?? null}
              />

              {streakLoaded && <StreakCard streak={streak ?? null} />}

              <LevelCard />

              <CheckpointCard level={profile?.cefrLevel} />

              {recommended != null && profile?.cefrLevel && (
                <RecommendedShelf
                  level={profile.cefrLevel}
                  books={recommended}
                  token={session?.accessToken}
                />
              )}

              {bookList.length === 0 && dictCount === 0 && <FirstLesson />}

              {bookList.length > 0 ? (
                (() => {
                  const hero = pickContinueBook(bookList)!;
                  return (
                    <ContinueReading hero={hero} others={bookList.filter((b) => b.id !== hero.id)} />
                  );
                })()
              ) : (
                <section className="mb-8">
                  <EmptyState
                    icon={<BookOpenIcon size={24} />}
                    title="Библиотека пока пуста"
                    description="Добавь первую книгу — и начинай читать на английском, сохраняя новые слова по пути."
                    action={
                      <Button href="/books">
                        Перейти в библиотеку
                        <ArrowRightIcon size={16} />
                      </Button>
                    }
                  />
                </section>
              )}

              <TodayReview reviewCount={reviewCount} />

              <QuickActions />
            </>
          )}
        </div>
      )}
    </AppLayout>
  );
}
