import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const fixture = { watches: [], brands: [] };
const feedbackCount = readdirSync(resolve('feedback')).filter((name) => /\.jpe?g$/i.test(name)).length;
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
      };
    });
    assert.equal(first.screenVisible && first.logoTopmost && first.appHidden, true, `${label}: opening covers the main page at first paint`);
    if (label === 'desktop') assert.equal(first.stylesReady, false, 'opening appears even while the main stylesheet is delayed');
    assert.equal(first.delay, '7s', `${label}: opening still holds for seven seconds`);
    assert.equal(first.duration, '0.001s', `${label}: exit has no half-second pause`);
    assert.equal(first.cards, feedbackCount, `${label}: all supplied feedback pictures remain in the opening`);
    await page.waitForFunction(() => [...document.querySelectorAll('.opening-feedback')].some((card) => Number(getComputedStyle(card).opacity) > 0.2), null, { timeout: 3500 });
    if (label.endsWith('desktop')) {
      await page.waitForFunction((count) => [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95).length === count, feedbackCount, { timeout: 5000 });
      const collage = await page.evaluate(() => {
        const logo = document.querySelector('.opening-brand').getBoundingClientRect();
        const visible = [...document.querySelectorAll('.opening-feedback')].filter((card) => Number(getComputedStyle(card).opacity) >= 0.95);
        const coveredLogo = visible.some((card) => {
          const photo = card.getBoundingClientRect();
          return photo.left < logo.right && photo.right > logo.left && photo.top < logo.bottom && photo.bottom > logo.top;
        });
        return { visible: visible.length, coveredLogo };
      });
      assert.equal(collage.visible, feedbackCount, `${label}: every photo visible together`);
      assert.equal(collage.coveredLogo, false, 'desktop: photos leave the logo clear');
    }
    try {
      await page.locator('#opening-screen').waitFor({ state: 'detached', timeout: 9000 });
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
  console.log('Opening appears before the stylesheet, retains feedback and seven-second hold, then shows the main page immediately.');
} finally {
  await browser.close();
}
