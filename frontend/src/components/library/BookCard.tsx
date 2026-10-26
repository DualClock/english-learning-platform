'use client';

import BookCover from './BookCover';
import LevelChip from '@/components/ui/LevelChip';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import { CheckIcon, PlusIcon } from '@/components/ui/icons';

/**
 * Единая карточка книги.
 *
 * До этого в одной сетке жили две разные карточки: рассказы — горизонтальные,
 * с миниатюрой 56px и сеткой по пять в ряд, классика — вертикальные, с
 * обложкой на всю ширину и сеткой по два. Экран читался как два разных
 * продукта, склеенных в один.
 *
 * Теперь карточка одна: вертикальная, с обложкой 3:4, одинаковой ширины.
 * Тип книги — значок над обложкой, а не другая геометрия. Так рассказ и
 * роман можно ставить в один ряд, и сетка не рассыпается.
 */

export type BookKind = 'story' | 'classic';

interface BookCardProps {
  title: string;
  author?: string | null;
  description?: string | null;
  level?: string | null;
  coverUrl?: string;
  kind: BookKind;
  /** Книга уже в библиотеке: вместо «Добавить» показываем переход к чтению. */
  inLibrary?: boolean;
  /** Книга в библиотеке, но её id известен — открываем сразу. */
  addedBookId?: number | null;
  adding?: boolean;
  onAdd: () => void;
  onOpen?: (id: number) => void;
}

const KIND_LABEL: Record<BookKind, string> = {
  story: 'рассказ',
  classic: 'классика',
};

export default function BookCard({
  title,
  author,
  description,
  level,
  coverUrl,
  kind,
  inLibrary = false,
  addedBookId = null,
  adding = false,
  onAdd,
  onOpen,
}: BookCardProps) {
  const isAdded = inLibrary || addedBookId !== null;

  return (
    <article className="group flex h-full flex-col">
      <div className="relative">
        <BookCover title={title} coverUrl={coverUrl} className="aspect-book w-full" />
        {level && (
          <div className="absolute right-2 top-2">
            <LevelChip level={level} />
          </div>
        )}
      </div>

      {/* Тип книги — подписью, а не другой формой карточки */}
      <p className="mt-2 text-caption uppercase tracking-wide text-slate">{KIND_LABEL[kind]}</p>

      <h3 className="mt-0.5 line-clamp-2 text-body-sm font-semibold leading-snug text-ink">
        {title}
      </h3>

      {author && <p className="mt-0.5 truncate text-caption text-slate">{author}</p>}

      {description && (
        <p className="mt-1 hidden line-clamp-2 text-caption text-slate sm:block">{description}</p>
      )}

      {/* mt-auto прижимает кнопки к низу: в ряду они встают на одну линию */}
      <div className="mt-auto pt-3">
        {isAdded ? (
          addedBookId !== null && onOpen ? (
            <Button variant="secondary" onClick={() => onOpen(addedBookId)} className="w-full">
              Открыть
            </Button>
          ) : (
            <Tag tone="success" className="w-full justify-center py-2">
              <CheckIcon size={16} className="mr-1" />
              В библиотеке
            </Tag>
          )
        ) : (
          <Button onClick={onAdd} disabled={adding} className="w-full">
            <PlusIcon size={16} />
            {adding ? 'Добавляем…' : 'Добавить'}
          </Button>
        )}
      </div>
    </article>
  );
}
