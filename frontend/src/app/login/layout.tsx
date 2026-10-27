import type { Metadata } from 'next';

/*
 * Страница входа — клиентский компонент, поэтому метаданные объявлены здесь:
 * `export const metadata` в файле с 'use client' Next не принимает.
 * В индекс не попадает: это форма, а не контент, и доступ к ней всегда
 * остаётся по ссылке с главной.
 */
export const metadata: Metadata = {
  title: 'Вход',
  description:
    'Вход в Lexicon: книжная полка, списки слов и прогресс остаются там, где вы их оставили.',
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
