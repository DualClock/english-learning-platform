import Link from 'next/link';
import { Book } from './utils';

function Cover({ book, className, textSize }: { book: Book; className: string; textSize: string }) {
  return (
    <div className={`rounded-xl overflow-hidden shadow-md relative shrink-0 ${className}`}>
      {book.coverUrl ? (
        <img
          src={book.coverUrl}
          alt={book.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      <div
        className={`absolute inset-0 bg-gradient-to-br from-[#C4A77D] to-[#356B52] flex items-center justify-center font-bold text-white ${textSize} ${book.coverUrl ? 'hidden' : ''}`}
      >
        {book.title.charAt(0).toUpperCase()}
      </div>
    </div>
  );
}

export default function ContinueReading({ hero, others }: { hero: Book; others: Book[] }) {
  const progress = Math.round(hero.progress ?? 0);

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-[#20231F] mb-4">Продолжить чтение</h2>

      <div className="bg-white rounded-2xl border border-[#D6D3CC] p-6 shadow-sm flex flex-col sm:flex-row gap-6 hover:shadow-md transition-shadow duration-200">
        <Cover book={hero} className="w-28 aspect-[3/4]" textSize="text-5xl" />

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <h3 className="text-xl font-bold text-[#20231F] mb-1 truncate">{hero.title}</h3>
          {hero.author && <p className="text-[#5A5F5A] mb-4">{hero.author}</p>}

          <div className="mb-5 max-w-md">
            <div className="flex justify-between text-sm text-[#5A5F5A] mb-1.5">
              <span>Прочитано {progress}%</span>
              {hero.currentPage && hero.totalPages ? (
                <span>
                  стр. {hero.currentPage} из {hero.totalPages}
                </span>
              ) : null}
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>

          <div>
            <Link href={`/reader/${hero.id}`} className="btn-primary inline-flex items-center gap-2">
              Читать дальше
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {others.length > 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {others.slice(0, 4).map((book) => (
            <Link
              key={book.id}
              href={`/reader/${book.id}`}
              className="bg-white rounded-2xl border border-[#D6D3CC] p-3 flex items-center gap-3 hover:border-[#356B52] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            >
              <Cover book={book} className="w-10 aspect-[3/4] !rounded-lg !shadow" textSize="text-lg" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[#20231F] text-sm truncate">{book.title}</p>
                {book.author && <p className="text-xs text-[#5A5F5A] truncate">{book.author}</p>}
                <div className="progress-bar h-1 mt-2">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(book.progress ?? 0)}%` }}
                  ></div>
                </div>
              </div>
              <span className="text-xs font-medium text-[#5A5F5A] shrink-0">
                {Math.round(book.progress ?? 0)}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
