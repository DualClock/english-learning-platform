import Link from 'next/link';
import HeroTranslationDemo from '@/components/HeroTranslationDemo';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Навигация */}
      <nav className="sticky top-0 z-40 bg-canvas border-b border-hairline">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-xl font-semibold text-ink font-heading">
            Lexicon
          </Link>
          <div className="flex items-center gap-3 sm:gap-6">
            <Link href="/login" className="text-sm text-slate hover:text-ink transition-colors">
              Войти
            </Link>
            <Link href="/onboarding" className="btn-primary">
              Начать бесплатно
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — тёмный бэнд с живым демо */}
      <section className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 md:pt-24 md:pb-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 mb-6">
                <span className="w-2 h-2 rounded-full bg-primary"></span>
                <span className="text-sm font-medium text-on-dark-muted">
                  Для взрослых, которые читают
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-white leading-tight mb-6">
                Учи английский<br />
                через <span className="text-[#5EEAD4]">книги</span>,<br />
                а не учебники
              </h1>

              <p className="text-lg text-on-dark-muted mb-8 max-w-md">
                Читай настоящую литературу, нажимай на незнакомые слова —
                ИИ переведёт их с учётом контекста, а система сама подстроит
                повторения под твою память.
              </p>

              <div className="flex flex-wrap gap-4">
                <Link href="/onboarding" className="btn-primary">
                  Начать читать
                </Link>
                <Link href="/login" className="btn-secondary-on-dark">
                  У меня есть аккаунт
                </Link>
              </div>

              {/* Социальное доказательство — не числа, а атмосфера */}
              <div className="mt-12 flex items-center gap-4 text-sm text-on-dark-muted">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="w-8 h-8 rounded-full bg-navy-deep border-2 border-navy flex items-center justify-center text-xs font-medium text-on-dark-muted">
                      {['А', 'М', 'К'][i-1]}
                    </div>
                  ))}
                </div>
                <span>Читают вместе с нами</span>
              </div>
            </div>

            {/* Визуал — живое демо ИИ-перевода */}
            <div className="relative">
              <div className="bg-canvas rounded-lg shadow-modal overflow-hidden">
                <HeroTranslationDemo />
              </div>

              {/* Декоративный элемент — закладка */}
              <div className="absolute -right-4 top-8 w-8 h-24 bg-primary rounded-r-lg hidden md:block" aria-hidden="true"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Как это работает — не 3 карточки, а процесс */}
      <section className="py-16 md:py-24 bg-canvas">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="section-title text-center">Как это работает</h2>
          <p className="section-subtitle text-center">Три шага к свободному чтению</p>

          <div className="grid md:grid-cols-3 gap-8 mt-12">
            {[
              {
                step: '01',
                title: 'Выбери книгу',
                desc: 'Классика в public domain или загрузи свою EPUB. От Алисы в Стране чудес до Моби Дика.'
              },
              {
                step: '02',
                title: 'Читай и нажимай',
                desc: 'Не знаешь слово — просто нажми на него. AI переведёт с учётом контекста и добавит примеры.'
              },
              {
                step: '03',
                title: 'Повторяй умно',
                desc: 'Алгоритм SM-2 подстроит интервалы повторений под твою память. Забыл — вернёт. Помнишь — отложит.'
              }
            ].map((item) => (
              <div key={item.step} className="relative">
                <span className="text-6xl font-semibold text-hairline-soft absolute -top-4 -left-2" aria-hidden="true">
                  {item.step}
                </span>
                <div className="relative pt-8">
                  <h3 className="text-xl font-semibold text-ink mb-3">
                    {item.title}
                  </h3>
                  <p className="text-slate leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Библиотека — показываем реальные книги */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="section-title">Начни с классики</h2>
              <p className="text-slate">Бесплатно, легально, без рекламы</p>
            </div>
            <Link href="/books" className="btn-ghost hidden md:inline-flex">
              Вся библиотека →
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { title: 'Pride and Prejudice', author: 'Jane Austen', level: 'B2' },
              { title: 'Alice in Wonderland', author: 'Lewis Carroll', level: 'A2' },
              { title: 'Sherlock Holmes', author: 'Conan Doyle', level: 'B1' },
              { title: 'Frankenstein', author: 'Mary Shelley', level: 'B2' },
            ].map((book) => (
              <div key={book.title} className="card-interactive p-4">
                {/* Обложка-заглушка */}
                <div className="aspect-[3/4] rounded-md mb-3 flex items-center justify-center text-4xl font-semibold text-primary bg-gradient-to-br from-tint-sky to-tint-lavender">
                  {book.title.charAt(0)}
                </div>
                <h3 className="font-semibold text-ink text-sm mb-1 truncate">
                  {book.title}
                </h3>
                <p className="text-xs text-steel mb-2">{book.author}</p>
                <span className="badge-tag-green">{book.level}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center md:hidden">
            <Link href="/books" className="btn-secondary">
              Вся библиотека
            </Link>
          </div>
        </div>
      </section>

      {/* CTA — спокойный, но ясный */}
      <section className="py-16 md:py-24 bg-primary-deep text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-semibold text-white mb-4">
            Первая книга — бесплатно
          </h2>
          <p className="text-on-dark-muted text-lg mb-8 max-w-xl mx-auto">
            Не нужна карта. Не нужен опыт. Просто открой первую главу
            и начни читать как на русском.
          </p>
          <Link
            href="/onboarding"
            className="btn-on-dark px-8 py-3.5 text-base font-semibold"
          >
            Создать аккаунт
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Футер — минималистичный */}
      <footer className="py-12 bg-canvas border-t border-hairline">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <span className="text-steel text-sm">
              © 2026 Lexicon. Читай. Учи. Помни.
            </span>
            <a
              href="mailto:hello@lexicon.app"
              className="text-sm text-steel hover:text-ink transition-colors"
            >
              hello@lexicon.app
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
