'use client';

interface PagerProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Простая пагинация: назад / вперёд + индикатор страницы */
export default function Pager({ page, totalPages, onPageChange }: PagerProps) {
  if (totalPages <= 1) return null;

  return (
    <nav
      className="flex items-center justify-center gap-4 mt-8"
      aria-label="Пагинация"
    >
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Назад
      </button>
      <span className="text-sm text-[var(--color-slate)]">
        Страница {page} из {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Вперёд →
      </button>
    </nav>
  );
}
