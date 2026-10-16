import Link from 'next/link';

const actions = [
  {
    href: '/books',
    title: 'Библиотека',
    subtitle: 'Все книги',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    href: '/dictionary',
    title: 'Словарь',
    subtitle: 'Твои слова',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 8h10M7 12h6m-6 4h8M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
      </svg>
    ),
  },
  {
    href: '/quiz',
    title: 'Тест',
    subtitle: 'Проверить знания',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/translator',
    title: 'AI Собеседник',
    subtitle: 'Поговорить по-английски',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
      </svg>
    ),
  },
];

export default function QuickActions() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-4">Быстрые действия</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-4 hover:border-[var(--color-primary)] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--color-tint-mint)] text-[var(--color-primary)] flex items-center justify-center mb-3 group-hover:bg-[var(--color-primary)] group-hover:text-white transition-colors duration-200">
              {action.icon}
            </div>
            <h3 className="font-medium text-[var(--color-ink)]">{action.title}</h3>
            <p className="text-sm text-[var(--color-slate)] mt-0.5">{action.subtitle}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
