export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Левая панель — бренд и мотивация (скрыта на мобильных) */}
      <aside className="hidden lg:flex w-[45%] xl:w-1/2 bg-navy text-white flex-col justify-between p-12">
        <div>
          <span className="text-2xl font-semibold font-heading">Lexicon</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl xl:text-4xl font-semibold text-white leading-tight mb-4">
            Учи английский через книги, а не учебники
          </h2>
          <p className="text-on-dark-muted text-lg leading-relaxed">
            Читай настоящую литературу, нажимай на незнакомые слова —
            ИИ переведёт с учётом контекста, а повторения подстроятся под твою память.
          </p>
          <ul className="mt-8 space-y-3 text-on-dark-muted">
            {['Классика в public domain и свои EPUB', 'Контекстный перевод одним нажатием', 'Умные интервалы повторения (SM-2)'].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-on-dark-muted">Читай. Учи. Помни.</p>
      </aside>

      {/* Правая панель — форма */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 bg-surface">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <span className="text-2xl font-semibold text-ink font-heading">Lexicon</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
