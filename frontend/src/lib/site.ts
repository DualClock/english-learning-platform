/*
 * Единственный источник боевого адреса сайта для SEO-метаданных.
 *
 * Порядок приоритета:
 *   1. NEXT_PUBLIC_SITE_URL — боевой домен (https://lexicon.app и т. п.);
 *   2. NEXTAUTH_URL — адрес, который уже нужен NextAuth для callback'ов,
 *      чтобы превью ссылок не разъезжались с логином;
 *   3. http://localhost:3000 — локальная разработка.
 *
 * NEXT_PUBLIC_ префикс обязателен: metadataBase, sitemap.xml и robots.ts
 * собираются на сервере при генерации статики, а значения без префикса Next
 * в такие файлы не подставляет. Переменную задают в Vercel (см. DEPLOY.md);
 * без неё в HTML останется localhost, и превью в Telegram/VK будет битым.
 */
const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXTAUTH_URL ??
  'http://localhost:3000';

/** Базовый URL без завершающего слэша: `${siteUrl}/og.png` всегда склеивается. */
export const siteUrl = rawSiteUrl.replace(/\/+$/, '');

export const siteName = 'Lexicon';

export const siteDescription =
  'Читай, разбирай слова, тренируй грамматику, произношение и письмо. Lexicon возвращает пройденное в нужный момент.';
