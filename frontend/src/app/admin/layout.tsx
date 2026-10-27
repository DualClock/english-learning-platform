import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  // Бренд дописывает title.template из src/app/layout.tsx
  title: 'Админка',
  // Раздел не для индексации: robots.txt тут не гарантия, а заголовок — да.
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '/admin/content/categories', label: 'Категории и слова' },
  { href: '/admin/content/articles', label: 'Статьи' },
  { href: '/admin/content', label: 'Книги' },
  { href: '/admin/feedback', label: 'Отзывы беты' },
];

/**
 * Оболочка админки.
 *
 * Доступ проверяет middleware (роль Admin в сессии NextAuth) — здесь только
 * навигация. Второй слой — сам бэкенд: любой запрос без роли отвечает 403,
 * поэтому даже если страница отрисуется, данные не придут.
 *
 * Здесь нет основного Sidebar приложения намеренно: админка — служебная зона,
 * и смешивать её с меню учёбы значит предлагать человеку «Диктант» посреди
 * правки словаря. Но из неё ОБЯЗАТЕЛЬНО должен быть выход обратно — иначе
 * админка выглядит тупиком.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      {/* Служебная полоса: тёмная, чтобы админку нельзя было спутать с
          пользовательскими экранами при открытых двух вкладках. */}
      <div className="border-b border-hairline bg-navy-deep text-on-dark">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-2.5">
          <span className="mr-3 inline-flex items-center gap-2 text-body-sm font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-caption font-bold">
              L
            </span>
            Админка
          </span>

          <nav className="flex flex-wrap gap-1" aria-label="Разделы админки">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1.5 text-body-sm text-on-dark-muted transition hover:bg-white/10 hover:text-on-dark"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Выход в приложение — обязателен: без него админка тупик. */}
          <Link
            href="/dashboard"
            className="ml-auto rounded-md px-2.5 py-1.5 text-body-sm text-on-dark-muted transition hover:bg-white/10 hover:text-on-dark"
          >
            ← В приложение
          </Link>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        {children}
      </div>
    </div>
  );
}
