import Link from 'next/link';
import type { Metadata } from 'next';
import ReaderDemo from '@/components/landing/ReaderDemo';
import SkillsGrid from '@/components/landing/SkillsGrid';
import { Reveal, RevealGroup, RevealItem } from '@/components/landing/Reveal';
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger';
import LevelChip from '@/components/ui/LevelChip';
import { ArrowRightIcon, CheckIcon } from '@/components/ui/icons';
import { siteUrl, siteDescription } from '@/lib/site';
import { LIBRARY_PATH, bookHref, slugFromTitle } from '@/lib/library';

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

const BOOKS = [
  { title: 'The Lost Kitten', author: 'Lexicon Stories', level: 'A1' },
  { title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll', level: 'A2' },
  { title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', level: 'B1' },
  // Уровень Moby-Dick — C1, как в сиде PopularBooksService: раньше карточка
  // обещала B1, и клик вёл на страницу, которая противоречит ссылке, с которой
  // человек пришёл.
  { title: 'Moby-Dick', author: 'Herman Melville', level: 'C1' },
];

export default function HomePage() {
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

          <RevealGroup className="lg:col-span-7">
            {BOOKS.map((book) => (
              <RevealItem key={book.title}>
                <Link
                  href={bookHref(slugFromTitle(book.title))}
                  className="group -mx-4 flex items-center justify-between gap-4 rounded-lg px-4 py-4 transition-colors duration-fast ease-soft hover:bg-canvas"
                >
                  <span className="min-w-0">
                    <span className="block text-h2 text-ink transition-colors duration-fast ease-soft group-hover:text-primary">
                      {book.title}
                    </span>
                    <span className="mt-1 block text-body-sm text-charcoal">{book.author}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <LevelChip level={book.level} />
                    <ArrowRightIcon
                      size={16}
                      className="hidden text-primary sm:block"
                      aria-hidden
                    />
                  </span>
                </Link>
              </RevealItem>
            ))}
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

        <footer className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-heading text-h1 text-on-dark">Lexicon</p>
              <a
                href="mailto:hello@lexicon.app"
                className="mt-3 inline-block text-body-sm text-on-dark-muted underline decoration-on-dark-muted underline-offset-4 transition-colors duration-fast ease-soft hover:text-on-dark"
              >
                hello@lexicon.app
              </a>
            </div>
            <nav className="flex flex-wrap gap-x-8 gap-y-2 text-body-sm text-on-dark-muted">
              <Link
                href="/beta"
                className="transition-colors duration-fast ease-soft hover:text-on-dark"
              >
                Когорта
              </Link>
              <a href="#skills" className="transition-colors duration-fast ease-soft hover:text-on-dark">
                Возможности
              </a>
              <a href="#library" className="transition-colors duration-fast ease-soft hover:text-on-dark">
                Библиотека
              </a>
              <FeedbackTrigger className="transition-colors duration-fast ease-soft hover:text-on-dark">
                Обратная связь
              </FeedbackTrigger>
              {/*
               * Правовые страницы (W2.5.1/W2.5.2) должны быть видны до
               * регистрации: человек приводит в бету свою группу и хочет
               * прочитать «что с данными», не заводя аккаунт. Ссылки в
               * футере — единственное место, где их ищут краулер и человек.
               */}
              <Link
                href="/privacy"
                className="transition-colors duration-fast ease-soft hover:text-on-dark"
              >
                Конфиденциальность
              </Link>
              <Link
                href="/terms"
                className="transition-colors duration-fast ease-soft hover:text-on-dark"
              >
                Правила беты
              </Link>
              <Link href="/login" className="transition-colors duration-fast ease-soft hover:text-on-dark">
                Войти
              </Link>
            </nav>
          </div>
          <p className="mt-12 text-caption text-on-dark-muted">
            © 2026 Lexicon. Читай. Учи. Помни.
          </p>
        </footer>
      </section>
    </div>
  );
}
