import { pluralize } from './utils';

interface Props {
  dictCount: number | null;
  reviewCount: number;
  booksCount: number;
  totalXp?: number | null;
}

export default function StatsRow({ dictCount, reviewCount, booksCount, totalXp }: Props) {
  const stats = [
    ...(dictCount !== null
      ? [
          {
            value: dictCount,
            label: pluralize(dictCount, 'слово', 'слова', 'слов') + ' в словаре',
            icon: (
              <svg className="w-5 h-5 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            ),
          },
        ]
      : []),
    {
      value: reviewCount,
      label: pluralize(reviewCount, 'слово', 'слова', 'слов') + ' на повторении',
      icon: (
        <svg className="w-5 h-5 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
    },
    {
      value: booksCount,
      label: pluralize(booksCount, 'книга', 'книги', 'книг') + ' в работе',
      icon: (
        <svg className="w-5 h-5 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      ),
    },
    ...(totalXp !== null && totalXp !== undefined
      ? [
          {
            value: totalXp,
            label: 'баллов набрано',
            icon: (
              <svg className="w-5 h-5 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.966a1 1 0 00.95.69h4.175c.969 0 1.371 1.24.588 1.81l-3.376 2.455a1 1 0 00-.364 1.118l1.287 3.966c.3.922-.755 1.688-1.539 1.118l-3.377-2.455a1 1 0 00-1.175 0l-3.377 2.455c-.783.57-1.838-.196-1.538-1.118l1.286-3.966a1 1 0 00-.363-1.118L4.81 9.393c-.783-.57-.38-1.81.588-1.81h4.175a1 1 0 00.95-.69l1.286-3.966z" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      {stats.map((stat, i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5 flex items-center gap-4 shadow-sm"
        >
          <div className="w-11 h-11 rounded-xl bg-[var(--color-tint-mint)] flex items-center justify-center shrink-0">
            {stat.icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--color-ink)] leading-tight">{stat.value}</p>
            <p className="text-sm text-[var(--color-slate)]">{stat.label}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
