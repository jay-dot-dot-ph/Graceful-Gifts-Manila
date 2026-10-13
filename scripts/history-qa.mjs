import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/watches/ms');
  await page.locator('.watch-card').first().waitFor();
  await page.locator('[data-brand-toggle]').click();
  await page.locator('#catalog-sort').selectOption('price-asc');
  await page.locator('.watch-card').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.__historyMarker = 'same document'; });
  const listingScroll = await page.evaluate(() => scrollY);
  assert.ok(listingScroll > 200, `Catalog should be scrolled before opening a watch: ${listingScroll}`);
  await page.locator('.watch-card .card-image a').first().tap();
  await page.locator('.detail-page h1').waitFor();
  assert.match(new URL(page.url()).pathname, /^\/watch\//);
  const photoPosition = await page.evaluate(() => ({ scroll: scrollY, photoTop: document.querySelector('.detail-image').getBoundingClientRect().top, headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom }));
  assert.ok(photoPosition.scroll > 100, `Photo tap should land at the watch photo, not the page top: ${JSON.stringify(photoPosition)}`);
  assert.ok(photoPosition.photoTop >= photoPosition.headerBottom - 2 && photoPosition.photoTop <= photoPosition.headerBottom + 30, `Watch photo should sit directly below the sticky header: ${JSON.stringify(photoPosition)}`);
  assert.equal(await page.evaluate(() => window.__historyMarker), 'same document', 'Watch opens without a page reload');
  await page.goBack();
  await page.locator('.watch-card').first().waitFor();
  await page.waitForFunction((previousY) => Math.abs(scrollY - previousY) < 40, listingScroll);
  assert.equal(new URL(page.url()).pathname, '/watches/ms');
  assert.equal(await page.locator('#catalog-sort').inputValue(), 'price-asc');
  assert.equal(await page.locator('[data-brand-toggle]').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => window.__historyMarker), 'same document', 'Back returns without a page reload');
  await page.goForward();
  await page.locator('.detail-page h1').waitFor();
  assert.match(new URL(page.url()).pathname, /^\/watch\//);
  await page.waitForFunction((previousY) => Math.abs(scrollY - previousY) < 40, photoPosition.scroll);
  assert.deepEqual(errors, []);
  console.log(`Mobile history QA passed: photo tap landed at the watch image, Back restored listing at ${listingScroll}px, and Forward reopened the watch without reloading.`);
} finally {
  await browser.close();
}
