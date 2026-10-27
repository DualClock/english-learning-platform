import { expect, test, type Page } from '@playwright/test';

/**
 * Этап 0: спайк постраничной вёрстки.
 *
 * Проверяем ровно то, что обещает движок, а не «страница открылась»:
 *  - страниц больше одной и их число совпадает с числом колонок потока;
 *  - ни одна страница не пустая (главный страх CSS columns);
 *  - смена кегля не выбрасывает из предложения;
 *  - reload возвращает к тому же предложению.
 *
 * Прогоняется в Chromium, WebKit и iPhone 13 (WebKit + мобильный вьюпорт).
 */

const counter = (page: Page) => page.locator('header span[aria-live="polite"]');
const anchorLabel = (page: Page) => page.locator('header span', { hasText: 'anchor:' });

async function totalPages(page: Page): Promise<number> {
  const text = (await counter(page).textContent()) ?? '';
  const match = /(\d+)\s*\/\s*(\d+)/.exec(text);
  if (!match) throw new Error(`Не разобрал счётчик страниц: "${text}"`);
  return Number(match[2]);
}

async function currentPage(page: Page): Promise<number> {
  const text = (await counter(page).textContent()) ?? '';
  const match = /(\d+)\s*\/\s*(\d+)/.exec(text);
  if (!match) throw new Error(`Не разобрал счётчик страниц: "${text}"`);
  return Number(match[1]);
}

async function anchorSentence(page: Page): Promise<string> {
  const text = (await anchorLabel(page).textContent()) ?? '';
  const match = /anchor:\s*([^\s:]+)/.exec(text);
  return match?.[1] ?? '';
}

/** Видно ли предложение на текущей странице (в том числе если оно перешло с прошлой). */
async function sentenceOnScreen(page: Page, sentenceId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const element = document.querySelector(`[data-s="${id}"]`);
    const viewport = document.querySelector('.reader-viewport');
    if (!element || !viewport) return false;
    const frame = viewport.getBoundingClientRect();
    return Array.from(element.getClientRects()).some(
      (rect) =>
        rect.width > 2 &&
        rect.right > frame.left + 1 &&
        rect.left < frame.right - 1 &&
        rect.bottom > frame.top &&
        rect.top < frame.bottom
    );
  }, sentenceId);
}

/** Сколько строк текста реально видно на странице. Ноль — пустая колонка. */
async function visibleLineRects(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.reader-viewport');
    if (!viewport) return -1;
    const frame = viewport.getBoundingClientRect();
    const rects = Array.from(document.querySelectorAll('.reader-flow [data-s]'))
      .flatMap((element) => Array.from(element.getClientRects()));

    return rects.filter(
      (rect) =>
        rect.width > 2 &&
        rect.height > 2 &&
        rect.right > frame.left + 1 &&
        rect.left < frame.right - 1 &&
        rect.bottom > frame.top &&
        rect.top < frame.bottom
    ).length;
  });
}

async function columnsMatchPages(page: Page, total: number): Promise<boolean> {
  return page.evaluate((expected) => {
    const flow = document.querySelector('.reader-flow');
    const viewport = document.querySelector('.reader-viewport');
    if (!flow || !viewport) return false;
    const width = viewport.getBoundingClientRect().width;
    if (width <= 0) return false;
    // scrollWidth колонок не зависит от transform: это честное число колонок.
    return Math.abs(flow.scrollWidth - expected * width) <= width * 0.6;
  }, total);
}

