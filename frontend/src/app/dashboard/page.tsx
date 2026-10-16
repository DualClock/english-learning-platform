'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect } from 'react';
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
import { EmptyBooks, ErrorState } from '@/components/dashboard/States';
import { Book, pickContinueBook } from '@/components/dashboard/utils';
import { API_URL } from '@/app/lib/api-url';

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

export default function DashboardPage() {
  const { data: session } = useSession();
  const [books, setBooks] = useState<Book[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [dictCount, setDictCount] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [streakLoaded, setStreakLoaded] = useState(false);
  const [recommended, setRecommended] = useState<RecommendedBook[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const trackEvent = useTrack();

  useEffect(() => {
    if (!session) return;
    trackEvent('login');
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const token = session?.accessToken;
      const headers = { Authorization: `Bearer ${token}` };

      const booksRes = await fetch(`${API_URL}/api/books`, { headers });
      if (!booksRes.ok) {
        throw new Error(`Failed to load books: ${booksRes.status}`);
      }
      setBooks(await booksRes.json());

      // Профиль — некритично, при сбое блоки уровня и рекомендаций скрываются
      try {
        const profileRes = await fetch(`${API_URL}/api/profile`, { headers });
        if (profileRes.ok) {
          const profileData: Profile = await profileRes.json();
          setProfile(profileData);

          if (profileData.cefrLevel) {
            try {
              const recRes = await fetch(
                `${API_URL}/api/books/recommended?level=${encodeURIComponent(profileData.cefrLevel)}`,
                { headers }
              );
              if (recRes.ok) {
                setRecommended(await recRes.json());
              } else {
                setRecommended([]);
              }
            } catch (err) {
              console.error('Failed to load recommended books:', err);
              setRecommended([]);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
      }

      // Стрик и XP — некритично, при сбое карточка скрывается
      try {
        const streakRes = await fetch(`${API_URL}/api/progress/streak`, { headers });
        if (streakRes.ok) {
          setStreak(await streakRes.json());
        }
      } catch (err) {
        console.error('Failed to load streak:', err);
      } finally {
        setStreakLoaded(true);
      }

      // Слова на повторение — некритично, при сбое показываем 0
      try {
        const reviewRes = await fetch(`${API_URL}/api/review/today`, { headers });
        if (reviewRes.ok) {
          const reviewData = await reviewRes.json();
          setReviewCount(reviewData.totalCount || 0);
        }
      } catch (err) {
        console.error('Failed to load review count:', err);
      }

      // Размер словаря — некритично, при сбое карточка скрывается
      try {
        const dictRes = await fetch(`${API_URL}/api/dictionary`, { headers });
        if (dictRes.ok) {
          const dictData = await dictRes.json();
          setDictCount(Array.isArray(dictData) ? dictData.length : null);
        }
      } catch (err) {
        console.error('Failed to load dictionary:', err);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const userName = session?.user?.name || profile?.displayName || session?.user?.email?.split('@')[0];

  return (
    <AppLayout>
      {isLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className="animate-fade-in">
          <GreetingHeader name={userName} level={profile?.cefrLevel} />

          {hasError ? (
            <ErrorState onRetry={loadDashboardData} />
          ) : (
            <>
              <StatsRow
                dictCount={dictCount}
                reviewCount={reviewCount}
                booksCount={books.length}
                totalXp={streak?.totalXp ?? profile?.totalXp ?? null}
              />

              {streakLoaded && <StreakCard streak={streak} />}

              {recommended !== null && profile?.cefrLevel && (
                <RecommendedShelf
                  level={profile.cefrLevel}
                  books={recommended}
                  token={session?.accessToken}
                />
              )}

              {books.length === 0 && dictCount === 0 && <FirstLesson />}

              {books.length > 0 ? (
                (() => {
                  const hero = pickContinueBook(books)!;
                  return (
                    <ContinueReading
                      hero={hero}
                      others={books.filter((b) => b.id !== hero.id)}
                    />
                  );
                })()
              ) : (
                <EmptyBooks />
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
