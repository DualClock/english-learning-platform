'use client';

import { ArrowLeftIcon, ArrowRightIcon } from './ui/icons';

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
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary"
      >
        <ArrowLeftIcon size={16} />
        Назад
      </button>
      {/* Счётчик проявляется заново при смене страницы — тот же сигнал, что и у обновившегося списка */}
      <span
        key={page}
        className="animate-fade-in text-body-sm text-slate tabular-nums"
        aria-live="polite"
      >
        Страница {page} из {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="btn-secondary"
      >
        Вперёд
        <ArrowRightIcon size={16} />
      </button>
    </nav>
  );
}
