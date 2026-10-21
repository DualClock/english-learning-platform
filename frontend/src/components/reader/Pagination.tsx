'use client';

import { ArrowLeftIcon, ArrowRightIcon } from '@/components/ui/icons';

interface Props {
  page: number;
  total: number;
  onPage: (page: number) => void;
}

/** Пять кнопок-страниц: окно сдвигается к середине, у краёв прижимается к ним. */
export function pageWindow(current: number, total: number): number[] {
  const size = Math.min(5, total);
  let start: number;
  if (total <= 5) {
    start = 1;
  } else if (current <= 3) {
    start = 1;
  } else if (current >= total - 2) {
    start = total - 4;
  } else {
    start = current - 2;
  }
  return Array.from({ length: size }, (_, i) => start + i);
}

export default function Pagination({ page, total, onPage }: Props) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
      <button onClick={() => onPage(page - 1)} disabled={page === 1} className="btn-secondary">
        <ArrowLeftIcon size={16} />
        <span className="hidden sm:inline">Назад</span>
      </button>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {pageWindow(page, total).map((pageNum) => (
          <button
            key={pageNum}
            onClick={() => onPage(pageNum)}
            aria-label={`Страница ${pageNum}`}
            aria-current={pageNum === page ? 'page' : undefined}
            className={
              pageNum === page
                ? 'icon-chip border-primary bg-primary font-semibold text-on-primary hover:bg-primary-pressed hover:text-on-primary'
                : 'icon-chip tabular-nums'
            }
          >
            {pageNum}
          </button>
        ))}
      </div>

      <button onClick={() => onPage(page + 1)} disabled={page === total} className="btn-secondary">
        <span className="hidden sm:inline">Вперёд</span>
        <ArrowRightIcon size={16} />
      </button>
    </div>
  );
}
