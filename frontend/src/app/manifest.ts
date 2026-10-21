import type { MetadataRoute } from 'next';

// Манифест установки: Next отдаёт его по /manifest.webmanifest
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Lexicon — английский без зубрёжки',
    short_name: 'Lexicon',
    description:
      'Чтение, словарь с повторениями, грамматика, произношение и письмо — в одной платформе.',
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F6F7F9',
    theme_color: '#0E7C7B',
    categories: ['education', 'books'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Повторить слова', url: '/review' },
      { name: 'Словарь', url: '/dictionary' },
      { name: 'Библиотека', url: '/books' },
    ],
  };
}
