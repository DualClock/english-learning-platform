'use client';

import BookCard from './BookCard';

/**
 * Классика из каталога. Как и рассказ, рисуется общей BookCard —
 * отличается только типом и тем, что нет перехода к чтению по id.
 */
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
    <BookCard
      kind="classic"
      title={book.title}
      author={book.author || '—'}
      description={book.description}
      level={book.cefrLevel}
      coverUrl={book.coverUrl}
      inLibrary={inLibrary}
      adding={adding}
      onAdd={() => onAdd(book)}
    />
  );
}
