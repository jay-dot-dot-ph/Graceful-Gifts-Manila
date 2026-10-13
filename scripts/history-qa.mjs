import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/watches/seiko');
  await page.locator('.watch-card').first().waitFor();
  await page.locator('[data-brand-toggle]').click();
  await page.locator('#catalog-sort').selectOption('price-asc');
  await page.locator('.watch-card').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.__historyMarker = 'same document'; });
  const listingScroll = await page.evaluate(() => scrollY);
  assert.ok(listingScroll > 200, `Catalog should be scrolled before opening a watch: ${listingScroll}`);
  await page.locator('.watch-card .card-image a').first().click();
  await page.locator('.detail-page h1').waitFor();
  assert.match(new URL(page.url()).pathname, /^\/watch\//);
  assert.equal(await page.evaluate(() => window.__historyMarker), 'same document', 'Watch opens without a page reload');
  await page.goBack();
  await page.locator('.watch-card').first().waitFor();
  await page.waitForFunction((previousY) => Math.abs(scrollY - previousY) < 40, listingScroll);
  assert.equal(new URL(page.url()).pathname, '/watches/seiko');
  assert.equal(await page.locator('#catalog-sort').inputValue(), 'price-asc');
  assert.equal(await page.locator('[data-brand-toggle]').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => window.__historyMarker), 'same document', 'Back returns without a page reload');
  await page.goForward();
  await page.locator('.detail-page h1').waitFor();
  assert.match(new URL(page.url()).pathname, /^\/watch\//);
  assert.deepEqual(errors, []);
  console.log(`Mobile history QA passed: Back restored listing at ${listingScroll}px with filters and expanded brands; Forward reopened the watch without reloading.`);
} finally {
  await browser.close();
}
