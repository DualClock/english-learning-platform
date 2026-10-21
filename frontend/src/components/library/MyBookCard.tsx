'use client';

import BookCover from './BookCover';
import LevelChip from '@/components/ui/LevelChip';

export interface UserBook {
  id: number;
  title: string;
  author?: string;
  cefrLevel?: string;
  coverUrl?: string;
  progress?: number;
  currentPage?: number;
  totalPages?: number;
}

function normalizeProgress(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  // прогресс может прийти долей (0.42) или сырым числом (91.74, 1008) — приводим к 0..100
  const scaled = raw > 0 && raw < 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

interface MyBookCardProps {
  book: UserBook;
  onOpen: (id: number) => void;
  onDelete: (book: UserBook) => void;
}

export default function MyBookCard({ book, onOpen, onDelete }: MyBookCardProps) {
  const progress =
    book.progress != null
      ? normalizeProgress(book.progress)
      : book.currentPage && book.totalPages
        ? Math.min(100, Math.max(0, Math.round((book.currentPage / book.totalPages) * 100)))
        : 0;

  return (
    <div className="group">
      <div
        onClick={() => onOpen(book.id)}
        className="cursor-pointer rounded-xl border border-[var(--color-hairline-strong)] bg-white p-2 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--color-primary-pressed)] hover:shadow-lg"
      >
        <div className="relative">
          <BookCover
            title={book.title}
            coverUrl={book.coverUrl}
            className="aspect-[2/3] w-full rounded-xl"
          />
          {book.cefrLevel && (
            <div className="absolute top-2 right-2">
              <LevelChip level={book.cefrLevel} />
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Удалить «${book.title}»?`)) onDelete(book);
            }}
            className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-sm text-[var(--color-slate)] opacity-0 shadow transition-opacity hover:bg-[var(--color-error)] hover:text-white group-hover:opacity-100"
            aria-label="Удалить книгу"
          >
            ✕
          </button>
        </div>
        <div className="px-1 pb-1 pt-2">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-[var(--color-ink)]">
            {book.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-[var(--color-slate)]">{book.author || '—'}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-tint-mint)]">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[var(--color-slate)]">{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
