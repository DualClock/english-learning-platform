import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';
import { bookHref } from '@/lib/library';
import { loadPublicCatalog } from '@/lib/library-catalog';

/*
 * Только те URL, которые реально отдаются без JavaScript и доступны
 * неавторизованному краулеру. Всё остальное сюда добавлять нельзя:
 *
 *   /books        — приватная библиотека пользователя: без JS это спиннер
 *                   «Проверяем сессию», а затем 307 на /login. Сюда она попасть
 *                   не может, и не должна: публичная витрина живёт на /library
 *                   (W2.2), а /books остаётся внутренним разделом.
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
 *
 * /beta (W3.3) — страница когорты: на неё ведут все письма и посты из
 * `docs/beta-launch/OUTREACH_KIT.md`, поэтому ей нужен и индекс, и прямая
 * ссылка для краулера. Это тоже серверная страница без авторизации: в matcher
 * приватных разделов её добавлять нельзя (проверено юнитом `beta.test.mjs`).
 */
/*
 * /library и страницы книг (W2.2) — здесь потому, что это первый контент
 * продукта, который открывается без сессии: серверный HTML, ни одного
 * клиентского fetch. Список строится из того же каталога, что и витрина
 * (src/lib/library-catalog.ts), поэтому адрес книги попадает в индекс ровно
 * тогда, когда он реально отдаёт 200, а не тогда, когда нам так захотелось.
 * Бэкенда под сборкой нет — каталог отдаёт зеркало сида, и его адреса сверены
 * с правилом бэкенда тестом.
 */
const publicPaths: string[] = ['/', '/test', '/library', '/beta', '/privacy', '/terms'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const { books } = await loadPublicCatalog();

  const sections: MetadataRoute.Sitemap = publicPaths.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    // Правовые страницы — не контент для чтения: они меняются редко, и
    // «weekly» для них значило бы, что мы зря гоняем краулер на пустой diff.
    changeFrequency: path === '/privacy' || path === '/terms' ? 'yearly' : 'weekly',
    // Когорта — страница с дедлайном: до старта она важнее почти всего, кроме
    // самой главной, и теряет смысл после 15 ноября.
    // /library — 0.8 наравне с /test: полка и тест уровня это две точки входа,
    // и понижать одну ради другой смысла нет.
    priority:
      path === '/'
        ? 1
        : path === '/test' || path === '/library'
          ? 0.8
          : path === '/beta'
            ? 0.7
            : 0.4,
  }));

  /*
   * Книги — leaf-контент: их читают, а не пересобирают, поэтому monthly, а
   * priority ниже полки (конкретную книгу находят и по ссылке из поста, и по
   * переходу с /library).
   */
  const bookPages: MetadataRoute.Sitemap = books.map((book) => ({
    url: `${siteUrl}${bookHref(book.slug)}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  return [...sections, ...bookPages];
}
