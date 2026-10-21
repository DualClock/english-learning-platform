import Link from 'next/link';
import HeroStatement from '@/components/HeroStatement';
import HeroTranslationDemo from '@/components/HeroTranslationDemo';
import { ArrowRightIcon } from '@/components/ui/icons';

const STEPS = [
  {
    title: 'Выбери книгу',
    desc: 'Классика в public domain или загрузи свою EPUB. От Алисы в Стране чудес до Моби Дика.',
    start: 'md:col-start-1',
  },
  {
    title: 'Читай и нажимай',
    desc: 'Не знаешь слово — просто нажми на него. AI переведёт с учётом контекста и добавит примеры.',
    start: 'md:col-start-4',
  },
  {
    title: 'Повторяй умно',
    desc: 'Алгоритм SM-2 подстроит интервалы повторений под твою память. Забыл — вернёт. Помнишь — отложит.',
    start: 'md:col-start-7',
  },
];

const BOOKS = [
  { title: 'Pride and Prejudice', author: 'Jane Austen', level: 'B2' },
  { title: 'Alice in Wonderland', author: 'Lewis Carroll', level: 'A2' },
  { title: 'Sherlock Holmes', author: 'Conan Doyle', level: 'B1' },
  { title: 'Frankenstein', author: 'Mary Shelley', level: 'B2' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Верхняя строка: слово и два перехода. Отдельной панели с линией нет. */}
      <header className="mx-auto flex max-w-6xl items-baseline justify-between px-4 py-6 sm:px-6">
        <Link href="/" className="text-body-sm font-semibold text-ink font-heading">
          Lexicon
        </Link>
        <div className="flex items-baseline gap-6">
          <Link
            href="/login"
            className="text-body-sm text-slate hover:text-ink transition-colors duration-fast ease-soft"
          >
            Войти
          </Link>
          <Link
            href="/onboarding"
            className="text-body-sm text-ink underline decoration-hairline-strong underline-offset-4 hover:decoration-primary transition-colors duration-fast ease-soft"
          >
            Начать бесплатно
          </Link>
        </div>
      </header>

      {/* Заявление и живое демо читалки — единственная «фотография» страницы */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 md:pt-16">
        <HeroStatement />
        <div data-ui className="animate-rise-in mt-20 rounded-lg bg-surface p-6 sm:p-10">
          <HeroTranslationDemo />
        </div>
      </section>

      {/* Порядок шагов: лесенка строк, каждая начинается правее предыдущей */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h2 className="text-h1 text-ink">Как это работает</h2>
          <p className="text-body-sm text-slate">Три шага к свободному чтению</p>
        </div>

        <div className="stagger mt-14 grid grid-cols-1 gap-14 md:grid-cols-12">
          {STEPS.map((step) => (
            <div key={step.title} className={`md:col-span-5 ${step.start}`}>
              <h3 className="text-h1 text-ink">{step.title}</h3>
              <p className="mt-3 max-w-measure text-body text-charcoal">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Библиотека: список названий крупным кеглем, без рисованных обложек */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h2 className="text-h1 text-ink">Начни с классики</h2>
          <p className="text-body-sm text-slate">Бесплатно, легально, без рекламы</p>
        </div>

        <div className="stagger mt-12">
          {BOOKS.map((book) => (
            <Link
              key={book.title}
              href="/books"
              className="group grid grid-cols-1 items-baseline gap-x-8 gap-y-1 py-3 md:grid-cols-12"
            >
              <span className="text-h2 text-ink transition-colors duration-fast ease-soft group-hover:text-primary md:col-span-7">
                {book.title}
              </span>
              <span className="text-body-sm text-slate md:col-span-3">{book.author}</span>
              <span className="text-body-sm text-slate md:col-span-2 md:text-right">
                {book.level}
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-10">
          <Link href="/books" className="btn-secondary">
            Вся библиотека
            <ArrowRightIcon size={16} />
          </Link>
        </div>
      </section>

      {/* Закрытие: тот же переворот цвета, что открывает страницу */}
      <section className="mt-20 bg-navy text-on-dark">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
          <h2 className="max-w-measure text-display">Первая книга — бесплатно</h2>
          <div className="mt-16 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <p className="max-w-measure text-body-lg text-on-dark-muted">
              Не нужна карта. Не нужен опыт. Просто открой первую главу
              и начни читать как на русском.
            </p>
            <Link href="/onboarding" className="btn-primary shrink-0 self-start md:self-auto">
              Создать аккаунт
              <ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="text-h1 font-heading text-ink">Lexicon</p>
            <a
              href="mailto:hello@lexicon.app"
              className="mt-4 inline-block text-body-sm text-slate underline decoration-hairline-strong underline-offset-4 hover:text-ink hover:decoration-primary transition-colors duration-fast ease-soft"
            >
              hello@lexicon.app
            </a>
          </div>
          <p className="text-caption text-slate">© 2026 Lexicon. Читай. Учи. Помни.</p>
        </div>
      </footer>
    </div>
  );
}
