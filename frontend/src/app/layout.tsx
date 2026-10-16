import type { Metadata } from 'next';
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${manrope.variable} ${inter.variable}`}>
      <body className="font-sans bg-[#F7F5EF] text-[#20231F]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}