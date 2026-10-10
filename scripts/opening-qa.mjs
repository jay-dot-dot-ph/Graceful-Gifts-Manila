import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const fixture = { watches: [], brands: [] }; // Only the opening experience is under test.
const screenshots = resolve('.sites-runtime');
mkdirSync(screenshots, { recursive: true });

try {
  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: label === 'tablet' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/catalog', (route) => route.fulfill({ json: fixture }));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: opening should be visible`);
    const state = await page.evaluate(() => {
      const screen = document.querySelector('#opening-screen');
      const brand = document.querySelector('.opening-brand').getBoundingClientRect();
      const feedback = document.querySelector('.opening-feedback').getBoundingClientRect();
      const image = document.querySelector('.opening-feedback img');
      return {
        delay: getComputedStyle(screen).animationDelay,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        overlap: brand.left < feedback.right && brand.right > feedback.left && brand.top < feedback.bottom && brand.bottom > feedback.top,
        inert: document.querySelector('#app').inert,
        imageUrl: image.getAttribute('src'),
      };
    });
    assert.equal(state.delay, '5s', `${label}: exit should begin at five seconds`);
    assert.equal(state.overlap, false, `${label}: feedback should not cover branding or loading text`);
    assert.equal(state.inert, true, `${label}: homepage should not receive focus during opening`);
    assert.ok(state.scrollWidth <= state.viewportWidth + 1, `${label}: layout should not overflow horizontally`);
    assert.match(state.imageUrl, /\/feedback\/opening\.jpg$/);
    await page.locator('.opening-feedback img').evaluate(async (image) => {
      if (!image.complete) await new Promise((resolve) => image.addEventListener('load', resolve, { once: true }));
      if (!image.naturalWidth) throw new Error('Feedback image failed to load');
    });
    if (label !== 'tablet') {
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(screenshots, `opening-${label}.png`) });
    }
    if (label === 'desktop') {
      await page.waitForTimeout(3500);
      assert.equal(await page.locator('#opening-screen').isVisible(), true, 'Opening should remain for the five-second hold');
    }
    await page.locator('#opening-screen').waitFor({ state: 'detached', timeout: 8000 });
    await page.locator('.hero h1').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#app').evaluate((app) => app.inert), false, `${label}: homepage should be interactive`);
    assert.equal(await page.locator('#opening-screen .opening-feedback').count(), 0, `${label}: feedback should be removed`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#opening-screen').count(), 0, `${label}: returning home should skip opening`);
    assert.deepEqual(errors, [], `${label}: browser should not report JavaScript errors`);
    await context.close();
  }
  const directContext = await browser.newContext();
  const directPage = await directContext.newPage();
  await directPage.route('**/api/catalog', (route) => route.fulfill({ json: fixture }));
  await directPage.goto(base + '/watches', { waitUntil: 'domcontentloaded' });
  await directPage.locator('#catalog-search').waitFor({ timeout: 5000 });
  assert.equal(await directPage.locator('#opening-screen').count(), 0, 'Direct catalog visits should skip the homepage opening');
  assert.equal(await directPage.locator('#app').evaluate((app) => app.inert), false, 'Direct catalog visits should stay interactive');
  await directContext.close();
  console.log('Opening timing, feedback image, layout, reduced motion, and first-visit behavior passed.');
} finally {
  await browser.close();
}
