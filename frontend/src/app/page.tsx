import Link from 'next/link';
import type { Metadata } from 'next';
import ReaderDemo from '@/components/landing/ReaderDemo';
import SkillsGrid from '@/components/landing/SkillsGrid';
import { Reveal, RevealGroup, RevealItem } from '@/components/landing/Reveal';
import LandingFooter from '@/components/landing/LandingFooter';
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger';
import LevelChip from '@/components/ui/LevelChip';
import { ArrowRightIcon, CheckIcon } from '@/components/ui/icons';
import { siteUrl, siteDescription } from '@/lib/site';
import { LIBRARY_PATH, bookHref, slugFromTitle } from '@/lib/library';
import { loadPublicCatalog } from '@/lib/library-catalog';
import BookCover from '@/components/library/BookCover';

/*
 * canonical на чистый адрес: ссылка-код /t/<код> ведёт на /?ref=<код>, и без
 * canonical Яндекс склеивает десятки дублей главной с разными ref/utm.
 * absolute — чтобы на главной бренд остался в начале заголовка, как в OG.
 */
export const metadata: Metadata = {
  title: { absolute: 'Lexicon — английский без зубрёжки' },
  description: siteDescription,
  alternates: { canonical: siteUrl },
};

const HEADLINE_LINES = ['Английский', 'без зубрёжки'];

const REASSURANCE = [
  'Классика и свои EPUB',
  'Слова возвращаются сами',
  'Прогресс в одном месте',
];

/** Книга на полке главной: минимум полей, который нужен карточке с обложкой. */
interface FeaturedBook {
  title: string;
  author: string | null;
  level: string | null;
  slug: string;
  coverUrl: string | null;
}

