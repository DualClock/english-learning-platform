'use client';

import { Skeleton } from '@/components/ui/LoadingState';

/**
 * Заглушка повторяет раскладку страницы читалки, чтобы текст вставал на своё
 * место, а не сдвигал заголовок и панель вниз.
 */
export default function ReaderSkeleton() {
  const lines = [92, 88, 95, 80, 90, 85, 93, 70, 88, 82, 90, 76];
  return (
    <div className="flex flex-col gap-4 md:flex-row" role="status" aria-busy="true">
      <span className="sr-only">Загрузка книги</span>

      <div className="min-w-0 flex-1">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="card p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-measure space-y-4">
            {lines.map((width, i) => (
              <Skeleton key={i} className="h-5" style={{ width: `${width}%` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="hidden w-80 shrink-0 md:block">
        <div className="card space-y-3 p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
