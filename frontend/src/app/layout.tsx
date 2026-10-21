import type { Metadata, Viewport } from 'next';
import { Manrope, Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { THEME_PREPAINT_SCRIPT } from '@/lib/theme';

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

export const metadata: Metadata = {
  title: 'Lexicon — английский без зубрёжки',
  description:
    'Читай, разбирай слова, тренируй грамматику, произношение и письмо. Lexicon возвращает пройденное в нужный момент.',
  applicationName: 'Lexicon',
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
      className={`${manrope.variable} ${inter.variable}`}
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
