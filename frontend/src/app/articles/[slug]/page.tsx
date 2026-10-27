import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Button from '@/components/ui/Button';
import { ArrowLeftIcon } from '@/components/ui/icons';
import { siteUrl } from '@/lib/site';
import { formatArticleDate } from '@/lib/articles';
import { loadArticle } from '@/lib/articles-feed.server';

/*
 * Страница статьи.
 *
 * Тело приходит с сервера готовым HTML (bodyMarkdown → HTML на бэкенде), и
 * разметку здесь никто не собирает: вставка через dangerouslySetInnerHTML —
 * единственный честный способ показать уже отрендеренный markdown, а
 * доверие к строке опирается на то, что сервер её санитизировал. Своя
 * мини-реализация markdown в компоненте была бы и лишней, и опасной.
 *
 * Статьи нет или она снята с публикации — notFound(): 404 честнее пустой
 * страницы с заголовком «undefined».
 */

interface ArticlePageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const article = await loadArticle(params.slug);
  if (!article) {
    return { title: 'Статья не найдена', robots: { index: false, follow: false } };
  }

  return {
    title: article.title,
    description: article.summary ?? undefined,
    alternates: { canonical: `/articles/${article.slug}` },
    openGraph: {
      type: 'article',
      locale: 'ru_RU',
      url: `${siteUrl}/articles/${article.slug}`,
      title: article.title,
      description: article.summary ?? undefined,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: article.title }],
    },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const article = await loadArticle(params.slug);
  if (!article) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-ground-warm text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="font-heading text-h3 font-bold text-ink">
          Lexicon
        </Link>
        <div className="flex items-center gap-4 text-body-sm text-charcoal">
          <Link href="/articles" className="transition-colors duration-fast ease-soft hover:text-ink">
            Все статьи
          </Link>
          <Link href="/login" className="transition-colors duration-fast ease-soft hover:text-ink">
            Войти
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <article className="card p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-steel">
            {article.sectionName &&
              (article.sectionSlug ? (
                <Link
                  href={`/articles?section=${encodeURIComponent(article.sectionSlug)}`}
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {article.sectionName}
                </Link>
              ) : (
                <span className="font-semibold text-primary">{article.sectionName}</span>
              ))}
            {article.publishedAt && (
              <>
                {article.sectionName && <span aria-hidden>·</span>}
                <time dateTime={article.publishedAt}>{formatArticleDate(article.publishedAt)}</time>
              </>
            )}
          </div>

          <h1 className="mt-2 font-heading text-h1 text-ink">{article.title}</h1>
          {article.summary && (
            <p className="mt-3 max-w-measure text-body-lg text-slate">{article.summary}</p>
          )}

          {/*
           * theory-text — тот же стиль набора, что у теории грамматики: он уже
           * описывает p/h2/ul/code/blockquote/a и живёт в globals.css. Второй
           * набор правил для статей разъехался бы с ним на первой правке.
           */}
          <div
            className="theory-text mt-6 max-w-measure"
            // Разметку собрал и санитизировал сервер — см. комментарий в шапке файла.
            dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
          />
        </article>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button href="/articles" variant="secondary">
            <ArrowLeftIcon size={16} aria-hidden />
            Все статьи
          </Button>
          <Button href="/library">Читать книгу</Button>
        </div>
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
        </nav>
      </footer>
    </div>
  );
}
