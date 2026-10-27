import FeedbackTrigger from '@/components/feedback/FeedbackTrigger';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Левая панель — бренд и мотивация (скрыта на мобильных) */}
      <aside className="hidden w-1/2 flex-col justify-between bg-navy p-12 text-on-dark lg:flex">
        <div>
          <span className="font-heading text-h2">Lexicon</span>
        </div>
        <div className="max-w-measure">
          <h2 className="mb-4 text-h1 leading-tight">Учи английский через книги, а не учебники</h2>
          <p className="text-body-lg leading-relaxed text-on-dark-muted">
            Читай настоящую литературу, нажимай на незнакомые слова — ИИ переведёт с учётом
            контекста, а повторения подстроятся под твою память.
          </p>
          <ul className="mt-8 space-y-3 text-body text-on-dark-muted">
            {[
              'Классика в public domain и свои EPUB',
              'Контекстный перевод одним нажатием',
              'Умные интервалы повторения (SM-2)',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-caption text-on-dark-muted">Читай. Учи. Помни.</p>
      </aside>

      {/* Правая панель — форма */}
      <main className="flex flex-1 items-center justify-center bg-surface p-4 sm:p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <span className="font-heading text-h2 text-ink">Lexicon</span>
          </div>
          {children}
          <div className="mt-6 text-center">
            <FeedbackTrigger className="text-caption text-slate underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink">
              Оставить отзыв о бете
            </FeedbackTrigger>
          </div>
        </div>
      </main>
    </div>
  );
}
