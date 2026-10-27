import { expect, test } from '@playwright/test';

/*
 * Диагностика: почему кнопка «Далее» остаётся disabled.
 * Вводим так же, как живой человек — посимвольно с клавиатуры.
 */

test('посимвольный ввод активирует кнопку Далее', async ({ page }) => {
  await page.goto('/onboarding', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  const next = page.getByRole('button', { name: /далее/i });

  await email.click();
  await page.keyboard.type('nikita-keyboard@example.com', { delay: 25 });

  await password.click();
  await page.keyboard.type('Nikita-12345', { delay: 25 });

  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const e = document.querySelector('input[type="email"]') as HTMLInputElement;
    const p = document.querySelector('input[type="password"]') as HTMLInputElement;
    const b = [...document.querySelectorAll('button')].find((x) => /далее/i.test(x.textContent || ''));
    return {
      emailValue: e?.value,
      passwordLen: p?.value.length,
      disabled: b?.disabled,
    };
  });

  console.log('СОСТОЯНИЕ ПОСЛЕ КЛАВИАТУРНОГО ВВОДА:', JSON.stringify(state));

  expect(state.emailValue).toBe('nikita-keyboard@example.com');
  expect(state.passwordLen).toBe(12);
  expect(state.disabled, 'кнопка должна активироваться после ввода').toBe(false);
});
