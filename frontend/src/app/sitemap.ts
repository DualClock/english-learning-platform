import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/*
 * Только те URL, которые реально отдаются без JavaScript и доступны
 * неавторизованному краулеру. Всё остальное сюда добавлять нельзя:
 *
 *   /books        — клиентский раздел, без JS это спиннер «Проверяем сессию»,
 *                   а затем редирект на /login. Публичная витрина книг —
 *                   следующая задача (W2.2c): как только страница станет
 *                   серверной, её строку сюда добавляют вместе с /books/[slug].
 *   /test         — публичного placement-теста в репозитории ещё нет
 *                   (маршрут создаёт соседняя задача); до этого он 404'ит,
 *                   поэтому в sitemap его быть не может.
 *   /login, /onboarding, /forgot-password, /reset-password, /confirm-email,
 *   /admin, /dashboard и остальные приватные разделы — служебные, в индекс
 *                   им не место (см. robots.ts и X-Robots-Tag в middleware).
 */
const publicPaths: string[] = ['/'];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return publicPaths.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.8,
  }));
}
