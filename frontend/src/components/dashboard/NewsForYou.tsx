'use client';

import { useMemo } from 'react';
import Card from '@/components/ui/Card';
import LevelChip from '@/components/ui/LevelChip';
import { ClockIcon } from '@/components/ui/icons';
import { useApiQuery } from '@/app/lib/use-api';
import {
  MAX_NEWS,
  formatNewsDate,
  isSafeSourceUrl,
  newsFeedPath,
  selectNews,
  shouldShowNews,
  sourceHost,
  type NewsItem,
} from '@/lib/news.ts';

/*
 * «Новости для тебя» — блок на дашборде, ровно под «Планом на сегодня».
 *
 * Почему без состояния ошибки и без скелетона. Блок — добавка, а не рабочий
 * виджет: он не отвечает ни за одно действие, которое человек собирался
 * сделать. Скелетон на его месте мигал бы при каждом входе, а плашка «новости
 * не загрузились» просила бы нажать «повторить» ради того, что открывается
 * в любом браузере одной вкладкой. Пока данных нет или их нет вовсе — блока
 * нет. Ошибка не гасит остальной дашборд, потому что это отдельный запрос.
 *
 * Почему фильтрация повторена на клиенте. Сервер отдаёт те же пять и по тем же
 * интересам, но фильтр живёт в параллельной ветке бэкенда. Проверка в
 * `selectNews` держит блок корректным, даже если ручка пока отдаёт всё подряд
 * или кэш ответил ответом другой версии API.
 */

/** Интересы пользователя в том виде, в котором их отдаёт профиль. */
interface InterestsResponse {
  interests?: string[];
}

function NewsCard({ item }: { item: NewsItem }) {
  const host = sourceHost(item.sourceUrl);
  const date = formatNewsDate(item.publishedAt);
  const meta = [item.sourceName?.trim() || host, date].filter(Boolean).join(' · ');
  const hasLink = isSafeSourceUrl(item.sourceUrl);

  return (
    <Card
      as="article"
      className="flex h-full flex-col p-4 transition-colors duration-fast ease-soft hover:border-hairline-strong"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-body-sm font-semibold leading-snug text-ink">{item.title}</h3>
        {/* Уровень — плашкой того же ряда, что в библиотеке: одна рампа на весь продукт. */}
        <LevelChip level={item.level} className="shrink-0" />
      </div>

      {item.summary?.trim() && (
        <p className="mb-3 line-clamp-2 text-caption leading-snug text-slate">{item.summary}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-caption text-steel">
          <ClockIcon size={16} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{meta}</span>
        </span>

        {hasLink && (
          /*
           * target="_blank" без rel="noopener noreferrer" отдаёт сайту
           * источник ссылку на window.opener — вкладка-источник управляет
           * нашей страницей. noreferrer здесь ещё и лишний аргумент в пользу
           * первоисточника: он не узнаёт, с какой страницы пришёл читатель.
           */
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-caption font-medium text-primary underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Читать в источнике
          </a>
        )}
      </div>
    </Card>
  );
}

export default function NewsForYou() {
  /*
   * Два запроса, а не один: список новостей и интересы профиля приходят из
   * разных ручек. Пока интересы не пришли, новости просим без фильтра —
   * `selectNews` с пустым набором отдаёт самый свежий микс, и блок не ждёт
   * второй запрос, чтобы появиться.
   */
  const interestsQuery = useApiQuery<InterestsResponse>('/api/next/interests');
  const interests = useMemo(() => interestsQuery.data?.interests ?? [], [interestsQuery.data]);

  /*
   * Уровень берём из профиля: лента должна подбираться под читателя, иначе
   * человек на A1 получит C1-текст, который бросит через строку.
   *
   * Пока профиль грузится, level = null — сервер отдаст смесь уровней. Это
   * честнее пустого блока на секунду.
   */
  const profileQuery = useApiQuery<{ cefrLevel: string | null }>('/api/profile');
  const level = profileQuery.data?.cefrLevel ?? null;

  /*
   * Новости идут прямым адресом API (`/api/news/for-me`), а не через
   * `/api/next`: маршрут публичный, и прокси не нужен. Интересы сервер берёт
   * из профиля сам — передавать их в адресе значило бы позволить клиенту
   * назвать чужие темы.
   */
  const newsQuery = useApiQuery<NewsItem[] | { items: NewsItem[] }>(newsFeedPath(level));

  const items = useMemo(() => selectNews(newsQuery.data, interests), [newsQuery.data, interests]);

  if (!shouldShowNews(items)) return null;

  const shown = items.slice(0, MAX_NEWS);

  return (
    <section className="mb-8" aria-label="Новости для тебя">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <div>
          <h2 className="text-h3 text-ink">Новости для тебя</h2>
          <p className="mt-1 text-body-sm text-slate">
            Короткие тексты по вашим темам — с уровнем рядом с заголовком
          </p>
        </div>
        {interests.length > 0 && (
          <span className="text-caption text-steel">По вашим интересам</span>
        )}
      </div>

      {/* Пять карточек: сетка 2 колонки на широком экране, 1 — на узком. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
