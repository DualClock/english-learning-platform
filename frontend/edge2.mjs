import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const OUT = path.resolve('.tmp', 'shots');
mkdirSync(OUT, { recursive: true });
const EMAIL = 'reader-e2e-1792931823@test.local';
const PASSWORD = 'ReaderTest123';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 120000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"], button:has-text("Войти")');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40000 });
await page.goto(`${BASE}/reader/60`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('.reader-flow', { timeout: 60000 });
await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

// Прячем chrome, чтобы измерять только страницу
await page.addStyleTag({ content: 'header, footer { display: none !important; }' });
await page.waitForTimeout(300);

const themes = ['day', 'sepia', 'night'];
const report = {};

for (const theme of themes) {
  for (const mode of ['with-after', 'no-after']) {
    await page.evaluate(
      ([t, m]) => {
        document.querySelector('.reader-stage').dataset.readerTheme = t;
        let tag = document.getElementById('no-after-style');
        if (m === 'no-after') {
          if (!tag) {
            tag = document.createElement('style');
            tag.id = 'no-after-style';
            tag.textContent = '.reader-viewport::after { display: none !important; }';
            document.head.appendChild(tag);
          }
        } else if (tag) {
          tag.remove();
        }
      },
      [theme, mode]
    );
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `edge-${theme}-${mode}.png`) });

    const data = await page.evaluate(() => {
      const vp = document.querySelector('.reader-viewport').getBoundingClientRect();
      const pad = document.querySelector('.reader-page-pad').getBoundingClientRect();
      const sheet = document.querySelector('.reader-sheet').getBoundingClientRect();
      const flow = document.querySelector('.reader-flow');
      const p = flow.querySelector('.reader-paragraph');
      // Ищем строку без текста
      const node = p.querySelector('[data-s]')?.firstChild;
      return {
        viewport: { left: vp.left, right: vp.right, width: vp.width },
        pad: { left: pad.left, right: pad.right },
        sheet: { left: sheet.left, right: sheet.right },
        padPadding: getComputedStyle(document.querySelector('.reader-page-pad')).paddingLeft,
        afterWidth: getComputedStyle(document.querySelector('.reader-viewport'), '::after').width,
      };
    });
    report[`${theme}-${mode}`] = data;
  }
}

writeFileSync(path.join(OUT, 'edge-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
