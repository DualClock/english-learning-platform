import type { Metadata } from 'next';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Notice from '@/components/ui/Notice';
import { CardInteractive } from '@/components/ui/Card';
import { ArrowRightIcon, BookOpenIcon } from '@/components/ui/icons';
import { siteDescription, siteUrl } from '@/lib/site';
import { plural } from '@/lib/plural';
import { articlePublicPath, formatArticleDate } from '@/lib/articles';
import {
  loadArticleFeed,
  loadArticleSections,
  type ArticleListItem,
  type ArticleSection,
} from '@/lib/articles-feed.server';

/*
 * Публичная лента статей — раздел, который открывается без сессии.
 *
 * Три свойства, которые нельзя потерять при правках:
 *
 *   1. Это серверный компонент: заголовки и анонсы лежат в HTML до JavaScript.
 *      Клиентский fetch дал бы краулеру спиннер и пустой <title> — ровно то,
 *      из-за чего /books не индексируется, а витрина живёт на /library.
 *   2. /articles нет в matcher'е middleware: гейт по куке стоит только на
 *      приватных префиксах. Добавить его туда — значит закрыть раздел для
 *      краулера и для гостя, ради которого он и сделан.
 *   3. API недоступен — страница говорит об этом одной строкой и остаётся
 *      рабочей. Врать «пока нет статей» нельзя: это разные состояния.
 */

export const metadata: Metadata = {
  title: 'Статьи об английском: разборы, правила и практика',
  description:
    'Статьи Lexicon: разбор грамматики человеческим языком, подборки выражений и практические ' +
    'советы по чтению и словарю. Читать можно без аккаунта.',
  alternates: { canonical: '/articles' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: `${siteUrl}/articles`,
    title: 'Статьи об английском: разборы, правила и практика',
    description: siteDescription,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Lexicon' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Статьи об английском: разборы, правила и практика',
    description: siteDescription,
    images: ['/og.png'],
  },
};

/** Сколько статей на страницу. Совпадает с ARTICLE_PAGE_SIZE на сервере. */
const PAGE_SIZE = 20;

interface ArticlesPageProps {
  searchParams: { section?: string | string[]; page?: string | string[] };
}

/** Первое значение параметра; массив приходит при повторе ключа в адресе. */
function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}

