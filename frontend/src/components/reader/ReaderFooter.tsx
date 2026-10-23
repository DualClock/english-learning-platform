'use client';

import { ArrowLeftIcon, ArrowRightIcon } from '@/components/ui/icons';

interface Props {
  page: number;
  total: number;
  chapterTitle: string;
  progress: number;
  onPage: (page: number) => void;
}

/**
 * Подвал книжной страницы: номер, глава и тихие стрелки. Тонкая линия сверху —
 * прогресс по всей книге; он не отвлекает, но всегда честно показывает место.
 */
export default function ReaderFooter({ page, total, chapterTitle, progress, onPage }: Props) {
  return (
    <footer className="relative flex h-14 shrink-0 items-center gap-2 border-t border-[var(--reader-hairline)] bg-[var(--reader-paper)] px-3 sm:px-5">
      <span
        className="absolute inset-x-0 top-0 h-px bg-[var(--reader-hairline)]"
        aria-hidden="true"
      >
        <span
          className="block h-full bg-primary transition-[width] duration-base ease-soft motion-reduce:transition-none"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </span>

      <span className="shrink-0 text-caption tabular-nums text-[var(--reader-ink-soft)]">
        {page} / {total}
      </span>

      <span
        className="min-w-0 flex-1 truncate text-center font-reading text-caption text-[var(--reader-ink-soft)]"
        title={chapterTitle}
      >
        {chapterTitle}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Предыдущая страница"
          className="reader-icon-btn h-11 w-11 min-w-0"
        >
          <ArrowLeftIcon size={20} />
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= total}
          aria-label="Следующая страница"
          className="reader-icon-btn h-11 w-11 min-w-0"
        >
          <ArrowRightIcon size={20} />
        </button>
      </div>
    </footer>
  );
}
