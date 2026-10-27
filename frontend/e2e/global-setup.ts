import { chromium } from '@playwright/test';

/**
 * Прогрев dev-сервера.
 *
 * Next компилирует маршрут при первом запросе и после компиляции делает
 * полную перезагрузку страницы. Если тест начинается в этот момент, клавиши
 * нажимаются до гидратации и молча теряются. Один прогрев убирает гонку из
 * всех проектов: дальше маршрут уже собран.
 */
export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100';
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/reader-lab`, { waitUntil: 'load', timeout: 180_000 });
    await page
      .locator('.reader-flow[aria-hidden="false"]')
      .waitFor({ timeout: 60_000 })
      .catch(() => {
        // маршрут мог не успеть — тест сам покажет ошибку внятнее
      });
    await page.waitForTimeout(800);
  } finally {
    await browser.close();
  }
}
