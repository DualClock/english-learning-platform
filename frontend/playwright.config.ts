import { defineConfig, devices } from '@playwright/test';

// В этом окружении выставлен HTTP_PROXY. Chromium обходит прокси для
// localhost сам, WebKit — нет: запросы к /_next/* уходят на прокси и
// возвращаются как /localhost:3100/_next/*, страница не гидрируется.
// Поэтому e2e всегда ходит напрямую.
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key];
}
process.env.NO_PROXY = 'localhost,127.0.0.1';

/**
 * Спайк вёрстки и смоук читалки.
 *
 * Отдельный каталог сборки (NEXT_DIST_DIR) — чтобы прогон не выбивал `.next`
 * из-под работающего `npm run dev`. Порт тоже отдельный по той же причине.
 */
const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/start-e2e-server.mjs',
    url: `http://localhost:${PORT}/reader-lab`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { NEXT_DIST_DIR: '.next-e2e', E2E_PORT: String(PORT) },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
});
