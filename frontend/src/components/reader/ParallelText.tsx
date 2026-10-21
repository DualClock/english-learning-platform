'use client';

import { Fragment } from 'react';
import { Skeleton } from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { BooksIcon } from '@/components/ui/icons';
import type { ParallelChunk } from './types';

interface Props {
  chunks: ParallelChunk[];
  loading: boolean;
  error: boolean;
  showHint: boolean;
  onRetry: () => void;
}

/** Параллельный EN/RU режим: две колонки, на узких экранах складываются в одну. */
export default function ParallelText({ chunks, loading, error, showHint, onRetry }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start" role="status" aria-busy="true">
        {[95, 88, 92, 70].map((w, i) => (
          <Fragment key={i}>
            <Skeleton className="h-6" style={{ width: `${w}%` }} />
            <Skeleton className="h-5" style={{ width: `${Math.max(40, w - 25)}%` }} />
          </Fragment>
        ))}
        <span className="sr-only">Загружаем параллельный перевод</span>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Не удалось загрузить перевод"
        description="Параллельный текст не пришёл. Попробуйте ещё раз — обычный режим чтения при этом работает."
        onRetry={onRetry}
      />
    );
  }

  if (!chunks.length) {
    return (
      <EmptyState
        variant="inline"
        icon={<BooksIcon size={24} />}
        title="Перевод этой страницы ещё не готов"
        description="Вернитесь в режим EN и листайте дальше — параллельный текст подтянется, как только будет обработан."
      />
    );
  }

  return (
    <div>
      {showHint && (
        <p className="mb-4 text-caption italic text-slate">Кликайте по словам в обычном режиме EN</p>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start">
        {chunks.map((chunk, i) => (
          <Fragment key={i}>
            <p className="text-ink">{chunk.en}</p>
            <p className="text-charcoal">{chunk.ru ?? ''}</p>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
