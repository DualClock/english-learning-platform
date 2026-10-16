import Link from 'next/link';

export function EmptyBooks() {
  return (
    <section className="mb-8">
      <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-8 text-center shadow-sm">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--color-tint-mint)] flex items-center justify-center">
          <svg className="w-8 h-8 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[var(--color-ink)] mb-2">Библиотека пока пуста</h2>
        <p className="text-[var(--color-slate)] mb-6 max-w-md mx-auto">
          Добавь первую книгу — и начинай читать на английском, сохраняя новые слова по пути.
        </p>
        <Link href="/books" className="btn-primary inline-flex items-center gap-2">
          Перейти в библиотеку
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </section>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-8 text-center shadow-sm">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#F5E8E8] flex items-center justify-center">
        <svg className="w-8 h-8 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-[var(--color-ink)] mb-2">Не удалось загрузить данные</h2>
      <p className="text-[var(--color-slate)] mb-6 max-w-md mx-auto">
        Что-то пошло не так при соединении с сервером. Проверь, что бэкенд запущен, и попробуй ещё раз.
      </p>
      <button onClick={onRetry} className="btn-primary">
        Попробовать снова
      </button>
    </div>
  );
}
