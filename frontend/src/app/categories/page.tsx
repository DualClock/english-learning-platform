'use client';

import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/LoadingState';
import { CardInteractive } from '@/components/ui/Card';
import { FoldersIcon } from '@/components/ui/icons';
import CategoryIcon from '@/components/dictionary/CategoryIcon';
import { motion } from 'motion/react';
import { useApiQuery } from '@/app/lib/use-api';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

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
      <PageHeader
        title="Категории слов"
        subtitle="Учи слова по темам: эмоции, еда, путешествия и другие"
      />

      {error && (
        <ErrorState
          title="Категории не загрузились"
          description={error}
          onRetry={refresh}
        />
      )}

      {showSkeleton && <CategoriesSkeleton />}

      {!error && !showSkeleton && categories.length === 0 && (
        <EmptyState
          icon={<FoldersIcon size={24} />}
          title="Категории скоро появятся"
          description="Пока подборок нет — начните со сборников частотных слов или добавьте свои слова."
          action={
            <>
              <Button href="/dictionary?tab=lists">Открыть сборники</Button>
              <Button href="/dictionary/add" variant="secondary">
                Добавить слово
              </Button>
            </>
          }
        />
      )}

      {!error && !showSkeleton && categories.length > 0 && (
        <motion.ul className="stagger grid gap-4 md:grid-cols-2 lg:grid-cols-3" initial={false}>
          {categories.map((cat) => (
            <li key={cat.id}>
              <CardInteractive
                href={`/categories/${cat.slug}`}
                ariaLabel={`Категория «${cat.name}»`}
                className="flex h-full flex-col p-6"
              >
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-primary">
                  <CategoryIcon slug={cat.slug} name={cat.name} size={24} />
                </span>
                <h2 className="mb-1 text-h3 text-ink">{cat.name}</h2>
                {cat.description && (
                  <p className="mb-4 line-clamp-2 text-body-sm text-slate">{cat.description}</p>
                )}
                <p className="mt-auto text-caption tabular-nums text-slate">
                  {cat.learned} выучено · {cat.learning} в процессе · {cat.notStarted} не начато
                </p>
                <ProgressBar
                  value={cat.wordCount > 0 ? (cat.learned / cat.wordCount) * 100 : 0}
                  label={`Выучено в категории «${cat.name}»`}
                  className="mt-2"
                />
              </CardInteractive>
            </li>
          ))}
        </motion.ul>
      )}
    </AppLayout>
  );
}

/** Заглушка повторяет сетку категорий: карточки не меняют размер при загрузке. */
function CategoriesSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      <span className="sr-only">Загрузка категорий</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card space-y-3">
          <Skeleton className="h-12 w-12" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}
