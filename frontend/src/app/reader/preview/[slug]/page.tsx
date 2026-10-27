import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import GuestReaderView from './GuestReaderView';
import { Skeleton } from '@/components/ui/LoadingState';
import { API_URL } from '@/app/lib/api-url';
import { siteUrl } from '@/lib/site';
import {
  LEVEL_NOTES,
  bookHref,
  bookJsonLd,
  bookVolumeLabel,
  jsonLdScript,
  resolveCoverSrc,
} from '@/lib/library';
import { loadPublicBook } from '@/lib/library-catalog';
import {
  GUEST_BANNER_TEXT,
  guestPreviewHref,
  lockedChaptersLabel,
  previewDescription,
  previewNotice,
} from '@/lib/guest-reader';
import { loadGuestChapter } from '@/lib/guest-reader.server';

/*
 * Гостевое превью книги (R2): /reader/preview/<slug>.
 *
 * Страница существует потому, что «читать можно без регистрации» до сих пор
 * было неправдой: витрина показывала 150 слов цитаты, а читалка требовала
 * аккаунт. Здесь гость кликает по слову и видит перевод — без куки, без JWT
 * и без записи в чью-либо карточку.
 *
 * Свойства, которые нельзя потерять при правках:
 *
 *  1. Серверный компонент. Название, автор, уровень и первая глава лежат в
 *     HTML до JavaScript: краулер индексирует текст, а человек из мессенджера
 *     видит книгу, не дожидаясь гидратации.
 *  2. 404 — это notFound(), а не редирект на /library. Прежний адрес книги с
 *     неверным слагом не должен выглядеть живым.
 *  3. Если бэкенд не ответил, страница не падает и не врёт: вместо текста —
 *     честное «не загрузился», а не пустая колонка с вечным скелетоном.
 *  4. Canonical — публичный адрес книги (/library/<slug>), а не превью: превью
 *     это второй адрес того же текста, и индексировать его как основной нельзя.
 */

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const book = await loadPublicBook(params.slug);

  /*
   * Метаданные неизвестного адреса остаются нейтральными: статус отдаёт сама
   * страница, а 404 с цепляющим title попал бы в индекс.
   */
  if (!book) {
    return {
      title: 'Такой книги в открытой полке нет',
      description: 'Гостевой режим чтения Lexicon: первая глава публичной книги без регистрации.',
      robots: { index: false, follow: true },
    };
  }

  const description = previewDescription(book);
  const cover = resolveCoverSrc(book.coverUrl, API_URL);
  // В og:image — только абсолютная https-обложка: localhost в превью Telegram
  // выглядит битой картинкой.
  const image = cover && /^https:\/\//i.test(cover) ? cover : '/og.png';

  return {
    title: book.cefrLevel
      ? `${book.title} — читать первую главу · ${book.cefrLevel}`
      : `${book.title} — читать первую главу`,
    description,
    // Основной адрес — карточка книги; превью не должно конкурировать с ней
    // в выдаче как второй документ с тем же текстом.
    alternates: { canonical: bookHref(book.slug) },
    openGraph: {
      type: 'article',
      locale: 'ru_RU',
      url: `${siteUrl}${guestPreviewHref(book.slug)}`,
      title: `${book.title} — первая глава без регистрации`,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${book.title} — первая глава без регистрации`,
      description,
      images: [image],
    },
  };
}

export default async function GuestPreviewPage({ params }: PageProps) {
  const book = await loadPublicBook(params.slug);

  if (!book) notFound();

  const loaded = await loadGuestChapter(book.slug);
  const notice = previewNotice({
    hasText: loaded.status === 'ok',
    backendError: loaded.status === 'error',
  });
  const url = `${siteUrl}${bookHref(book.slug)}`;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--reader-desk)] text-ink">
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
        <nav aria-label="Хлебные крошки" className="flex flex-wrap items-center gap-2 text-body-sm text-charcoal">
          <Link
            href={`/library/${encodeURIComponent(book.slug)}`}
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            {book.title}
          </Link>
          <span aria-hidden>·</span>
          <span>Глава 1 — чтение без регистрации</span>
        </nav>

        <section className="card mt-4 p-5 sm:p-6" data-testid="guest-preview-intro">
          <h1 className="font-heading text-h2 text-ink">{book.title}</h1>
          <p className="mt-1 text-body-lg text-charcoal">{book.author ?? 'Lexicon'}</p>

          <p className="mt-3 text-body-sm text-slate" data-testid="guest-preview-facts">
            {[
              book.cefrLevel ? `Уровень ${book.cefrLevel}` : null,
              book.cefrLevel ? LEVEL_NOTES[book.cefrLevel] ?? null : null,
              bookVolumeLabel(book.wordCount),
              lockedChaptersLabel(loaded.status === 'ok' ? loaded.chapter.totalChapters : null),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <p className="mt-3 max-w-measure text-body text-charcoal">{GUEST_BANNER_TEXT}</p>
        </section>

        {loaded.status === 'ok' ? (
          <div className="mt-6">
            <GuestReaderView slug={book.slug} chapter={loaded.chapter} isPreview />
          </div>
        ) : (
          /*
           * Скелетон/отказ вместо текста. Скелетон виден только когда бэкенд
           * не ответил; когда у книги ещё нет файла — это честная плашка, а не
           * мигающие полоски вечности.
           */
          <section className="card mt-6 p-5 sm:p-6" data-testid="guest-preview-notice">
            <h2 className="text-h3 text-ink">{notice?.title}</h2>
            <p className="mt-2 max-w-measure text-body text-charcoal">{notice?.body}</p>

            {notice?.title.includes('не отвечает') ? (
              <Skeleton className="mt-5 h-4 w-4/5" />
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Link
                href="/onboarding"
                className="btn-primary px-5 py-2.5 text-body"
                data-testid="guest-preview-notice-cta"
              >
                Читать с аккаунтом
              </Link>
              <Link
                href="/library"
                className="text-body-sm text-charcoal underline decoration-hairline-strong underline-offset-4"
              >
                Выбрать другую книгу
              </Link>
            </div>
          </section>
        )}
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
        <nav aria-label="Подвал" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-charcoal">
          <Link href="/library" className="underline decoration-hairline-strong underline-offset-4">
            Библиотека
          </Link>
          <Link href="/privacy" className="underline decoration-hairline-strong underline-offset-4">
            Конфиденциальность
          </Link>
        </nav>
        <Link href="/" className="text-body-sm text-charcoal">
          О сервисе
        </Link>
      </footer>
    </div>
  );
}