const BOOKS = [
  { title: 'The Lost Kitten', author: 'Lexicon Stories', level: 'A1' },
  { title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll', level: 'A2' },
  { title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', level: 'B1' },
  // Уровень Moby-Dick — C1, как в сиде PopularBooksService: раньше карточка
  // обещала B1, и клик вёл на страницу, которая противоречит ссылке, с которой
  // человек пришёл.
  { title: 'Moby-Dick', author: 'Herman Melville', level: 'C1' },
];

export default async function HomePage() {
  /*
   * Четыре классики для полки на главной — из того же каталога, что и витрина:
   * слаг и обложку считает бэкенд, а при его недоступности срабатывает зеркало
   * сида. Порядок — по возрастанию уровня, чтобы полка читалась как «с чего
   * начать». Если каталог пуст (сборка без бэкенда и без сида), остаются
   * заголовки из BOOKS — без обложек, но с рабочими ссылками.
   */
  const catalog = await loadPublicCatalog();
  const featured: FeaturedBook[] =
    catalog.books.filter((book) => book.kind === 'classic').length > 0
      ? catalog.books
          .filter((book) => book.kind === 'classic')
          .sort((a, b) => (a.cefrLevel ?? 'ZZ').localeCompare(b.cefrLevel ?? 'ZZ'))
          .slice(0, 4)
          .map((book) => ({
            title: book.title,
            author: book.author,
            level: book.cefrLevel,
            slug: book.slug,
            coverUrl: book.coverUrl,
          }))
      : BOOKS.map((book) => ({
          title: book.title,
          author: book.author,
          level: book.level,
          slug: slugFromTitle(book.title),
          coverUrl: null,
        }));

  return (
    <div className="bg-canvas text-ink">
      <div className="bg-ground-warm">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-5 sm:px-6">
          <Link href="/" className="font-heading text-h3 font-bold text-ink">
            Lexicon
          </Link>

          <nav className="hidden items-center gap-8 text-body-sm text-charcoal md:flex">
            {/*
             * Когорта (W3.3) — адрес, на который ведут все письма и посты
             * аутрича. В шапке он рядом с «Возможностями», потому что решение
             * «идти или нет» человек принимает до того, как дочитает лендинг.
             */}
            <Link href="/beta" className="transition-colors duration-fast ease-soft hover:text-ink">
              Когорта
            </Link>
            <a href="#skills" className="transition-colors duration-fast ease-soft hover:text-ink">
              Возможности
            </a>
            <a href="#library" className="transition-colors duration-fast ease-soft hover:text-ink">
              Библиотека
            </a>
            <FeedbackTrigger className="transition-colors duration-fast ease-soft hover:text-ink">
              Отзыв
            </FeedbackTrigger>
          </nav>

          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-body-sm text-charcoal transition-colors duration-fast ease-soft hover:text-ink"
            >
              Войти
            </Link>
            <Link href="/onboarding" className="btn-primary px-4 py-2">
              Начать
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:pb-24">
          <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-7">
              <h1 className="font-heading text-hero text-ink">
                {HEADLINE_LINES.map((line) => (
                  <span key={line} className="mask-line">
                    <span>{line}</span>
                  </span>
                ))}
              </h1>

              <p className="mask-after mt-7 max-w-measure-sm text-body-lg text-charcoal">
                Читай, разбирай грамматику и тренируй письмо. Lexicon помнит, что ты учил, и
                возвращает слова в нужный момент.
              </p>

              <div className="mask-after mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href="/onboarding" className="btn-primary px-6 py-3 text-body">
                  Начать бесплатно
                  <ArrowRightIcon size={20} aria-hidden />
                </Link>
                {/*
                 * Точка входа для холодного трафика (W2.2a): тест уровня — то, что
                 * человек готов сделать без аккаунта. Ссылка из Telegram, VK и Дзена
                 * ведёт сюда, а не на регистрацию.
                 */}
                <Link href="/test" className="btn-secondary px-6 py-3 text-body">
                  Проверить уровень за 3 минуты
                </Link>
                <span className="text-body-sm text-charcoal">Без карты</span>
              </div>
            </div>

            <div className="animate-rise-in lg:col-span-5">
              <ReaderDemo />
            </div>
          </div>

          <div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 text-body-sm text-charcoal">
            {REASSURANCE.map((item) => (
              <span key={item} className="flex items-center gap-2">
                <CheckIcon size={16} className="text-primary" aria-hidden />
                {item}
              </span>
            ))}
          </div>
        </section>
      </div>

      <SkillsGrid />

      <section id="library" className="bg-tint-teal">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-12 lg:gap-8">
          <Reveal className="lg:col-span-5">
            <h2 className="text-h1 text-ink">Классика, с которой легко начать</h2>
            <p className="mt-4 max-w-measure-sm text-body-lg text-charcoal">
              Четыре книги уже в библиотеке. Или загрузи свою EPUB и читай в том же ритме: слово за
              словом, глава за главой.
            </p>
            <Link
              href={LIBRARY_PATH}
              className="mt-8 inline-flex items-center gap-2 text-body-sm font-medium text-ink underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:decoration-primary"
            >
              Вся библиотека
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
          </Reveal>

          {/*
           * Обложки вместо списка строк.
           *
           * Раньше здесь стоял список из четырёх названий с уровнем и стрелкой:
           * он читался как оглавление или прайс-лист, а не как полка книг, —
           * хотя обложки у этих книг уже есть в каталоге и на витрине /library.
           * Данные берём из того же источника, что и витрина (с фолбэком на
           * зеркало сида, если бэкенд недоступен при сборке).
           */}
          <RevealGroup className="lg:col-span-7">
            <ul className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              {featured.map((book) => (
                <RevealItem key={book.title}>
                  <li>
                    <Link
                      href={bookHref(book.slug)}
                      className="group flex h-full flex-col"
                    >
                      <BookCover
                        title={book.title}
                        coverUrl={book.coverUrl ?? undefined}
                        className="aspect-book w-full"
                      />
                      <span className="mt-2.5 flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block line-clamp-2 text-body-sm font-semibold leading-snug text-ink transition-colors duration-fast ease-soft group-hover:text-primary">
                            {book.title}
                          </span>
                          <span className="mt-0.5 block truncate text-caption text-charcoal">
                            {book.author ?? '—'}
                          </span>
                        </span>
                        <LevelChip level={book.level ?? undefined} />
                      </span>
                    </Link>
                  </li>
                </RevealItem>
              ))}
            </ul>
          </RevealGroup>
        </div>
      </section>

      <section className="bg-navy text-on-dark">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <Reveal>
            <h2 className="text-display text-on-dark">Начни с одного слова</h2>
            <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <p className="max-w-measure text-body-lg text-on-dark-muted">
                Открой первую главу, нажми на незнакомое слово и посмотри, как оно вернётся
                завтра. Без карты и расписания.
              </p>
              <div className="flex flex-wrap items-center gap-6">
                <Link href="/onboarding" className="btn-on-dark px-6 py-3 text-body">
                  Создать аккаунт
                  <ArrowRightIcon size={20} aria-hidden />
                </Link>
                <Link
                  href="/login"
                  className="text-body-sm text-on-dark underline decoration-on-dark-muted underline-offset-4 transition-colors duration-fast ease-soft hover:decoration-on-dark"
                >
                  У меня есть аккаунт
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/*
       * Футер-сториборд продолжает тёмную секцию: тот же navy, чернила on-dark,
       * а ссылки и правовые страницы остаются на месте — только теперь в
       * колонках и нижней строке рисунка.
       */}
      <LandingFooter />
    </div>
  );
}
