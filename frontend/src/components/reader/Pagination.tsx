'use client';

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
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        aria-label="Предыдущая страница"
        className="btn-secondary"
      >
        <span className="hidden sm:inline">← Назад</span>
        <span aria-hidden="true" className="sm:hidden">←</span>
      </button>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {pageWindow(page, total).map((pageNum) => (
          <button
            key={pageNum}
            onClick={() => onPage(pageNum)}
            aria-label={`Страница ${pageNum}`}
            aria-current={pageNum === page ? 'page' : undefined}
            className={`h-9 w-9 rounded-lg text-sm transition-colors sm:h-10 sm:w-10 ${
              pageNum === page
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-white border border-[var(--color-hairline-strong)] hover:bg-[var(--color-tint-mint)]'
            }`}
          >
            {pageNum}
          </button>
        ))}
      </div>

      <button
        onClick={() => onPage(page + 1)}
        disabled={page === total}
        aria-label="Следующая страница"
        className="btn-secondary"
      >
        <span className="hidden sm:inline">Вперёд →</span>
        <span aria-hidden="true" className="sm:hidden">→</span>
      </button>
    </div>
  );
}
