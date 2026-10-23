import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/*
 * robots.txt для Яндекса и Google. Disallow — это про обход, а не про индекс:
 * URL всё равно может попасть в выдачу по внешним ссылкам. Индекс закрывают
 * `robots: { index: false }` в метаданных служебных страниц (см. layout.tsx
 * рядом с каждой страницей) и заголовок X-Robots-Tag из src/middleware.ts
 * для приватных разделов.
 *
 * Список префиксов = всё, что закрыто за логином или не является контентом.
 * Публичные / и /test сюда не попадают намеренно.
 */
const DISALLOWED = [
  '/api/',
  '/admin/',
  '/reader/',
  '/dashboard/',
  '/settings/',
  '/profile/',
  '/dictionary/',
  '/progress/',
  '/review/',
  '/practice/',
  '/quiz/',
  '/writing/',
  '/listening/',
  '/translator/',
  '/grammar/',
  '/categories/',
  '/confirm-email',
  '/reset-password',
  '/forgot-password',
  // служебные страницы без контента
  '/offline',
  '/manifest.webmanifest',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
