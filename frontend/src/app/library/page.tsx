import type { Metadata } from 'next';
import Link from 'next/link';
import { API_URL } from '@/app/lib/api-url';
import PageView from '@/components/analytics/PageView';
import BookCover from '@/components/library/BookCover';
import Button from '@/components/ui/Button';
import LevelChip from '@/components/ui/LevelChip';
import { ArrowRightIcon, BookOpenIcon } from '@/components/ui/icons';
import { siteDescription, siteUrl } from '@/lib/site';
import { pluralBooks } from '@/lib/plural';
import {
  LEVEL_NOTES,
  bookHref,
  bookVolumeLabel,
  groupByLevel,
  resolveCoverSrc,
  sortCatalog,
} from '@/lib/library';
import { loadPublicCatalog } from '@/lib/library-catalog';

/*
 * Публичная витрина книг (W2.2) — ответ на главный пробел SEO-аудита: у
 * конкретной книги не было адреса, который открывается без сессии. /books —
 * клиентский раздел, и краулер (и человек из поста в Telegram) получал там
 * спиннер «Проверяем сессию», а затем 307 на /login.
 *
 * Три свойства, которые нельзя потерять при правках:
 *
 *   1. Это серверный компонент: полка лежит в HTML до JavaScript. Ни одного
 *      клиентского fetch, ни одного `initial={{ opacity: 0 }}` — ровно та
 *      причина, по которой на лендинге H2 ниже сгиба не индексировались.
 *   2. Источник данных не виден посетителю. Когда бэкенда нет под сборкой,
 *      loadPublicCatalog отдаёт зеркало сида (source: 'seed'), и страница
 *      обязана выглядеть так же: ни слов про «кэш», «API», «зеркало», ни
 *      отдельной плашки. Чего зеркало не знает — того просто нет (объём и
 *      обложка классики), выдумывать цифры страница не имеет права.
 *   3. Обложка — BookCover, а не голый <img>: он умеет URL без привязки к
 *      сессии (это просто картинка с Open Library или со статистики бэкенда) и
 *      дорисовывает инициалы вместо битого пикселя. Картинка попадает в HTML
 *      на сервере, alt = название книги, поэтому индексация не зависит от JS.
 */
export const metadata: Metadata = {
  title: 'Библиотека: классика и рассказы по уровням CEFR',
  description:
    'Открытая полка Lexicon: публичная классика и градированные рассказы, разложенные по уровням ' +
    'CEFR от A1 до C2. Уровень подписан человеческим языком, аккаунт для просмотра не нужен.',
  alternates: { canonical: '/library' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: `${siteUrl}/library`,
    title: 'Библиотека Lexicon: классика и рассказы по уровням CEFR',
    description: siteDescription,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Lexi читает книгу',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Библиотека Lexicon: классика и рассказы по уровням CEFR',
    description: siteDescription,
    images: ['/og.png'],
  },
};

/**
 * Формат книги — не украшение строки: «публичное достояние» и «наш рассказ»
 * отвечают на разные вопросы (можно ли читать чужим детям / насколько текст
 * адаптирован), и посетитель выбирает именно по этому признаку.
 */
const KIND_LABEL: Record<'classic' | 'story', string> = {
  classic: 'Публичное достояние',
  story: 'Градированный рассказ',
};

