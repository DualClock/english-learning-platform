'use client';

import BookCover from './BookCover';
import LevelChip from './LevelChip';

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
    <div className="flex flex-col rounded-2xl border border-[#D6D3CC] bg-white p-3 transition-all duration-200 hover:-translate-y-1 hover:border-[#C4A77D] hover:shadow-lg">
      <div className="relative">
        <BookCover
          title={book.title}
          coverUrl={book.coverUrl}
          className="aspect-[2/3] w-full rounded-xl"
        />
        <div className="absolute top-2 right-2">
          <LevelChip level={book.cefrLevel} />
        </div>
      </div>
      <h3 className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-[#20231F]">
        {book.title}
      </h3>
      <p className="truncate text-xs text-[#5A5F5A]">{book.author || '—'}</p>
      {book.description && (
        <p className="mt-1 line-clamp-2 flex-1 text-xs text-[#5A5F5A]">{book.description}</p>
      )}
      <div className="mt-3">
        {inLibrary ? (
          <span className="block w-full cursor-default rounded-lg bg-[#E7ECE4] py-2 text-center text-xs font-medium text-[#5A5F5A]">
            В библиотеке
          </span>
        ) : (
          <button
            onClick={() => onAdd(book)}
            disabled={adding}
            className="w-full rounded-lg bg-[#356B52] py-2 text-sm font-medium text-white transition-colors hover:bg-[#2A5542] disabled:opacity-60"
          >
            {adding ? 'Добавляем…' : '+ Добавить'}
          </button>
        )}
      </div>
    </div>
  );
}
