import { defineConfig, devices } from '@playwright/test';

/*
 * Конфиг для локального GO-гейта.
 *
 * Отличается от основного `playwright.config.ts` двумя вещами, и обе
 * принципиальные:
 *
 *  1. Нет `globalSetup`: штатный прогрев открывает /reader-lab, которому нужен
 *     отдельный dev-стенд. GO-гейт проверяет лендинг, читалку и онбординг —
 *     греть лабораторию бессмысленно, а её падение давало бы ложный красный.
 *  2. Нет `webServer`: сервер поднимается снаружи (API на 5226 и Next на 3100),
 *     чтобы тест шёл против того же стенда, на котором проверены миграции и
 *     восстановление из дампа, а не против свежесобранного состояния.
 */
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key];
}

const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: '.',
  testMatch: ['go-gate-flow.spec.ts', 'signup-regression.spec.ts', 'signup-diagnose.spec.ts'],
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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
