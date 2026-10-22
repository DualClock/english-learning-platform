import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Нет подключения — Lexicon',
  robots: { index: false, follow: false },
};

/*
 * Страницу отдаёт service worker прямо из кэша, поэтому она не зависит ни от
 * чанков, ни от JS: стили лежат инлайном, цвета берутся из токенов с фолбэком
 * на то же значение, что в globals.css. Базовая тема — светлая, поэтому
 * системную тёмную здесь не подхватываем.
 */
const shellCss = `
.offline-shell{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--color-surface,#F6F7F9);color:var(--color-ink,#1A1D23);font-family:var(--font-inter),Inter,system-ui,-apple-system,sans-serif}
.offline-card{width:100%;max-width:26rem;text-align:center;background:var(--color-canvas,#FFFFFF);border:1px solid var(--color-hairline,#E5E7EB);border-radius:16px;padding:32px 24px;box-shadow:0 12px 32px rgba(11,37,69,.08)}
.offline-mark{width:48px;height:48px;margin:0 auto 20px;color:var(--color-primary,#0E7C7B)}
.offline-lexi{width:84px;height:auto;margin:0 auto 14px;display:block}
.offline-title{margin:0 0 8px;font-size:1.375rem;font-weight:600;letter-spacing:-.01em}
.offline-text{margin:0 0 24px;color:var(--color-slate,#5D6470);line-height:1.5}
.offline-button{width:100%;padding:12px 16px;border:0;border-radius:8px;background:var(--color-primary,#0E7C7B);color:var(--on-primary,#FFFFFF);font:inherit;font-size:.9375rem;font-weight:600;cursor:pointer}
.offline-button:hover{background:var(--color-primary-pressed,#0A6362)}
.offline-button:focus-visible{outline:2px solid var(--color-primary,#0E7C7B);outline-offset:2px}
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
        {/* Спящий Lexi: статичный SVG без JS — страница должна работать из кэша SW. */}
        <svg
          className="offline-lexi"
          viewBox="0 0 260 280"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <g stroke="var(--color-lexi-line,#17314C)" strokeWidth="4">
            <path
              d="M52 82 C58 58 84 42 116 38 C132 36 146 38 158 42 C176 62 199 92 220 120 C221 124 221 128 220 132 C218 153 210 169 196 181 C182 193 165 198 149 199 C128 202 101 200 82 193 C62 186 47 169 42 149 C36 131 39 105 52 82Z"
              fill="var(--color-lexi-paper,#FFF2D8)"
            />
            <path
              d="M158 42 C168 28 184 24 196 30 C205 35 211 49 215 68 C218 87 220 104 220 120 C198 96 176 68 158 42Z"
              fill="var(--color-lexi-fold,#F3D3A6)"
              strokeWidth="3.6"
            />
            <g stroke="none">
              <ellipse cx="70" cy="144" rx="15.5" ry="9.5" fill="var(--color-lexi-blush,#F3B39B)" />
              <ellipse cx="170" cy="144" rx="15.5" ry="9.5" fill="var(--color-lexi-blush,#F3B39B)" />
            </g>
            <path d="M92 114 C96 121 105 121 109 114" strokeWidth="3.1" />
            <path d="M137 114 C141 121 149 121 153 114" strokeWidth="3.1" />
            <path d="M91 94 C97 91 104 91 109 93" strokeWidth="3.1" />
            <path d="M137 93 C143 91 150 92 155 96" strokeWidth="3.1" />
            <path d="M117 142 C121 144 126 144 129 142" strokeWidth="3.1" />
          </g>
          <g stroke="var(--color-lexi-accent,#0E7C7B)" strokeWidth="4" strokeLinecap="round">
            <path d="M227 96 L245 96 L227 114 L245 114" />
            <path d="M236 64 L250 64 L236 78 L250 78" />
            <path d="M248 40 L257 40 L248 49 L257 49" />
          </g>
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
