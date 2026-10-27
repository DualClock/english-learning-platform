import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

export const metadata = {
  robots: { index: false, follow: false },
  title: 'Reader Lab',
};

// Проверка окружения должна выполняться на запросе, а не на этапе сборки:
// иначе тестовая страница остаётся статически доступной в продакшене.
export const dynamic = 'force-dynamic';

/**
 * Лаборатория постраничной вёрстки существует только для разработки.
 * В продакшене маршрут отвечает 404, чтобы тестовый текст не попал на сайт.
 */
export default function ReaderLabLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return children;
}