export default async function LibraryPage() {
  /*
   * Единственное место, где страница заглядывает наружу, — серверный вызов
   * loadPublicCatalog. Он не бросает никогда: живой каталог либо пришёл, либо
   * отдаём зеркало сида, поэтому SSR-страница не падает из-за недоступного API.
   */
  const { books } = await loadPublicCatalog();

  /*
   * groupByLevel сам расставляет книги по шкале (sortCatalog внутри), поэтому
   * порядок полок и порядок внутри полки идут от одного правила — того же, по
   * которому каталог собирает бэкенд. sortCatalog здесь нужен для «точки
   * входа»: первый элемент отсортированного каталога = самая лёгкая книга
   * полки, её и предлагаем тому, кто пришёл прямо с /test.
   */
  const groups = groupByLevel(books);
  const easiest = sortCatalog(books)[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-ground-warm text-ink">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="font-heading text-h3 font-bold text-ink">
          Lexicon
        </Link>
        <nav aria-label="Разделы" className="flex items-center gap-6 text-body-sm text-charcoal">
          <Link
            href="/test"
            className="transition-colors duration-fast ease-soft hover:text-ink"
          >
            Тест уровня
          </Link>
          <Link href="/login" className="transition-colors duration-fast ease-soft hover:text-ink">
            Войти
          </Link>
        </nav>
      </header>

      {/*
       * Верх воронки (W3.4): полка — вторая входная дверь после /beta, и она
       * тоже была неизмерима. Страницы конкретных книг (`/library/[slug]`)
       * намеренно НЕ подключены: 18 SSG-страниц под один счётчик, который
       * сегодня на что не оптимизирует, а slug в теле события был бы тем самым
       * свободным текстом, который контракт запрещает.
       */}
      <PageView surface="library" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
        <section className="card p-5 sm:p-8">
          <h1 className="font-heading text-h1 text-ink">Библиотека Lexicon</h1>
          <p className="mt-3 max-w-measure text-body-lg text-slate">
            Публичная классика и наши градированные рассказы — одной полкой, от A1 до C2. Читать
            можно без регистрации: уровень, объём и начало текста видны сразу, а в читалку с
            переводом слова по клику вы попадёте, когда создадите аккаунт.
          </p>

          {easiest ? (
            <p className="mt-4 max-w-measure text-body text-charcoal">
              Не уверены в уровне? Начните с <LevelChip level={easiest.cefrLevel} /> —{' '}
              <Link
                href={bookHref(easiest.slug)}
                className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-primary"
              >
                «{easiest.title}»
              </Link>{' '}
              это самая лёгкая книга полки.
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button href="/onboarding" className="px-6 py-3 text-body">
              Читать бесплатно
              <ArrowRightIcon size={20} aria-hidden />
            </Button>
            <Button href="/test" variant="secondary" className="px-6 py-3 text-body">
              Проверить уровень за 3 минуты
            </Button>
          </div>
        </section>

        {books.length === 0 ? (
          /*
           * Сегодня этот случай недостижим (зеркало сида не пустое), но пустая
           * витрина обязана оставаться честной страницей, а не белым экраном:
           * краулер, пришедший на пустой ответ, не должен увидеть битую полку.
           */
          <div className="card mt-8 p-5 sm:p-6">
            <p className="text-body text-charcoal">
              Полка сейчас пуста — книги добавляются вручную, и следующая партия уже в работе.
              Загляните позже или пройдите тест уровня, чтобы выбрать формат.
            </p>
          </div>
        ) : (
          groups.map((group, groupIndex) => {
            /*
             * Подпись уровня — из LEVEL_NOTES, то есть теми же словами, что
             * человек видел на /test. Для полки «Без уровня» подписи нет, и
             * это правильно: придумывать объяснение чужому уровню мы не можем.
             *
             * id секции — по номеру полки, а не из названия уровня: «Без
             * уровня» содержит кириллицу и пробел, а aria-labelledby обязан
             * ссылаться на валидный идентификатор.
             */
            const note = LEVEL_NOTES[group.level] ?? null;
            const headingId = `shelf-${groupIndex + 1}`;
            const levelCount = group.books.length;

            return (
              <section
                key={group.level}
                aria-labelledby={headingId}
                className="mt-10"
                data-level={note ? group.level : undefined}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id={headingId} className="font-heading text-h2 text-ink">
                    {group.level}
                  </h2>
                  {note ? <span className="text-body-sm text-slate">{note}</span> : null}
                  <span className="text-caption uppercase tracking-wide text-slate">
                    {levelCount} {pluralBooks(levelCount)}
                  </span>
                </div>

                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {group.books.map((book) => {
                    const cover = resolveCoverSrc(book.coverUrl, API_URL);
                    const volume = bookVolumeLabel(book.wordCount);

                    return (
                      <li key={book.slug}>
                        <article
                          className="card h-full gap-4 p-4 sm:p-5"
                          data-level={book.cefrLevel ?? undefined}
                          data-volume={book.wordCount ?? undefined}
                          data-kind={book.kind}
                        >
                          <div className="flex gap-4">
                            <BookCover
                              title={book.title}
                              coverUrl={cover ?? undefined}
                              className="aspect-book w-16 shrink-0"
                              size="sm"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <LevelChip level={book.cefrLevel} />
                                <span className="text-caption uppercase tracking-wide text-slate">
                                  {KIND_LABEL[book.kind]}
                                </span>
                              </div>

                              <h3 className="mt-1 text-h3 text-ink">
                                <Link
                                  href={bookHref(book.slug)}
                                  className="transition-colors duration-fast ease-soft hover:text-primary"
                                >
                                  {book.title}
                                </Link>
                              </h3>

                              <p className="mt-0.5 text-body-sm text-charcoal">
                                {book.author ?? 'Lexicon'}
                              </p>

                              {book.description ? (
                                <p className="mt-2 line-clamp-2 text-body-sm text-slate">
                                  {book.description}
                                </p>
                              ) : null}

                              {volume ? (
                                <p className="mt-2 text-caption text-slate">{volume}</p>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}

        <section aria-labelledby="library-cta" className="card mt-10 p-5 sm:p-6">
          <h2 id="library-cta" className="text-h3 text-ink">
            Своей книгой в этой полке?
          </h2>
          <p className="mt-2 max-w-measure text-body text-charcoal">
            Загрузите свой EPUB — он откроется в той же читалке: клик по слову даёт перевод, слово
            уходит в словарь и возвращается на повторение само. Публичной витриной ваша книга не
            становится: туда попадают только те тексты, которые мы сами выложили как public domain.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button href="/onboarding" className="px-6 py-3 text-body">
              <BookOpenIcon size={20} aria-hidden />
              Создать аккаунт
            </Button>
            <Link
              href="/beta"
              className="text-body-sm text-charcoal underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
            >
              Или вступите в когорту чтения
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
        <nav
          aria-label="Подвал"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-charcoal"
        >
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
          <Link
            href="/"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            О сервисе
          </Link>
        </nav>
        <Link href="/test" className="text-body-sm text-charcoal transition-colors duration-fast ease-soft hover:text-ink">
          Пройти тест уровня
        </Link>
      </footer>
    </div>
  );
}
