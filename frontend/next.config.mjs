/**
 * Защитные заголовки для всех маршрутов, включая /public и /api/*-роуты
 * (Next проверяет headers() до файловой системы, поэтому `/:path*` покрывает
 * и приватные картинки-прокси).
 *
 * CSP намеренно ограничен только `frame-ancestors`: в src/app/layout.tsx:97
 * лежит inline-скрипт до-отрисовки темы (THEME_PREPAINT_SCRIPT), а next/font
 * добавляет inline-стили. Полный CSP (`default-src`) потребовал бы nonces/hashей
 * и сломал бы бету — это отдельная задача, не эта.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'",
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    // camera и geolocation приложением не используются вообще.
    // microphone оставляем за собой: useRecorder.ts:53 вызывает
    // getUserMedia({ audio: true }) для тренировки произношения — `microphone=()`
    // отключил бы эту фичу целиком.
    value: 'camera=(), microphone=(self), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    /*
     * В коде нет ни одного `next/image` (проверено поиском по src/), поэтому
     * optimization-API (/^/_next/image) здесь не используется, а значит нечего
     * и ломать: картинкa аватара и картинки слов идут через <img> на наши
     * /api/*-прокси. Выключение — страховка от CVE в Image Optimization
     * (next@14.2.35) и от будущего `next/image`: доки Next прямо предупреждают,
     * что optimization-API не пробрасывает заголовки авторизации, а наши
     * приватные изображения защищены кукой сессии.
     */
    unoptimized: true,
  },
  headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
  experimental: {
    // Клиентский router-cache: дольше держит RSC-ответы, поэтому
    // возврат на уже открытую вкладку не ждёт сервер.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
