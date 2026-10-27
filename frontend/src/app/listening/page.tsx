import type { Metadata } from 'next';
import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import { loadListeningStories } from '@/lib/listening-stories';
import ListeningPlayer, { type ListeningStory } from './ListeningPlayer';

/*
 * Аудирование как отдельное упражнение, а не реэкспорт квиза.
 *
 * До этого файла маршрут был одной строкой `export { default } from '../quiz/page'`:
 * «Аудирование» открывало тест по одному слову — человек слышал слово и выбирал
 * перевод. Связного текста там не было вовсе, то есть главный навык (понимать
 * речь на слух) не тренировался.
 *
 * Теперь страница — серверная обёртка: рассказы приходят из сида прямо в первом
 * HTML, без клиентского fetch и без скелетона. Сам плеер клиентский, потому что
 * звук, тайминги и localStorage живут только в браузере.
 *
 * Почему рассказы из сида, а не из /api/books/stories: тот эндпоинт требует
 * подтверждённой почты и отдаёт лишь метаданные (title, level, обложка) — текста
 * абзацев в нём нет, а без текста подсвечивать нечего. Сид читается тем же
 * каталогом, что и StorySeeder на бэкенде, поэтому список не может разойтись.
 */

export const metadata: Metadata = {
  title: 'Аудирование — рассказы на слух | Lexicon',
  description:
    'Аудирование английского на рассказах A1–B1: связный текст, подсветка звучащего предложения, ' +
    'скорость 0.75–1.25 и перемотка кликом по предложению.',
};

// Страница зависит от сессии (AppLayout), так что статический рендер ей не
// подходит; сид при этом читается на каждый запрос — он маленький.
export const dynamic = 'force-dynamic';

export default async function ListeningPage() {
  const stories: ListeningStory[] = await loadListeningStories();

  return (
    <AppLayout>
      <PageHeader
        title="Аудирование"
        subtitle="Слушайте рассказ целиком: звучащее предложение подсвечено, темп можно замедлить, а клик по предложению перематывает к нему."
      />

      <div className="mt-6">
        <ListeningPlayer stories={stories} />
      </div>
    </AppLayout>
  );
}
