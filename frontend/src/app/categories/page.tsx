'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useApiQuery } from '@/app/lib/use-api';

interface CategorySummary {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  description?: string;
  wordCount: number;
  learned: number;
  learning: number;
  notStarted: number;
}

export default function CategoriesPage() {
  const { status } = useSession();
  const router = useRouter();

  const {
    data: categoriesData,
    error: categoriesError,
    isLoading,
    refresh,
  } = useApiQuery<CategorySummary[]>('/api/categories');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const categories = Array.isArray(categoriesData) ? categoriesData : [];
  // Ошибку показываем, только если данных нет: устаревший кэш при неудачном
  // фоновом обновлении не должен «съедать» уже отрисованный список.
  const error =
    categoriesError && categoriesData === undefined
      ? 'Не удалось загрузить категории. Попробуйте обновить страницу.'
      : '';

  // Скелетон — только когда данных ещё нет (повторный заход рисуется из кэша)
  const showSkeleton = !error && isLoading && categoriesData === undefined;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-2">Категории слов</h1>
        <p className="text-[var(--color-slate)] mb-8">
          Учи слова по темам: эмоции, еда, путешествия и другие
        </p>

        {error && (
          <div className="card p-12 text-center">
            <p className="text-[var(--color-slate)] mb-4">{error}</p>
            <button onClick={refresh} className="btn-secondary">
              Попробовать снова
            </button>
          </div>
        )}

        {showSkeleton && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="card p-6 animate-pulse">
                <div className="h-8 w-8 bg-[rgba(201,205,212,0.40)] rounded mb-3"></div>
                <div className="h-5 bg-[rgba(201,205,212,0.40)] rounded w-2/3 mb-2"></div>
                <div className="h-4 bg-[rgba(201,205,212,0.40)] rounded w-full mb-4"></div>
                <div className="h-2 bg-[rgba(201,205,212,0.40)] rounded w-full"></div>
              </div>
            ))}
          </div>
        )}

        {!error && !showSkeleton && categories.length === 0 && (
          <div className="card p-12 text-center">
            <div className="text-4xl mb-4" aria-hidden="true">🗂️</div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)] mb-2">Категории скоро появятся</h2>
            <p className="text-[var(--color-slate)] mb-6">
              Пока подборок нет — начните со сборников частотных слов или добавьте свои слова.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link href="/dictionary?tab=lists" className="btn-primary">
                Открыть сборники
              </Link>
              <Link href="/dictionary/add" className="btn-secondary">
                Добавить слово
              </Link>
            </div>
          </div>
        )}

        {!error && !showSkeleton && categories.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => {
              const learnedPct = cat.wordCount > 0 ? (cat.learned / cat.wordCount) * 100 : 0;
              const learningPct = cat.wordCount > 0 ? (cat.learning / cat.wordCount) * 100 : 0;
              return (
                <Link key={cat.id} href={`/categories/${cat.slug}`} className="card p-6 block hover:shadow-lg transition-shadow">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4"
                    style={{ backgroundColor: `${cat.color || '#3B82F6'}20` }}
                  >
                    <span aria-hidden="true">{cat.icon || '📖'}</span>
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-1">{cat.name}</h2>
                  {cat.description && (
                    <p className="text-sm text-[var(--color-slate)] mb-4 line-clamp-2">{cat.description}</p>
                  )}
                  <div className="text-xs text-[var(--color-slate)] mb-2">
                    {cat.learned} выучено · {cat.learning} в процессе · {cat.notStarted} не начато
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden flex"
                    style={{ backgroundColor: 'rgba(201,205,212,0.40)' }}
                    role="progressbar"
                    aria-valuenow={cat.learned}
                    aria-valuemax={cat.wordCount}
                  >
                    <div className="h-full" style={{ width: `${learnedPct}%`, backgroundColor: cat.color || '#22C55E' }} />
                    <div className="h-full" style={{ width: `${learningPct}%`, backgroundColor: `${cat.color || '#22C55E'}80` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
