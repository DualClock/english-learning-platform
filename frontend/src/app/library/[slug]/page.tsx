import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';
import BookCover from '@/components/library/BookCover';
import Button from '@/components/ui/Button';
import LevelChip from '@/components/ui/LevelChip';
import { ArrowRightIcon, BookOpenIcon } from '@/components/ui/icons';
import { siteUrl } from '@/lib/site';
import {
  LEVEL_NOTES,
  bookHref,
  bookJsonLd,
  bookVolumeLabel,
  jsonLdScript,
  resolveCoverSrc,
} from '@/lib/library';
import { loadPublicBook, loadPublicCatalog } from '@/lib/library-catalog';

/*
 * Страница одной публичной книги (W2.2) — тот самый адрес, на который ведут
 * ссылки из постов и писем: «Алиса в стране чудес с переводом слова по клику».
 * До этого у книги был только приватный /books/<id> за логином.
 *
 * Что здесь принципиально:
 *
 *   - Всё содержание серверное и лежит в первом HTML: ни клиентского fetch, ни
 *     motion-анимаций с opacity: 0. Заголовок, автор, уровень, объём, описание и
 *     превью краулер видит без JavaScript.
 *   - Книги с таким адресом нет — notFound(), а не редирект на /library:
 *     страница книги, которой нет, обязана отвечать 404, иначе индекс наполнится
 *     дублями витрины, а человек решит, что книга существует.
 *   - Превью приходит уже обрезанным лимитом в 150 слов (PREVIEW_WORD_LIMIT на
 *     бэкенде и его зеркало в src/lib/library.ts). Страница ничего не
 *     «дожимает» и, главное, ничего не дописывает: если текста нет, так и
 *     сказано.
 *   - Ни рейтингов, ни «8000 читателей»: JSON-LD содержит только те поля,
 *     которые мы действительно знаем (см. bookJsonLd).
 */

interface PageProps {
  params: { slug: string };
}

/**
 * Адреса для статической генерации — из того же каталога, что и витрина.
 * Когда бэкенда нет под сборкой, это зеркало сида, и его слага сверены с
 * правилом бэкенда тестом, поэтому список адресов не «гуляет» между деплоями.
 */
export async function generateStaticParams() {
  const { books } = await loadPublicCatalog();

  return books.map((book) => ({ slug: book.slug }));
}

/*
 * dynamicParams остаётся включённым (значение по умолчанию): книгу, которая
 * появилась в живом каталоге уже после сборки, страница найдёт сама —
 * loadPublicBook читает каталог при запросе. Запретив его, мы получили бы 404
 * для книги, добавленной после сборки, до ближайшей полной пересборки.
 */

/** Человеческая строка об уровне: код CEFR сам по себе посетителю ничего не говорит. */
function levelLine(level: string | null): string | null {
  if (!level) return null;
  const note = LEVEL_NOTES[level];

  return note ? `Уровень ${level} — ${note.toLowerCase()}` : `Уровень ${level}`;
}

function kindLine(kind: 'classic' | 'story'): string {
  return kind === 'story' ? 'Градированный рассказ Lexicon' : 'Классика в public domain';
}

/** Строка «факта о книге» на карточке: подпись для человека + значение для машины. */
interface BookFact {
  label: string;
  value: string;
  levelCode?: string | null;
  volumeCount?: number | null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const book = await loadPublicBook(params.slug);

  /*
   * Здесь notFound() не вызывается: статус отдаёт сама страница (см. ниже), а
   * метаданные неизвестного адреса должны остаться нейтральными, чтобы 404 не
   * приносил в индекс цепляющий title.
   */
  if (!book) {
    return {
      title: 'Такой книги в открытой полке нет',
      description: 'Публичная библиотека Lexicon: классика и градированные рассказы по уровням CEFR.',
      robots: { index: false, follow: true },
    };
  }

  const author = book.author ?? 'Lexicon';
  const level = levelLine(book.cefrLevel);
  const volume = bookVolumeLabel(book.wordCount);
  const description = [author, level, volume, kindLine(book.kind)]
    .filter(Boolean)
    .join(' · ');

  const cover = resolveCoverSrc(book.coverUrl, API_URL);
  // В og:image идёт только https-обложка: локальный http://localhost:5226 в
  // превью Telegram выглядел бы битой картинкой
  const image = cover && /^https:\/\//i.test(cover) ? cover : '/og.png';

