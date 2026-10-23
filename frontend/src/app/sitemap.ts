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
 *   /login, /onboarding, /forgot-password, /reset-password, /confirm-email,
 *   /admin, /dashboard и остальные приватные разделы — служебные, в индекс
 *                   им не место (см. robots.ts и X-Robots-Tag в middleware).
 *
 * /test — публичный тест уровня (W2.2a): серверная страница, гостевой контент,
 * в matcher приватных разделов не входит. Точка входа для ссылок из Telegram,
 * VK и Дзена, поэтому в sitemap обязан быть: именно он говорит краулеру, что
 * страница живая.
 *
 * /privacy и /terms (W2.5) — здесь по той же причине, что и /test: их ищут не
 * люди внутри продукта, а человек снаружи, который решает, можно ли доверить
 * сервису свою почту и свою группу. Молодому домену полезно, чтобы робот
 * заходил на них напрямую, а не только по ссылке из футера. Ссылки в футере
 * лендинга при этом остаются: индекс — это про краулера, ссылка — про читателя.
 */
const publicPaths: string[] = ['/', '/test', '/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return publicPaths.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    // Правовые страницы — не контент для чтения: они меняются редко, и
    // «weekly» для них значило бы, что мы зря гоняем краулер на пустой diff.
    changeFrequency: path === '/privacy' || path === '/terms' ? 'yearly' : 'weekly',
    priority: path === '/' ? 1 : path === '/test' ? 0.8 : 0.4,
  }));
}
