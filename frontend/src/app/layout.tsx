import type { Metadata, Viewport } from 'next';
import { Manrope, Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';

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
  title: 'Lexicon — Учи английский через книги',
  description: 'Платформа для изучения английского языка через чтение книг и интеллектуальные повторения',
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
    <html lang="ru" className={`${manrope.variable} ${inter.variable}`}>
      <body className="font-sans bg-[var(--color-surface)] text-[var(--color-ink)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