function pageParam(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/** Адрес ленты с текущим разделом. Раздел в адресе — простая строка, без события. */
function sectionHref(slug: string | null): string {
  return slug ? `/articles?section=${encodeURIComponent(slug)}` : '/articles';
}

export default async function ArticlesPage({ searchParams }: ArticlesPageProps) {
  const section = firstParam(searchParams.section).trim();
  const page = pageParam(firstParam(searchParams.page));

  const [sections, feed] = await Promise.all([
    loadArticleSections(),
    loadArticleFeed({ section: section || null, page, pageSize: PAGE_SIZE }).catch((error) => {
      console.warn(
        '[articles] лента недоступна:',
        error instanceof Error ? error.message : error
      );
      return null;
    }),
  ]);

  const activeSection: ArticleSection | undefined = section
    ? sections.find((item) => item.slug === section)
    : undefined;
  const items: ArticleListItem[] = feed?.items ?? [];
  const totalPages = feed ? Math.max(1, Math.ceil(feed.total / Math.max(1, feed.pageSize))) : 1;

  return (
    <div className="flex min-h-screen flex-col bg-ground-warm text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="font-heading text-h3 font-bold text-ink">
          Lexicon
        </Link>
        <div className="flex items-center gap-4 text-body-sm text-charcoal">
          <Link
            href="/library"
            className="transition-colors duration-fast ease-soft hover:text-ink"
          >
            Библиотека
          </Link>
          <Link href="/login" className="transition-colors duration-fast ease-soft hover:text-ink">
            Войти
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <div className="card p-5 sm:p-8">
          <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">
            Статьи
          </p>
          <h1 className="mt-2 font-heading text-h1 text-ink">
            {activeSection ? activeSection.name : 'Разборы и практика английского'}
          </h1>
          <p className="mt-3 max-w-measure text-body-lg text-slate">
            {activeSection?.description ??
              'Грамматика человеческим языком, выражения и чтение: статьи открыты без аккаунта — читайте с телефона по дороге.'}
          </p>
        </div>

        {sections.length > 0 && (
          <nav aria-label="Разделы статей" className="mt-6 flex flex-wrap gap-2">
            <SectionChip href={sectionHref(null)} active={!activeSection}>
              Все разделы
            </SectionChip>
            {sections.map((item) => (
              <SectionChip
                key={item.id}
                href={sectionHref(item.slug)}
                active={activeSection?.slug === item.slug}
              >
                {item.name}
              </SectionChip>
            ))}
          </nav>
        )}

        <section className="mt-6" aria-labelledby="articles-list">
          <h2 id="articles-list" className="sr-only">
            Список статей
          </h2>

          {feed === null && (
            <Notice tone="danger">
              <p>Статьи сейчас не загрузились. Обновите страницу через минуту — текст не потерялся.</p>
            </Notice>
          )}

          {feed !== null && items.length === 0 && (
            <EmptyState
              icon={<BookOpenIcon size={24} />}
              title={activeSection ? 'В этом разделе пока пусто' : 'Статьи скоро появятся'}
              description={
                activeSection
                  ? 'Выберите другой раздел — остальные тексты уже на месте.'
                  : 'Первый разбор выйдет на этой неделе. Пока можно почитать классику в библиотеке.'
              }
              action={
                activeSection ? (
                  <Button href="/articles" variant="secondary">
                    Все статьи
                  </Button>
                ) : (
                  <Button href="/library">Открыть библиотеку</Button>
                )
              }
            />
          )}

          {items.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {items.map((item) => (
                <li key={item.id}>
                  <CardInteractive
                    href={articlePublicPath(item.slug)}
                    ariaLabel={`Статья «${item.title}»`}
                    className="flex h-full flex-col p-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-steel">
                      {item.sectionName && <span className="text-primary">{item.sectionName}</span>}
                      {item.sectionName && item.publishedAt && <span aria-hidden>·</span>}
                      {item.publishedAt && (
                        <time dateTime={item.publishedAt}>{formatArticleDate(item.publishedAt)}</time>
                      )}
                    </div>
                    <h3 className="mt-2 text-h3 text-ink">{item.title}</h3>
                    {item.summary && (
                      <p className="mt-2 line-clamp-3 text-body-sm text-slate">{item.summary}</p>
                    )}
                    <span className="mt-auto flex items-center gap-1 pt-4 text-body-sm font-medium text-primary">
                      Читать
                      <ArrowRightIcon size={16} aria-hidden />
                    </span>
                  </CardInteractive>
                </li>
              ))}
            </ul>
          )}

          {feed !== null && feed.total > 0 && (
            <p className="mt-4 text-caption text-slate">
              {feed.total} {plural(feed.total, ['статья', 'статьи', 'статей'])}
              {totalPages > 1 && ` · страница ${feed.page} из ${totalPages}`}
            </p>
          )}

          {totalPages > 1 && (
            <nav aria-label="Страницы ленты" className="mt-4 flex items-center gap-3">
              {page > 1 && (
                <Button
                  variant="secondary"
                  href={`${sectionHref(section || null)}${section ? '&' : '?'}page=${page - 1}`}
                >
                  ← Раньше
                </Button>
              )}
              {page < totalPages && (
                <Button
                  variant="secondary"
                  href={`${sectionHref(section || null)}${section ? '&' : '?'}page=${page + 1}`}
                >
                  Дальше →
                </Button>
              )}
            </nav>
          )}
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
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
            Правила
          </Link>
          <Link
            href="/test"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Тест уровня
          </Link>
        </nav>
      </footer>
    </div>
  );
}

/** Плашка раздела. Активная — тёмная, чтобы выбор читался без цвета акцента. */
function SectionChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full border px-3 py-1.5 text-body-sm transition-colors duration-fast ease-soft ${
        active
          ? 'border-navy-deep bg-navy-deep text-on-dark'
          : 'border-hairline bg-canvas text-charcoal hover:border-hairline-strong hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
