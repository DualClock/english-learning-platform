import BookCover from '@/components/library/BookCover';
import Button from '@/components/ui/Button';
import { CardInteractive } from '@/components/ui/Card';
import ProgressBar from '@/components/ui/ProgressBar';
import { ArrowRightIcon } from '@/components/ui/icons';
import { Book } from './utils';

export default function ContinueReading({ hero, others }: { hero: Book; others: Book[] }) {
  const progress = Math.round(hero.progress ?? 0);

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-h3 text-ink">Продолжить чтение</h2>

      <div className="card flex flex-col gap-6 sm:flex-row">
        <BookCover title={hero.title} coverUrl={hero.coverUrl} className="w-28 aspect-book" />

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h3 className="truncate text-h1 text-ink">{hero.title}</h3>
          {hero.author && <p className="mt-1 text-body text-slate">{hero.author}</p>}

          <div className="mb-6 mt-5 max-w-measure-sm">
            <div className="mb-2 flex justify-between text-body-sm text-slate">
              <span>Прочитано {progress}%</span>
              {hero.currentPage && hero.totalPages ? (
                <span className="tabular-nums">
                  стр. {hero.currentPage} из {hero.totalPages}
                </span>
              ) : null}
            </div>
            <ProgressBar value={progress} />
          </div>

          <div>
            <Button href={`/reader/${hero.id}`}>
              Читать дальше
              <ArrowRightIcon size={16} />
            </Button>
          </div>
        </div>
      </div>

      {others.length > 0 && (
        <div className="stagger mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {others.slice(0, 4).map((book) => (
            <CardInteractive key={book.id} href={`/reader/${book.id}`} className="flex items-center gap-3 p-3">
              <BookCover title={book.title} coverUrl={book.coverUrl} size="sm" className="w-10 aspect-book" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium text-ink">{book.title}</span>
                {book.author && <span className="block truncate text-caption text-slate">{book.author}</span>}
                <ProgressBar value={Math.round(book.progress ?? 0)} className="mt-2 h-1" />
              </span>
              <span className="shrink-0 text-caption text-slate tabular-nums">
                {Math.round(book.progress ?? 0)}%
              </span>
            </CardInteractive>
          ))}
        </div>
      )}
    </section>
  );
}
