import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Нет подключения — Lexicon',
  robots: { index: false, follow: false },
};

/*
 * Страницу отдаёт service worker прямо из кэша, поэтому она не зависит ни от
 * чанков, ни от JS: стили лежат инлайном, цвета берутся из токенов с фолбэком
 * на то же значение, что в globals.css. Тёмная тема — через prefers-color-scheme:
 * класс .dark навешивает скрипт в root layout, а сюда он может не дойти.
 */
const shellCss = `
.offline-shell{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--color-surface,#F6F7F9);color:var(--color-ink,#1A1D23);font-family:var(--font-inter),Inter,system-ui,-apple-system,sans-serif}
.offline-card{width:100%;max-width:26rem;text-align:center;background:var(--color-canvas,#FFFFFF);border:1px solid var(--color-hairline,#E5E7EB);border-radius:16px;padding:32px 24px;box-shadow:0 12px 32px rgba(11,37,69,.08)}
.offline-mark{width:48px;height:48px;margin:0 auto 20px;color:var(--color-primary,#0E7C7B)}
.offline-title{margin:0 0 8px;font-size:1.375rem;font-weight:600;letter-spacing:-.01em}
.offline-text{margin:0 0 24px;color:var(--color-slate,#5D6470);line-height:1.5}
.offline-button{width:100%;padding:12px 16px;border:0;border-radius:8px;background:var(--color-primary,#0E7C7B);color:var(--on-primary,#FFFFFF);font:inherit;font-size:.9375rem;font-weight:600;cursor:pointer}
.offline-button:hover{background:var(--color-primary-pressed,#0A6362)}
.offline-button:focus-visible{outline:2px solid var(--color-primary,#0E7C7B);outline-offset:2px}
@media (prefers-color-scheme:dark){
.offline-shell{background:var(--color-surface,#071426);color:var(--color-ink,#E8ECF3)}
.offline-card{background:var(--color-canvas,#0A1B2E);border-color:var(--color-hairline,#1F3550);box-shadow:0 12px 32px rgba(0,0,0,.4)}
.offline-mark{color:var(--color-primary,#2FB0A8)}
.offline-button{background:var(--color-primary,#2FB0A8);color:var(--on-primary,#06202B)}
.offline-button:hover{background:var(--color-primary-pressed,#46C2BB)}
.offline-text{color:var(--color-slate,#9AA9BF)}
}
`;

const retryScript = `
document.addEventListener('click', function (event) {
  var button = event.target.closest('[data-retry]');
  if (button) window.location.reload();
});
`;

export default function OfflinePage() {
  return (
    <main className="offline-shell">
      <style dangerouslySetInnerHTML={{ __html: shellCss }} />
      <script dangerouslySetInnerHTML={{ __html: retryScript }} />
      <div className="offline-card">
        <svg
          className="offline-mark"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 8.8A15 15 0 0 1 12 5c3.7 0 7.2 1.3 10 3.8" />
          <path d="M5 12.5A10.5 10.5 0 0 1 12 10c2.6 0 5 .9 7 2.5" />
          <path d="M8.5 16A6 6 0 0 1 12 15c1.3 0 2.6.4 3.5 1" />
          <path d="M12 19.5h.01" />
          <path d="m3 3 18 18" />
        </svg>
        <h1 className="offline-title">Нет подключения</h1>
        <p className="offline-text">
          Интернет пропал, но прогресс никуда не делся. Проверь сеть — и продолжим.
        </p>
        <button type="button" data-retry className="offline-button">
          Попробовать снова
        </button>
      </div>
    </main>
  );
}
