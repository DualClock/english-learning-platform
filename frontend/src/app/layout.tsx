import type { Metadata, Viewport } from 'next';
import { Manrope, Inter, Literata } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { THEME_PREPAINT_SCRIPT } from '@/lib/theme';
import { siteUrl, siteName, siteDescription } from '@/lib/site';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-manrope',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

/*
 * Literata — наборный шрифт для длинного чтения: крупный овал, спокойные
 * засечки, кириллица. В интерфейсе остаются Manrope и Inter, поэтому
 * «книга» и «приложение» звучат по-разному.
 */
const literata = Literata({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-literata',
  display: 'swap',
});

/*
 * Боевой адрес сайта берётся из NEXT_PUBLIC_SITE_URL (фолбэки — в src/lib/site.ts).
 * От него metadataBase строит абсолютные URL для og:image и twitter:image:
 * с localhost превью в Telegram и VK остаются битыми, а каждый пост из
 * outreach-кита теряет клики.
 */
const description = siteDescription;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Lexicon — английский без зубрёжки',
    // Дочерние страницы объявляют title строкой и получают бренд в конце:
    // «Вход — Lexicon». Без шаблона все разделы наследовали бы заголовок
    // главной, и поисковик считал бы их дублями.
    template: '%s — Lexicon',
  },
  description,
  applicationName: siteName,
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName,
    url: siteUrl,
    title: 'Lexicon — английский без зубрёжки',
    description,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Lexi машет рукой рядом с надписью «Английский без зубрёжки»',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lexicon — английский без зубрёжки',
    description,
    images: ['/og.png'],
  },
  // Иконки (favicon, icon, apple-icon) Next подхватывает из src/app автоматически
  appleWebApp: {
    capable: true,
    title: 'Lexicon',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0E7C7B',
  width: 'device-width',
  initialScale: 1,
  // На телефонах с «челкой» фон заходит под системные панели
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ru"
      className={`${manrope.variable} ${inter.variable} ${literata.variable}`}
      // Скрипт до первой отрисовки ставит на <html> data-theme, которого React
      // на сервере не знает. Это единственный узел, где такое расхождение
      // намеренное, поэтому предупреждение гидрации глушим здесь, а не в токенах.
      suppressHydrationWarning
    >
      <head>
        {/*
          Тема применяется до первой отрисовки: без этого шага тёмный режим
          мигает светлым кадром, пока гидратируется React. Единственный случай,
          где inline-скрипт оправдан — см. lib/theme.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_PREPAINT_SCRIPT }} />
      </head>
      <body className="font-sans bg-surface text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
