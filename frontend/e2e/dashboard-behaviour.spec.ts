import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Дашборд проверяется поведением, а не снимком.
 *
 * Причина в самом экране: он собирается из восьми независимых запросов, и
 * часть блоков зависит от данных (нулевые счётчики скрыты, серия меняет
 * текст, карточка продолжения — от позиции чтения). Пиксельное сравнение
 * такого экрана падает от смены данных, а не от смены вёрстки — такой
 * красный обесценивает гейт. Здесь проверяются инварианты, которые обязаны
 * держаться при любых данных.
 */

const AUTH_STATE = join(__dirname, '.visual-auth.json');

test.describe('дашборд: инварианты вёрстки', () => {
  test.skip(!existsSync(AUTH_STATE), 'Нет сессии — сначала e2e/visual-auth.setup.mjs');
  test.use({ storageState: AUTH_STATE });

  test('приветствие человеческое и главная карточка на месте', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();

    const text = (await h1.innerText()).trim();
    // Имя не должно быть техническим: email-локаль или id в приветствии — баг.
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{6,}/);
    expect(text).not.toMatch(/^(Доброе утро|Добрый день|Добрый вечер|Доброй ночи),?\s*$/);
  });

  test('нет ряда из одних нулевых счётчиков', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    /*
     * Счётчики скрывают нули. Значит в разметке не должно остаться плиток,
     * где значение — ровно «0»: такие плитки занимают место, ничего не
     * сообщая. Прочерк «—» допустим: это «неизвестно», а не ноль.
     */
    const zeroTiles = await page.evaluate(() => {
      const nums = Array.from(document.querySelectorAll(".tabular-nums"));
      return nums.filter((el) => el.textContent?.trim() === '0').length;
    });

    expect(zeroTiles).toBe(0);
  });

  test('на мобиле нижняя панель не перекрывает контент', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);

    const covered = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Основные разделы"]');
      if (!nav) return -1;
      const navTop = nav.getBoundingClientRect().top;
      return Array.from(document.querySelectorAll("main button, main a")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top < navTop && r.bottom > navTop + 2;
      }).length;
    });

    expect(covered).toBe(0);
  });
});
