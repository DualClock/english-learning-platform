import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Нет подключения — Lexicon',
  robots: { index: false, follow: false },
};

// Стили инлайновые, кнопка работает через встроенный скрипт: страница
// кэшируется service worker'ом как HTML и должна быть полезной без сети и чанков.
const retryScript = `
document.addEventListener('click', function (event) {
  var button = event.target.closest('[data-retry]');
  if (button) window.location.reload();
});
`;

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#F6F7F9',
        color: '#1A1D23',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <script dangerouslySetInnerHTML={{ __html: retryScript }} />
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          textAlign: 'center',
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          borderRadius: 16,
          padding: '32px 24px',
          boxShadow: '0 12px 32px rgba(11, 37, 69, 0.08)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt=""
          width={72}
          height={72}
          style={{ borderRadius: 18, margin: '0 auto 20px', display: 'block' }}
        />
        <h1 style={{ fontSize: 22, margin: '0 0 8px', fontWeight: 600 }}>Нет подключения</h1>
        <p style={{ margin: '0 0 20px', color: '#5D6470', lineHeight: 1.5 }}>
          Интернет пропал, но прогресс никуда не делся. Проверь сеть — и продолжим.
        </p>
        <button
          type="button"
          data-retry
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#0E7C7B',
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Попробовать снова
        </button>
      </div>
    </main>
  );
}
