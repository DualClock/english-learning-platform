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
await page.goto(`${BASE}/reader/61`, { waitUntil: 'load', timeout: 150000 });
await page.waitForSelector('.reader-flow', { timeout: 60000 });
await page.waitForFunction(() => Boolean(document.querySelector('.reader-flow')?.style.columnWidth), { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2000);

await page.addStyleTag({ content: 'header, footer { display: none !important; }' });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'alice-p1.png') });

const analyse = async () =>
  page.evaluate(() => {
    const vp = document.querySelector('.reader-viewport').getBoundingClientRect();
    const lines = [];
    const hyphenLines = [];
    let cur = null;
    for (const span of document.querySelectorAll('.reader-flow [data-s]')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent;
      const range = document.createRange();
      const flush = () => {
        if (cur && cur.right > vp.left && cur.left < vp.right) {
          lines.push(cur);
          if (cur.text.trimEnd().endsWith('-')) hyphenLines.push(cur);
        }
        cur = null;
      };
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (!cur || Math.abs(r.top - cur.top) > 3) {
          flush();
          cur = { top: r.top, left: r.left, right: r.right, text: text[i] };
        } else {
          cur.left = Math.min(cur.left, r.left);
          cur.right = Math.max(cur.right, r.right);
          cur.text += text[i];
        }
      }
      flush();
    }
    return {
      page: document.querySelector('footer')?.innerText?.split('\n')[0],
      lineCount: lines.length,
      hyphenCount: hyphenLines.length,
      hyphenLines: hyphenLines.map((l) => ({ w: +(l.right - l.left).toFixed(1), tail: l.text.trim().slice(-24) })),
      fullWidthLines: lines.filter((l) => l.right - l.left > 654).length,
    };
  });

const pages = [];
for (let i = 1; i <= 6; i++) {
  const a = await analyse();
  pages.push(a);
  console.log(`page ${i}`, JSON.stringify(a));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1000);
}
writeFileSync(path.join(OUT, 'alice-lines.json'), JSON.stringify(pages, null, 2));

await page.screenshot({ path: path.join(OUT, 'alice-last.png') });
await browser.close();