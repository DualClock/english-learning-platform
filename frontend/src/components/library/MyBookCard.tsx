'use client';

import BookCover from './BookCover';
import LevelChip from '@/components/ui/LevelChip';
import ProgressBar from '@/components/ui/ProgressBar';
import { CardInteractive } from '@/components/ui/Card';
import { CloseIcon } from '@/components/ui/icons';

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
    <div className="group relative flex h-full">
      <CardInteractive
        onClick={() => onOpen(book.id)}
        ariaLabel={`Открыть «${book.title}»`}
        className="flex h-full flex-col p-2"
      >
        <BookCover
          title={book.title}
          coverUrl={book.coverUrl}
          className="aspect-book w-full"
        />
        <div className="flex flex-1 flex-col px-1 pb-1 pt-2">
          <h3 className="line-clamp-2 text-body-sm font-semibold leading-snug text-ink">{book.title}</h3>
          <p className="mt-0.5 truncate text-caption text-slate">{book.author || '—'}</p>
          {/* mt-auto держит полосу на одной линии по всему ряду, даже если
              заголовок занял одну строку вместо двух */}
          <div className="mt-auto flex items-center gap-2 pt-2">
            <ProgressBar
              value={progress}
              label={`Прочитано «${book.title}»`}
              className="h-1 bg-hairline"
            />
            <span className="shrink-0 text-caption tabular-nums text-slate">{progress}%</span>
          </div>
        </div>
      </CardInteractive>

      {book.cefrLevel && (
        <div className="pointer-events-none absolute right-3 top-3">
          <LevelChip level={book.cefrLevel} />
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (confirm(`Удалить «${book.title}»?`)) onDelete(book);
        }}
        className="card-action icon-chip absolute left-3 top-3 h-8 min-w-8 border-canvas bg-canvas shadow-soft hover:bg-surface-danger hover:text-semantic-error"
        aria-label={`Удалить «${book.title}»`}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
