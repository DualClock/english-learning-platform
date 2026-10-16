import Link from 'next/link';
import HeroTranslationDemo from '@/components/HeroTranslationDemo';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#F7F5EF]">
      {/* Навигация */}
      <nav className="border-b border-[#D6D3CC]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-[#20231F]">
            Lexicon
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/login" className="text-[#5A5F5A] hover:text-[#20231F] transition-colors">
              Войти
            </Link>
            <Link href="/onboarding" className="btn-primary text-sm">
              Начать бесплатно
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — не шаблонный, а книжный */}
      <section className="py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 mb-6">
                <span className="w-2 h-2 rounded-full bg-[#356B52]"></span>
                <span className="text-sm font-medium text-[#356B52]">
                  Для взрослых, которые читают
                </span>
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-[#20231F] leading-tight mb-6">
                Учи английский<br />
                через <span className="text-[#356B52]">книги</span>,<br />
                а не учебники
              </h1>
              
              <p className="text-lg text-[#5A5F5A] mb-8 max-w-md">
                Читай настоящую литературу, нажимай на незнакомые слова — 
                ИИ переведёт их с учётом контекста, а система сама подстроит 
                повторения под твою память.
              </p>
              
              <div className="flex flex-wrap gap-4">
                <Link href="/onboarding" className="btn-primary">
                  Начать читать
                </Link>
                <Link href="/login" className="btn-secondary">
                  У меня есть аккаунт
                </Link>
              </div>

              {/* Социальное доказательство — не числа, а атмосфера */}
              <div className="mt-12 flex items-center gap-4 text-sm text-[#5A5F5A]">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="w-8 h-8 rounded-full bg-[#E7ECE4] border-2 border-[#F7F5EF] flex items-center justify-center text-xs font-medium">
                      {['А', 'М', 'К'][i-1]}
                    </div>
                  ))}
                </div>
                <span>Читают вместе с нами</span>
              </div>
            </div>

            {/* Визуал — живое демо ИИ-перевода */}
            <div className="relative">
              <HeroTranslationDemo />

              {/* Декоративный элемент — закладка */}
              <div className="absolute -right-4 top-8 w-8 h-24 bg-[#C4A77D] rounded-r-lg hidden md:block"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Как это работает — не 3 карточки, а процесс */}
      <section className="py-20 bg-white border-y border-[#D6D3CC]">
        <div className="max-w-6xl mx-auto px-6">
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
                <span className="text-6xl font-bold text-[#E7ECE4] absolute -top-4 -left-2">
                  {item.step}
                </span>
                <div className="relative pt-8">
                  <h3 className="text-xl font-semibold text-[#20231F] mb-3">
                    {item.title}
                  </h3>
                  <p className="text-[#5A5F5A] leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Библиотека — показываем реальные книги */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="section-title">Начни с классики</h2>
              <p className="text-[#5A5F5A]">Бесплатно, легально, без рекламы</p>
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
                {/* Обложка-заглушка в стиле Switch-Lit */}
                <div className="aspect-[3/4] rounded-lg mb-3 flex items-center justify-center text-4xl font-bold text-[#C4A77D] bg-gradient-to-br from-[#E7ECE4] to-[#D6D3CC]">
                  {book.title.charAt(0)}
                </div>
                <h3 className="font-semibold text-[#20231F] text-sm mb-1 truncate">
                  {book.title}
                </h3>
                <p className="text-xs text-[#5A5F5A] mb-2">{book.author}</p>
                <span className="badge badge-primary text-xs">{book.level}</span>
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

      {/* CTA — не агрессивный, но ясный */}
      <section className="py-20 bg-[#356B52] text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Первая книга — бесплатно
          </h2>
          <p className="text-[#E7ECE4] text-lg mb-8 max-w-xl mx-auto">
            Не нужна карта. Не нужен опыт. Просто открой первую главу 
            и начни читать как на русском.
          </p>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 bg-white text-[#356B52] px-8 py-4 rounded-lg font-semibold hover:bg-[#E7ECE4] transition-colors"
          >
            Создать аккаунт
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Футер — минималистичный */}
      <footer className="py-12 border-t border-[#D6D3CC]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <span className="text-[#5A5F5A] text-sm">
              © 2026 Lexicon. Читай. Учи. Помни.
            </span>
            <a
              href="mailto:hello@lexicon.app"
              className="text-sm text-[#5A5F5A] hover:text-[#20231F]"
            >
              hello@lexicon.app
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}