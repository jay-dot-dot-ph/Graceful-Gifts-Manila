import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const fixture = { watches: [], brands: [] };
const feedbackCount = readdirSync(resolve('feedback')).filter((name) => /\.jpe?g$/i.test(name)).length;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });

try {
  for (const [label, width, height] of [['desktop', 1440, 900], ['small-desktop', 1100, 600], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 320, 568]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: label === 'tablet' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/catalog*', (route) => route.fulfill({ json: fixture }));
    if (label === 'desktop') await page.route('**/styles*.css', async (route) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
      await route.continue();
    });
    await page.goto(base + '/', { waitUntil: 'commit' });
    await page.locator('#opening-screen').waitFor({ state: 'attached', timeout: 5000 });
    const first = await page.evaluate(() => {
      const screen = document.getElementById('opening-screen');
      const logo = screen.querySelector('.opening-mark');
      const logoRect = logo.getBoundingClientRect();
      return {
        screenVisible: getComputedStyle(screen).visibility === 'visible' && getComputedStyle(screen).opacity === '1',
        logoTopmost: logo.contains(document.elementFromPoint(logoRect.left + logoRect.width / 2, logoRect.top + logoRect.height / 2)),
        appHidden: getComputedStyle(document.getElementById('app')).visibility === 'hidden',
        stylesReady: document.documentElement.classList.contains('site-styles-ready'),
        delay: getComputedStyle(screen).animationDelay,
        duration: getComputedStyle(screen).animationDuration,
        cards: screen.querySelectorAll('.opening-feedback').length,
        hostedImages: screen.querySelectorAll('.opening-feedback img[src^="/feedback/"]').length,
      };
    });
    assert.equal(first.screenVisible && first.logoTopmost && first.appHidden, true, `${label}: opening covers the main page at first paint`);
    if (label === 'desktop') assert.equal(first.stylesReady, false, 'opening appears even while the main stylesheet is delayed');
    assert.equal(first.delay, '3s', `${label}: opening holds for three seconds`);
    assert.equal(first.duration, '0.001s', `${label}: exit has no half-second pause`);
    assert.equal(first.cards, feedbackCount, `${label}: all supplied feedback pictures remain in the opening`);
    assert.equal(first.hostedImages, feedbackCount, `${label}: feedback previews use cacheable Hosting files`);
    await page.waitForFunction(() => [...document.querySelectorAll('.opening-feedback')].some((card) => Number(getComputedStyle(card).opacity) > 0.2), null, { timeout: 3500 });
    if (label.endsWith('desktop')) {
      await page.waitForFunction((count) => [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95).length === count, feedbackCount, { timeout: 3500 });
      const collage = await page.evaluate(() => {
        const logo = document.querySelector('.opening-brand').getBoundingClientRect();
        const screen = document.querySelector('#opening-screen').getBoundingClientRect();
        const visible = [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95);
        const quadrants = [0, 0, 0, 0];
        const cropped = visible.some((card) => {
          const photo = card.getBoundingClientRect();
          const image = card.querySelector('img');
          quadrants[Number(photo.top + photo.height / 2 >= screen.height / 2) * 2 + Number(photo.left + photo.width / 2 >= screen.width / 2)]++;
          return Math.abs(photo.width / photo.height - image.naturalWidth / image.naturalHeight) > .01 || getComputedStyle(image).objectFit === 'cover';
        });
        const coveredLogo = visible.some((card) => {
          const photo = card.getBoundingClientRect();
          return photo.left < logo.right && photo.right > logo.left && photo.top < logo.bottom && photo.bottom > logo.top;
        });
        return { visible: visible.length, coveredLogo, quadrants, cropped };
      });
      assert.equal(collage.visible, feedbackCount, `${label}: every photo visible together`);
      assert.equal(collage.coveredLogo, false, 'desktop: photos leave the logo clear');
      assert.equal(collage.cropped, false, `${label}: photos keep their original proportions`);
      assert.ok(collage.quadrants.every((count) => count >= 8), `${label}: photos fill all sides evenly`);
    } else if (width <= 760) {
      await page.waitForFunction((count) => [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95).length === count, feedbackCount, { timeout: 2500 });
      const collage = await page.evaluate(() => {
        const screen = document.querySelector('#opening-screen').getBoundingClientRect();
        const logo = document.querySelector('.opening-brand').getBoundingClientRect();
        const photos = [...document.querySelectorAll('.opening-feedback')].map((card) => card.getBoundingClientRect());
        return {
          visible: photos.length,
          largestWidth: Math.max(...photos.map((photo) => photo.width)),
          insideScreen: photos.every((photo) => photo.left >= screen.left && photo.right <= screen.right && photo.top >= screen.top && photo.bottom <= screen.bottom),
          logoClear: photos.every((photo) => photo.right <= logo.left || photo.left >= logo.right || photo.bottom <= logo.top || photo.top >= logo.bottom),
          leftSide: photos.filter((photo) => photo.top >= logo.top && photo.bottom <= logo.bottom && photo.right <= logo.left).length,
          rightSide: photos.filter((photo) => photo.top >= logo.top && photo.bottom <= logo.bottom && photo.left >= logo.right).length,
        };
      });
      assert.equal(collage.visible, feedbackCount, `${label}: all feedback photos are in the collage`);
      assert.ok(collage.largestWidth <= 70, `${label}: feedback thumbnails stay compact`);
      assert.equal(collage.insideScreen && collage.logoClear, true, `${label}: photos fit around the logo`);
      assert.ok(collage.leftSide >= 2 && collage.rightSide >= 2, `${label}: photos fill both sides of the logo`);
    }
    try {
      await page.locator('#opening-screen').waitFor({ state: 'detached', timeout: 6000 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const screen = document.getElementById('opening-screen');
        return { elapsed: performance.now(), animation: screen?.getAnimations().map((item) => ({ playState: item.playState, currentTime: item.currentTime, startTime: item.startTime })), visibility: screen && getComputedStyle(screen).visibility, stylesReady: document.documentElement.classList.contains('site-styles-ready') };
      });
      throw new Error(`${label}: opening did not exit: ${JSON.stringify({ state, errors })}`, { cause: error });
    }
    await page.locator('.hero h1').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#app').evaluate((app) => app.inert), false, `${label}: main page is interactive after opening`);
    assert.equal(await page.locator('.hero h1').isVisible(), true, `${label}: main page is visible after opening`);
    await page.reload({ waitUntil: 'commit' });
    await page.locator('#opening-screen').waitFor({ state: 'attached', timeout: 5000 });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: refresh replays the opening`);
    await page.locator('#opening-screen').waitFor({ state: 'detached', timeout: 6000 });
    assert.deepEqual(errors, [], `${label}: no browser script errors`);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/api/catalog*', (route) => route.fulfill({ json: fixture }));
  await page.goto(base + '/watches', { waitUntil: 'domcontentloaded' });
  await page.locator('#catalog-search').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#opening-screen').count(), 0, 'Direct catalog visits skip the opening');
  await page.goto(base + '/', { waitUntil: 'commit' });
  await page.locator('.hero h1').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#opening-screen').count(), 0, 'Home navigation skips the opening');
  await page.goto(base + '/watches', { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/#physical-store', { waitUntil: 'commit' });
  await page.locator('#physical-store').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#opening-screen').count(), 0, 'Physical Store link skips the opening');
  await context.close();
  console.log('Opening replays on refresh, skips Home and Physical Store navigation, and exits after three seconds.');
} finally {
  await browser.close();
}