  return {
    title: book.cefrLevel ? `${book.title} · ${book.cefrLevel}` : book.title,
    description,
    alternates: { canonical: bookHref(book.slug) },
    openGraph: {
      type: 'website',
      locale: 'ru_RU',
      url: `${siteUrl}${bookHref(book.slug)}`,
      title: `${book.title} — ${author}`,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${book.title} — ${author}`,
      description,
      images: [image],
    },
  };
}

export default async function LibraryBookPage({ params }: PageProps) {
  const book = await loadPublicBook(params.slug);

  if (!book) notFound();

  const url = `${siteUrl}${bookHref(book.slug)}`;
  const cover = resolveCoverSrc(book.coverUrl, API_URL);
  const volume = bookVolumeLabel(book.wordCount);
  const level = levelLine(book.cefrLevel);

  /*
   * Машиночитаемое значение живёт рядом с человеческой подписью в одной строке:
   * data-level и data-volume попадают в HTML даже тогда, когда подпись уровня
   * или объёма сократят, — и их не придётся угадывать по тексту.
   */
  const facts: BookFact[] = [
    { label: 'Автор', value: book.author ?? 'Lexicon' },
    { label: 'Формат', value: kindLine(book.kind) },
    ...(level ? [{ label: 'Уровень', value: level, levelCode: book.cefrLevel }] : []),
    ...(volume ? [{ label: 'Объём', value: volume, volumeCount: book.wordCount }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-ground-warm text-ink">
      {/*
       * Только данные, которые мы знаем: name / author / inLanguage / genre /
       * url, плюс description, numberOfWords и sameAs, если они есть. Ни
       * aggregateRating, ни числа читателей — при отсутствии данных это была бы
       * не «богатая разметка», а ложь в индексе.
       */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(bookJsonLd(book, url)) }}
      />

      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="font-heading text-h3 font-bold text-ink">
          Lexicon
        </Link>
        <nav aria-label="Разделы" className="flex items-center gap-6 text-body-sm text-charcoal">
          <Link href="/library" className="transition-colors duration-fast ease-soft hover:text-ink">
            Библиотека
          </Link>
          <Link href="/login" className="transition-colors duration-fast ease-soft hover:text-ink">
            Войти
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <nav aria-label="Хлебные крошки" className="text-body-sm text-charcoal">
          <Link
            href="/library"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            ← Вся библиотека
          </Link>
        </nav>

        <article className="card mt-4 p-5 sm:p-8" data-kind={book.kind}>
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <BookCover
              title={book.title}
              coverUrl={cover ?? undefined}
              className="aspect-book w-24 shrink-0 self-start"
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <LevelChip level={book.cefrLevel} />
                <span className="text-caption uppercase tracking-wide text-slate">
                  {kindLine(book.kind)}
                </span>
              </div>

              <h1 className="mt-2 font-heading text-h1 text-ink">{book.title}</h1>
              <p className="mt-1 text-body-lg text-charcoal">{book.author ?? 'Lexicon'}</p>

              {book.description ? (
                <p className="mt-4 max-w-measure text-body text-slate">{book.description}</p>
              ) : null}

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="rounded-lg border border-hairline bg-surface px-4 py-3"
                    data-level={fact.levelCode ?? undefined}
                    data-volume={fact.volumeCount ?? undefined}
                  >
                    <dt className="text-caption uppercase tracking-wide text-slate">{fact.label}</dt>
                    <dd className="mt-1 text-body font-semibold text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </article>

        <section aria-labelledby="book-preview" className="mt-8">
          <h2 id="book-preview" className="text-h3 text-ink">
            Начало текста
          </h2>

          {book.preview ? (
            /*
             * lang="en" обязателен: страница русская, а цитата — английская. Без
             * атрибута экранный читатель произносит её по-русски, а поисковик
             * теряет язык контента.
             */
            <blockquote
              lang="en"
              className="mt-3 rounded-lg border border-hairline bg-canvas p-5 font-reading text-body-lg leading-relaxed text-ink"
            >
              <p className="max-w-measure whitespace-pre-line">{book.preview}</p>
            </blockquote>
          ) : (
            <p className="mt-3 max-w-measure text-body text-charcoal">
              Начало этой книги мы ещё не выложили: полный текст открывается в читалке после
              регистрации, а на витрине появляются только первые строки публичного файла.
            </p>
          )}

          {book.gutenbergId ? (
            <p className="mt-3 text-body-sm text-slate">
              Источник текста —{' '}
              <a
                href={`https://www.gutenberg.org/ebooks/${book.gutenbergId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
              >
                Project Gutenberg №{book.gutenbergId}
              </a>
              : этот текст принадлежит public domain.
            </p>
          ) : null}

          <p className="mt-3 max-w-measure text-caption text-slate">
            На витрине показано не более 150 слов: этого хватает, чтобы понять язык и темп книги, и
            недостаточно, чтобы заменить чтение.
          </p>
        </section>

        <section aria-labelledby="book-next" className="card mt-8 p-5 sm:p-6">
          <h2 id="book-next" className="text-h3 text-ink">
            Что делать дальше
          </h2>
          <p className="mt-2 max-w-measure text-body text-charcoal">
            Тест уровня займёт три минуты и ничего не сохранит — он подскажет, с какой полки
            начинать. Аккаунт открывает читалку: клик по слову даёт перевод, слово уходит в словарь
            и возвращается на повторение само.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button href="/onboarding" className="px-6 py-3 text-body">
              <BookOpenIcon size={20} aria-hidden />
              Читать бесплатно
            </Button>
            <Button href="/test" variant="secondary" className="px-6 py-3 text-body">
              Проверить уровень
            </Button>
          </div>
          <p className="mt-4 text-body-sm text-charcoal">
            <Link
              href="/beta"
              className="inline-flex items-center gap-2 underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
            >
              Или вступите в когорту чтения со 2 ноября
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
          </p>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
        <nav
          aria-label="Подвал"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-charcoal"
        >
          <Link
            href="/library"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Библиотека
          </Link>
          <Link
            href="/privacy"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Конфиденциальность
          </Link>
          <Link
            href="/terms"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Правила беты
          </Link>
        </nav>
        <Link
          href="/"
          className="text-body-sm text-charcoal transition-colors duration-fast ease-soft hover:text-ink"
        >
          О сервисе
        </Link>
      </footer>
    </div>
  );
}
