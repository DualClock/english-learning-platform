import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

export const metadata = {
  robots: { index: false, follow: false },
  title: 'UI Lab',
};

// Проверка окружения должна выполняться на запросе, а не на этапе сборки:
// иначе тестовая страница остаётся статически доступной в продакшене.
export const dynamic = 'force-dynamic';

/**
 * Витрина компонентов дизайн-системы. Нужна, чтобы новый компонент можно было
 * посмотреть в живом окружении до того, как он попадёт на продуктовую страницу.
 * В продакшене маршрут отвечает 404.
 */
export default function UiLabLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return children;
}
