import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const fixture = { watches: [], brands: [] };
const feedbackCount = readdirSync(resolve('feedback')).filter((name) => /\.jpe?g$/i.test(name)).length;
const tileCount = Math.ceil((feedbackCount + 6) / 10) * 10;
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });

try {
  for (const [label, width, height] of [['desktop', 1440, 900], ['small-desktop', 1100, 600], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: label === 'tablet' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/catalog*', (route) => route.fulfill({ json: fixture }));
    if (label === 'desktop') await page.route('**/styles.css', async (route) => {
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
        uniqueCards: screen.querySelectorAll('.opening-feedback[data-repeat="false"]').length,
        inlineImages: screen.querySelectorAll('.opening-feedback img[src^="data:image/jpeg;base64,"]').length,
      };
    });
    assert.equal(first.screenVisible && first.logoTopmost && first.appHidden, true, `${label}: opening covers the main page at first paint`);
    if (label === 'desktop') assert.equal(first.stylesReady, false, 'opening appears even while the main stylesheet is delayed');
    assert.equal(first.delay, '4s', `${label}: opening holds for four seconds`);
    assert.equal(first.duration, '0.001s', `${label}: exit has no half-second pause`);
    assert.equal(first.cards, tileCount, `${label}: feedback tiles fill the desktop grid`);
    assert.equal(first.uniqueCards, feedbackCount, `${label}: every supplied feedback picture has a tile`);
    assert.equal(first.inlineImages, tileCount, `${label}: feedback previews load with the page`);
    await page.waitForFunction(() => [...document.querySelectorAll('.opening-feedback')].some((card) => Number(getComputedStyle(card).opacity) > 0.2), null, { timeout: 3500 });
    if (label.endsWith('desktop')) {
      await page.waitForFunction((count) => [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95).length === count, tileCount, { timeout: 3500 });
      const collage = await page.evaluate(() => {
        const logo = document.querySelector('.opening-brand').getBoundingClientRect();
        const visible = [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95);
        const originals = visible.filter((card) => card.dataset.repeat === 'false');
        const coveredLogo = originals.some((card) => {
          const photo = card.getBoundingClientRect();
          return photo.left < logo.right && photo.right > logo.left && photo.top < logo.bottom && photo.bottom > logo.top;
        });
        const screen = document.querySelector('#opening-screen').getBoundingClientRect();
        const filledArea = visible.reduce((area, card) => { const tile = card.getBoundingClientRect(); return area + tile.width * tile.height; }, 0);
        return { visible: visible.length, originals: originals.length, coveredLogo, filledArea, screenArea: screen.width * screen.height };
      });
      assert.equal(collage.visible, tileCount, `${label}: every tile visible together`);
      assert.equal(collage.originals, feedbackCount, `${label}: every photo visible together`);
      assert.equal(collage.coveredLogo, false, `${label}: original photos leave the logo clear`);
      assert.ok(Math.abs(collage.filledArea - collage.screenArea) < collage.screenArea * .01, `${label}: the photo grid fills the screen`);
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
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: opening shows on repeat visits`);
    assert.deepEqual(errors, [], `${label}: no browser script errors`);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/api/catalog*', (route) => route.fulfill({ json: fixture }));
  await page.goto(base + '/watches', { waitUntil: 'domcontentloaded' });
  await page.locator('#catalog-search').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#opening-screen').count(), 0, 'Direct catalog visits skip the opening');
  await context.close();
  console.log('Opening appears before the stylesheet, shows all desktop feedback, and exits after four seconds.');
} finally {
  await browser.close();
}
