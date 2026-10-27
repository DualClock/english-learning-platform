'use client';

import { useEffect } from 'react';

// Регистрируем service worker только в production-сборке: в dev он мешал бы HMR.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // установка PWA — приятный бонус, без неё приложение работает как обычно
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
