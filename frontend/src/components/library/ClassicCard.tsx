'use client';

import BookCover from './BookCover';
import LevelChip from '@/components/ui/LevelChip';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import { CheckIcon, PlusIcon } from '@/components/ui/icons';

export interface PopularBook {
  gutenbergId: string;
  title: string;
  author?: string;
  description?: string;
  cefrLevel?: string;
  coverUrl?: string;
}

interface ClassicCardProps {
  book: PopularBook;
  inLibrary: boolean;
  adding: boolean;
  onAdd: (book: PopularBook) => void;
}

export default function ClassicCard({ book, inLibrary, adding, onAdd }: ClassicCardProps) {
  return (
    <article className="card flex h-full flex-col p-3">
      <div className="relative">
        <BookCover title={book.title} coverUrl={book.coverUrl} className="aspect-book w-full" />
        <div className="absolute right-2 top-2">
          <LevelChip level={book.cefrLevel} />
        </div>
      </div>

      <h3 className="mt-2 line-clamp-2 text-body-sm font-semibold leading-snug text-ink">{book.title}</h3>
      <p className="truncate text-caption text-slate">{book.author || '—'}</p>
      {book.description && (
        <p className="mt-1 line-clamp-2 text-caption text-slate">{book.description}</p>
      )}

      {/* mt-auto выравнивает нижний край кнопок по всему ряду карточек */}
      <div className="mt-auto pt-3">
        {inLibrary ? (
          <Tag tone="success" className="w-full py-2">
            <CheckIcon size={16} className="mr-1" />
            В библиотеке
          </Tag>
        ) : (
          <Button onClick={() => onAdd(book)} disabled={adding} className="w-full">
            <PlusIcon size={16} />
            {adding ? 'Добавляем…' : 'Добавить'}
          </Button>
        )}
      </div>
    </article>
  );
}
