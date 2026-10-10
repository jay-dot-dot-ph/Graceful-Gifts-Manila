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
  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 320, 568], ['short-mobile', 320, 480], ['landscape-mobile', 667, 375]]) {
    if (process.argv[3] && process.argv[3] !== label) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: label === 'tablet' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/catalog', (route) => route.fulfill({ json: fixture }));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: opening should be visible`);
    await page.locator('.opening-feedback img').evaluate(async (image) => {
      if (!image.complete) await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', reject, { once: true });
      });
      if (!image.naturalWidth) throw new Error('Feedback image failed to load');
    });
    const state = await page.evaluate(() => {
      const screen = document.querySelector('#opening-screen');
      const brand = document.querySelector('.opening-brand').getBoundingClientRect();
      const feedback = document.querySelector('.opening-feedback');
      const image = document.querySelector('.opening-feedback img');
      const imageRect = image.getBoundingClientRect();
      const originalSpot = feedback.dataset.spot;
      const spotOverlaps = Array.from({ length: 4 }, (_, index) => {
        feedback.dataset.spot = String(index);
        const rect = image.getBoundingClientRect();
        return brand.left < rect.right && brand.right > rect.left && brand.top < rect.bottom && brand.bottom > rect.top;
      });
      feedback.dataset.spot = originalSpot;
      return {
        delay: getComputedStyle(screen).animationDelay,
        fadeDuration: getComputedStyle(screen).animationDuration,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        overlap: brand.left < imageRect.right && brand.right > imageRect.left && brand.top < imageRect.bottom && brand.bottom > imageRect.top,
        inert: document.querySelector('#app').inert,
        imageUrl: image.getAttribute('src'),
        imageSize: [image.naturalWidth, image.naturalHeight],
        renderedSize: [imageRect.width, imageRect.height],
        spot: feedback.dataset.spot,
        spotOverlaps,
      };
    });
    assert.equal(state.delay, '10s', `${label}: exit should begin at ten seconds`);
    assert.equal(state.fadeDuration, label === 'tablet' ? '0.001s' : '0.55s', `${label}: exit duration should respect motion preference`);
    assert.equal(state.overlap, false, `${label}: feedback should not cover branding or loading text`);
    assert.deepEqual(state.spotOverlaps, [false, false, false, false], `${label}: no floating position should cover the branding`);
    assert.equal(state.inert, true, `${label}: homepage should not receive focus during opening`);
    assert.ok(state.scrollWidth <= state.viewportWidth + 1, `${label}: layout should not overflow horizontally`);
    assert.match(state.imageUrl, /\/feedback\/opening-35b1b185\.jpg$/);
    assert.deepEqual(state.imageSize, [249, 263], `${label}: use the supplied image at its native dimensions`);
    assert.ok(state.renderedSize.every((size, index) => Math.abs(size - state.imageSize[index]) < 0.01), `${label}: image must not be resized or cropped`);
    if (label === 'desktop' || label === 'mobile') {
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(screenshots, `opening-${label}.png`) });
    }
    if (label !== 'tablet') {
      await page.waitForFunction((oldSpot) => document.querySelector('.opening-feedback')?.dataset.spot !== oldSpot, state.spot, { timeout: 4000 });
      const changed = await page.evaluate(() => {
        const brand = document.querySelector('.opening-brand').getBoundingClientRect();
        const image = document.querySelector('.opening-feedback img').getBoundingClientRect();
        return { spot: document.querySelector('.opening-feedback').dataset.spot, overlap: brand.left < image.right && brand.right > image.left && brand.top < image.bottom && brand.bottom > image.top };
      });
      assert.notEqual(changed.spot, state.spot, `${label}: feedback should reappear in another position`);
      assert.equal(changed.overlap, false, `${label}: the next position should keep the branding clear`);
    }
    await page.waitForFunction(() => document.querySelector('#opening-screen')?.getAnimations()[0]?.currentTime >= 9000, null, { timeout: 11000 });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: screen should still show before ten seconds`);
    await page.locator('#opening-screen').waitFor({ state: 'detached', timeout: 3000 });
    await page.locator('.hero h1').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#app').evaluate((app) => app.inert), false, `${label}: homepage should be interactive`);
    assert.equal(await page.locator('#opening-screen .opening-feedback').count(), 0, `${label}: feedback should be removed`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: every homepage load should show the opening`);
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
  console.log('Ten-second opening, original-size floating feedback, responsive layout, reduced motion, repeated visits, and direct routes passed.');
} finally {
  await browser.close();
}
