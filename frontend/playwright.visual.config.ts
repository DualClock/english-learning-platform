import { defineConfig, devices } from '@playwright/test';

/*
 * Визуальный гейт для редизайна.
 *
 * Зачем отдельный конфиг. Штатный `playwright.config.ts` делает globalSetup
 * (прогрев /reader-lab на отдельном стенде) и поднимает webServer. Для снятия
 * эталонов нужен ровно противоположный режим: сервер уже поднят снаружи
 * (API 5226, Next 3100), прогрев не нужен, а прогон идёт по одному воркеру,
 * чтобы снимки не конкурировали за процессор и не «плыли» по таймингам
 * анимации.
 *
 * Прокси снимается: в этом окружении HTTP_PROXY заставляет Playwright ходить
 * на localhost через прокси и получать 502.
 */
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key];
}

const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: './e2e',
  testMatch: ['visual.spec.ts', 'dashboard-behaviour.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Анимации выключены: иначе снимок зависит от момента попадания кадра.
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // DPR=1 у обоих проектов: гейт проверяет вёрстку, а не плотность экрана.
        deviceScaleFactor: 1,
      },
    },
    {
      /*
       * Мобильный профиль без «пикселей Pixel 5»: у него deviceScaleFactor 2.75,
       * из-за чего снимок 390×4169 превращался в 1073×11465 и Playwright
       * сжимал его при сравнении — результат «плыл» от прогона к прогону без
       * единого изменения в вёрстке. Здесь важны ширина и тач, а не DPR.
       */
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
