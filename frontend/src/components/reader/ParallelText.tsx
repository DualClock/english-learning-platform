'use client';

import { Fragment } from 'react';
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
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start">
        {[95, 88, 92, 70].map((w, i) => (
          <Fragment key={i}>
            <div className="h-5 rounded bg-[var(--color-tint-mint)] animate-pulse" style={{ width: `${w}%` }}></div>
            <div
              className="h-4 mt-1 rounded bg-[rgba(217,243,225,0.60)] animate-pulse"
              style={{ width: `${Math.max(40, w - 25)}%` }}
            ></div>
          </Fragment>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-[var(--color-error)] mb-4">Не удалось загрузить перевод</p>
        <button onClick={onRetry} className="btn-secondary text-sm py-2 px-4">
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div>
      {showHint && (
        <p className="text-xs text-[var(--color-slate)] italic mb-4">
          Кликайте по словам в обычном режиме EN
        </p>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start">
        {chunks.map((chunk, i) => (
          <Fragment key={i}>
            <p className="text-[var(--color-ink)]">{chunk.en}</p>
            <p className="text-base leading-relaxed text-[var(--color-slate)]">{chunk.ru ?? ''}</p>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
