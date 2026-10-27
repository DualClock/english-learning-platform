'use client';

import { useEffect } from 'react';
import { ATTRIBUTION_TTL_DAYS, capture } from '@/lib/attribution';

/**
 * Ловит utm-метки и `?ref=<код>` при заходе на сайт и сохраняет их на 30 дней —
 * так человек, который открыл ссылку учителя, а зарегистрировался вечером,
 * всё равно записан на этого учителя.
 *
 * Висит в корневом layout и ничего не рисует: разовый эффект на mount.
 * Чистка и приоритет меток живут в `src/lib/attribution.ts` (покрыт тестами),
 * здесь только доступ к document.cookie и sessionStorage.
 */
export default function AttributionCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const writeCookie = (name: string, value: string, maxAgeSeconds: number) => {
      try {
        // Secure только на https: на http://localhost браузер такой cookie не примет
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
      } catch {
        // cookie недоступны — атрибуция останется в sessionStorage этой вкладки
      }
    };

    try {
      capture(
        window.location.search,
        document.cookie,
        window.sessionStorage,
        Date.now(),
        ATTRIBUTION_TTL_DAYS,
        writeCookie
      );
    } catch {
      // sessionStorage бросает в приватном режиме — атрибуция не стоит того,
      // чтобы из-за неё падало приложение
    }
  }, []);

  return null;
}
