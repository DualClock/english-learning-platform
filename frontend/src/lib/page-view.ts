/*
 * Чистая логика замера верха воронки для публичных витрин (W3.4).
 *
 * /beta и /library рендерятся на сервере и раньше не измерялись вовсе: в
 * воронке `/api/analytics/acquisition` человек появлялся только в момент
 * регистрации, поэтому про «увидел когорту → вступил» нельзя было сказать
 * ничего. Здесь лежит ровно то, что можно проверить без браузера: какое имя
 * события соответствует поверхности, и как не отправить второе.
 *
 * Чего здесь сознательно нет:
 *  - slug книги, query, referer, user-agent — сервер принимает контракт из двух
 *    полей `{event, dedupeKey}`, и любое из этого перечня стало бы свободным
 *    текстом в анонимной таблице (см. AnonymousAnalyticsController);
 *  - «уникальных людей» и cookie-идентификатора: считаем просмотры, а не
 *    посетителей; сопоставить два просмотра одного человека между сессиями
 *    нечем, потому что суточная соль IpHash меняет хеш на следующих сутках.
 */

/** Поверхности, которые умеем мерить. Расширяется только вместе с whitelist сервера. */
export const PAGE_VIEW_SURFACES = ['cohort', 'library'] as const;

export type PageViewSurface = (typeof PAGE_VIEW_SURFACES)[number];

/** Имена событий верха воронки — подмножество `GuestEvent` из `app/lib/analytics.ts`. */
export type PageViewEvent = 'cohort_page_viewed' | 'library_page_viewed';

/**
 * Имя события для поверхности — то же значение, что в `GUEST_EVENTS`, но
 * выбранное по поверхности, а не по строке вызывающего кода: опечатка в
 * пропсе обязана заканчиваться «ничего не отправлено», а не новым именем в
 * таблице, которое сервер всё равно отклонит.
 */
const PAGE_VIEW_EVENT_BY_SURFACE: Readonly<Record<PageViewSurface, PageViewEvent>> = {
  cohort: 'cohort_page_viewed',
  library: 'library_page_viewed',
};

/** Имя события верха воронки или `null`, если поверхность неизвестна. */
export function pageViewEvent(surface: string): PageViewEvent | null {
  return (PAGE_VIEW_EVENT_BY_SURFACE as Partial<Record<string, PageViewEvent>>)[surface] ?? null;
}

/** Просмотры, которые страница имеет право прислать, — для теста на равенство с whitelist сервера. */
export const PAGE_VIEW_EVENTS: readonly PageViewEvent[] = PAGE_VIEW_SURFACES.map(
  (surface) => PAGE_VIEW_EVENT_BY_SURFACE[surface],
);

/**
 * Функция, возвращающая `true` ровно один раз.
 *
 * Зачем: эффект в React 18 в dev-строгом режиме вызывается дважды на один
 * mount, а перерисовка страницы (смена пропсов, навигация по App Router внутри
 * одного и того же вставленного дерева) обязана оставить вставленный компонент
 * тем же экземпляром. Без guard'а каждый такой случай удваивал бы счётчик
 * просмотров, а `dedupeKey` тут не спасает: он был бы новым на каждый вызов.
 */
export function createSingleShot(): () => boolean {
  let fired = false;
  return () => {
    if (fired) return false;
    fired = true;
    return true;
  };
}