test.beforeEach(async ({ page }) => {
  // Чистим память только на первом заходе: addInitScript выполняется и при
  // reload, а тест про reload как раз проверяет, что якорь пережил его.
  await page.addInitScript(() => {
    try {
      if (!window.sessionStorage.getItem('e2e-storage-ready')) {
        window.localStorage.clear();
        window.sessionStorage.setItem('e2e-storage-ready', '1');
      }
    } catch {
      // приватный режим — не мешает проверке
    }
  });

  await page.goto('/reader-lab');
  await expect(page.locator('.reader-flow')).toBeVisible();
  await expect(counter(page)).toContainText('/');
  // Первый layout считается после document.fonts.ready; ждём именно текст,
  // а не спиннер: до готовности поток скрыт.
  await expect
    .poll(async () => visibleLineRects(page), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // aria-hidden снимает уже React, а не серверный HTML. Без этого ожидания
  // клавиши и кнопки на холодной компиляции нажимаются до гидратации и молча
  // ничего не делают.
  await expect
    .poll(async () => page.locator('.reader-flow').getAttribute('aria-hidden'), { timeout: 20_000 })
    .toBe('false');

  // aria-hidden снимает первый layout, а счётчик обновляется отдельным
  // сообщением после кадра. В WebKit этот такт заметно длиннее, поэтому
  // ждём именно измеренное число страниц, а не первый же кадр.
  await expect.poll(async () => totalPages(page), { timeout: 20_000 }).toBeGreaterThan(1);

  // aria-hidden снимает первый layout, а счётчик обновляется отдельным
  // сообщением после кадра. В WebKit этот такт заметно длиннее, поэтому
  // ждём именно измеренное число страниц, а не первый же кадр.
  await expect.poll(async () => totalPages(page), { timeout: 20_000 }).toBeGreaterThan(1);
});

test('страницы измерены, пустых колонок нет', async ({ page }) => {
  const total = await totalPages(page);
  expect(total, 'главная проверка спайка: колонки вообще работают').toBeGreaterThan(1);

  expect(
    await columnsMatchPages(page, total),
    `scrollWidth потока не совпал с ${total} колонками — измерение врёт`
  ).toBe(true);

  for (let index = 1; index <= total; index++) {
    expect(await currentPage(page), 'счётчик и обход страниц разъехались').toBe(index);

    const lines = await visibleLineRects(page);
    expect(lines, `страница ${index} из ${total} пустая`).toBeGreaterThan(0);

    if (index < total) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => currentPage(page)).toBe(index + 1);
    }
  }
});

test('смена кегля оставляет в том же предложении', async ({ page }) => {
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  const before = await anchorSentence(page);
  expect(before.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Увеличить кегль' }).click();
  await page.getByRole('button', { name: 'Увеличить кегль' }).click();

  await expect.poll(async () => anchorSentence(page)).toBe(before);
  expect(await visibleLineRects(page), 'после перевёрстки страница опустела').toBeGreaterThan(0);
});

test('reload возвращает к тому же предложению', async ({ page }) => {
  // Ждём счётчик после каждого нажатия: иначе якорь читается из ещё не
  // отправленного состояния и тест ловит собственную гонку.
  for (let index = 1; index <= 3; index++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => currentPage(page)).toBe(index + 1);
  }

  const anchorBefore = await anchorSentence(page);
  expect(anchorBefore.length).toBeGreaterThan(0);

  // Лаборатория пишет якорь в localStorage; reload должен его прочитать.
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem('reader_lab_anchor_v1')))
    .toContain(anchorBefore);

  await page.reload();
  await expect.poll(async () => visibleLineRects(page), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => page.locator('.reader-flow').getAttribute('aria-hidden')).toBe('false');

  // Проверяем обещание читалки: то же предложение видно на экране. Номер
  // страницы может отличаться на единицу, если предложение переходит через
  // границу страницы — это не потеря места.
  await expect
    .poll(async () => sentenceOnScreen(page, anchorBefore), { timeout: 20_000 })
    .toBe(true);
});

test('свайп перелистывает страницу', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('iphone'), 'жест проверяем на мобильном проекте');

  const before = await currentPage(page);
  const box = await page.locator('.reader-viewport').boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  // Свайп пальцем: на мобильном проекте мышь не превращается в touch,
  // поэтому отправляем pointer-события с pointerType 'touch' напрямую.
  const y = box.y + box.height / 2;
  const startX = box.x + box.width * 0.82;
  const endX = box.x + box.width * 0.18;
  const viewport = page.locator('.reader-viewport');

  await viewport.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: startX,
    clientY: y,
  });
  await viewport.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: (startX + endX) / 2,
    clientY: y,
  });
  await viewport.dispatchEvent('pointerup', {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: endX,
    clientY: y,
  });

  await expect.poll(async () => currentPage(page)).toBe(before + 1);
});
