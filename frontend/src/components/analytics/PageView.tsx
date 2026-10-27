'use client';

import { useEffect, useRef } from 'react';
import { guestDedupeKey, trackGuest } from '@/app/lib/analytics';
import { createSingleShot, pageViewEvent, type PageViewSurface } from '@/lib/page-view';

/*
 * Счётчик верха воронки для серверных витрин (W3.4).
 *
 * Ключевое ограничение задачи: страница обязана остаться серверной. Поэтому
 * здесь клиентский только этот листок: `/beta` и `/library` по-прежнему
 * отдают весь текст в HTML до JavaScript, а `page.tsx` не помечается
 * `'use client'` и не превращается в динамический роут. Комментара в HTML
 * недостаточно — grep по серверному ответу должен видеть маркер, поэтому
 * маркер (data-атрибут с именем события) рендерится на сервере как часть
 * этого leaf-компонента, а не только в браузере.
 *
 * Отправка — ровно одна на вставку компонента:
 *  - `createSingleShot()` в ref гасит и двойной эффект React 18 в dev, и
 *    перерисовки того же экземпляра при RSC-навигации (тот же экземпляр —
 *    значит тот же просмотр);
 *  - `dedupeKey` создаётся один раз на вставку и передаётся серверу: сетевой
 *    ретрай после обрыва склеивается в одну строку, а не удваивает счётчик;
 *  - тело собирает `trackGuest`, то есть ровно `{event, dedupeKey}` — slug,
 *    query и user-agent физически некуда положить.
 *
 * Ошибка глотается на месте (внутри `trackGuest`): аналитика не имеет права
 * менять поведение страницы, на которую человек пришёл читать.
 */
export default function PageView({ surface }: { surface: PageViewSurface }) {
  const event = pageViewEvent(surface);
  const singleShot = useRef(createSingleShot());
  const dedupeKey = useRef<string | null>(null);

  useEffect(() => {
    // Известная поверхность и первый срабат — иначе молчим: за неизвестный
    // `surface` сервер всё равно ответил бы 400, а шум в консоли не нужен.
    if (event === null || !singleShot.current()) return;

    dedupeKey.current ??= guestDedupeKey();
    void trackGuest(event, { dedupeKey: dedupeKey.current });
  }, [event]);

  if (event === null) return null;

  /**
   * `hidden` и `aria-hidden`: элемент не участвует ни в_layout_, ни в озвучке
   * скринридера — счётчик не должен становиться содержимым страницы.
   */
  return <span data-guest-page-view={event} aria-hidden hidden />;
}
