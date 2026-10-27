import type { Metadata } from 'next';
import Link from 'next/link';
import PlacementTest from '@/components/test/PlacementTest';
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger';
import LevelChip from '@/components/ui/LevelChip';
import { siteUrl, siteDescription } from '@/lib/site';

/*
 * Публичная страница теста уровня (W2.2a).
 *
 * Ссылка из Telegram, VK и Дзена должна вести на пользу, а не на «создай
 * аккаунт»: тест проходится гостем, сервер считает уровень анонимно
 * (`[AllowAnonymous]` в ProfileController), регистрация предлагается только
 * после результата. Поэтому страница существует на сервере: заголовок, шкала и
 * обещание видны в HTML до всякого JavaScript — краулер и превью в мессенджере
 * читают то же, что человек.
 */
export const metadata: Metadata = {
  title: 'Тест на уровень английского за 3 минуты',
  description:
    '16 вопросов от простых к сложным — бесплатная проверка уровня A1–C1 без регистрации. ' +
    'В конце: что этот уровень значит и какие книги из библиотеки Lexicon вам уже по силам.',
  alternates: { canonical: '/test' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: `${siteUrl}/test`,
    title: 'Тест на уровень английского за 3 минуты',
    description: siteDescription,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Lexi машет рукой рядом с надписью «Английский без зубрёжки»',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Тест на уровень английского за 3 минуты',
    description: siteDescription,
    images: ['/og.png'],
  },
};

/** Статичная шкала: человек выбирает глазами, а краулер находит текстом. */
const CEFR_SCALE = [
  { level: 'A1', caption: 'Отдельные слова и простые фразы' },
  { level: 'A2', caption: 'Бытовые диалоги и адаптированные тексты' },
  { level: 'B1', caption: 'Основная идея текста, разговор на знакомую тему' },
  { level: 'B2', caption: 'Оригинал почти без напряжения' },
  { level: 'C1', caption: 'Сложная проза, ирония, профессиональная лексика' },
];

export default function TestPage() {
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
            Бесплатно · без регистрации
          </p>
          <h1 className="mt-2 font-heading text-h1 text-ink">
            Тест на уровень английского за 3 минуты
          </h1>
          <p className="mt-3 max-w-measure text-body-lg text-slate">
            16 вопросов от простых к сложным: проверяем грамматику так, как она
            встречается в книгах. В конце — ваш уровень по шкале CEFR, человеческая
            расшифровка и полка текстов, которые на этом уровне уже читаются.
          </p>

          <div className="mt-7">
            <PlacementTest />
          </div>

          {/*
           * Вторая дверь, а не тупик (W3.3): человеку, которому не подходит
           * «сам, когда хочу», нужен формат с датой и компанией. Ссылка живёт в
           * серверном HTML рядом с CTA теста, а не только на экране результата,
           * куда ещё надо долистать 16 вопросов.
           */}
          <p className="mt-6 max-w-measure border-t border-hairline pt-5 text-body-sm text-slate">
            Хотите читать не в одиночку?{' '}
            <Link
              href="/beta"
              className="font-medium text-primary underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
            >
              Когорта Lexicon
            </Link>{' '}
            — 14 дней чтения по главе в день, старт 2 ноября, 80 мест и два коротких отзыва с
            вас.
          </p>
        </div>

        <section className="mt-10" aria-labelledby="test-scale-title">
          <h2 id="test-scale-title" className="text-h3 text-ink">
            Куда ведёт эта шкала
          </h2>
          <ul className="mt-3 space-y-2">
            {CEFR_SCALE.map((row) => (
              <li
                key={row.level}
                className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas px-4 py-3"
              >
                <LevelChip level={row.level} className="shrink-0" />
                <span className="min-w-0 text-body-sm text-charcoal">{row.caption}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-measure text-body-sm text-slate">
            Тест ничего не сохраняет: уровень считается по ответам и остаётся на этом
            экране. Сохранить его можно в профиле — тогда библиотека и слова на
            повторение подберутся под уровень автоматически.
          </p>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
        <Link
          href="/"
          className="text-body-sm text-charcoal underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
        >
          О Lexicon
        </Link>
        <FeedbackTrigger className="text-body-sm text-charcoal underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink">
          Отзыв
        </FeedbackTrigger>
      </footer>
    </div>
  );
}
