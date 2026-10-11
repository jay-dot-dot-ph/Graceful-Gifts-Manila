import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const fixture = { watches: [], brands: [] };

try {
  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 320, 568]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/catalog*', (route) => route.fulfill({ json: fixture }));
    for (let visit = 0; visit < 2; visit++) {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      assert.equal(await page.locator('#opening-screen').count(), 0, `${label}: no opening overlay on visit ${visit + 1}`);
      assert.equal(await page.locator('#app').evaluate((app) => app.inert), false, `${label}: homepage is interactive immediately`);
      await page.locator('.hero h1').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('.hero h1').isVisible(), true, `${label}: main page is visible`);
      assert.equal(await page.locator('.hero-actions a[href="/watches"]').isVisible(), true, `${label}: catalog link is available`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `${label}: no horizontal overflow (${overflow}px)`);
    }
    assert.deepEqual(errors, [], `${label}: no browser script errors`);
    await context.close();
  }
  console.log('Homepage opens immediately on desktop, tablet, and mobile, including repeat visits.');
} finally {
  await browser.close();
}
