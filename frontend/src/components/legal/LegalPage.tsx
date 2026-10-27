import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * Оболочка правовых страниц (/privacy, /terms).
 *
 * Те же требования, что у /test (W2.2a): страница серверная, текст лежит в
 * HTML до всякого JavaScript — человек открывает ссылку из письма или из
 * футера лендинга и сразу читает документ, а краулер и превью в мессенджере
 * видят то же, что и он. Отдельный файл, а не копия разметки в каждой
 * странице, потому что шапка и подвал у юридических документов обязаны
 * совпадать: расхождение в двух ссылках — и у домена появляется страница
 * «политика», которой нет в меню.
 */
export default function LegalPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ground-warm text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="font-heading text-h3 font-bold text-ink">
          Lexicon
        </Link>
        <Link
          href="/login"
          className="text-body-sm text-charcoal transition-colors duration-fast ease-soft hover:text-ink"
        >
          Войти
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <div className="card p-5 sm:p-8">
          <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">
            {eyebrow}
          </p>
          <h1 className="mt-2 font-heading text-h1 text-ink">{title}</h1>
          <p className="mt-3 max-w-measure text-body-lg text-slate">{lead}</p>
        </div>

        <div className="mt-8 space-y-10">{children}</div>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-charcoal">
          <Link
            href="/privacy"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Конфиденциальность
          </Link>
          <Link
            href="/terms"
            className="underline decoration-hairline-strong underline-offset-4 hover:text-ink"
          >
            Правила беты
          </Link>
          <Link
            href="/"
            className="underline decoration-hairline-strong underline-offset-4 hover:text-ink"
          >
            О Lexicon
          </Link>
        </nav>
        <a
          href="mailto:hello@lexicon.app"
          className="text-body-sm text-charcoal underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
        >
          hello@lexicon.app
        </a>
      </footer>
    </div>
  );
}

/**
 * Одна секция документа: заголовок + сколько угодно абзацев и списков.
 * Держимся плоской иерархии — юридические тексты читают с телефона, и
 * вложенные карточки превращают «что вы делаете с моими данными» в кашу.
 */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-h3 text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-body text-charcoal">{children}</div>
    </section>
  );
}

/** Маркированный список с короткими пунктами — «что храним», «чего не делаем». */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-primary">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Заполнитель, который обязан закрыть владелец перед публичным запуском
 * (реквизиты, юрисдикция хостинга). Видный на странице, а не в комментарии:
 * спрятать в код — значит через месяц не найти, что именно не заполнено.
 */
export function LegalTodo({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-hairline-strong bg-canvas px-3 py-2 text-caption text-slate">
      {children}
    </p>
  );
}
