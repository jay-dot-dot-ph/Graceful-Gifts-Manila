import assert from 'node:assert/strict';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const fixture = { watches: [], brands: [] };
const feedbackCount = readdirSync(resolve('feedback')).filter((name) => /\.jpe?g$/i.test(name)).length;
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
    assert.equal(await page.locator('.opening-feedback').count(), feedbackCount, `${label}: include every feedback image`);
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const screen = document.querySelector('#opening-screen');
      const brand = document.querySelector('.opening-brand').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.opening-feedback')];
      const visible = cards.filter((card) => Number(getComputedStyle(card).opacity) > 0.2);
      const overlap = visible.some((card) => {
        const rect = card.getBoundingClientRect();
        return brand.left < rect.right && brand.right > rect.left && brand.top < rect.bottom && brand.bottom > rect.top;
      });
      return {
        delay: getComputedStyle(screen).animationDelay,
        fadeDuration: getComputedStyle(screen).animationDuration,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        inert: document.querySelector('#app').inert,
        visibleCount: visible.length,
        activeCount: cards.filter((card) => card.dataset.active === 'true').length,
        overlap,
        clipped: visible.some((card) => {
          const rect = card.getBoundingClientRect();
          return rect.left < -0.01 || rect.top < -0.01 || rect.right > innerWidth + 0.01 || rect.bottom > innerHeight + 0.01;
        }),
        loaded: cards.filter((card) => card.querySelector('img').complete && card.querySelector('img').naturalWidth > 0).length,
        paths: cards.map((card) => card.querySelector('img').getAttribute('src')),
        distorted: visible.filter((card) => {
          const image = card.querySelector('img');
          if (!image.naturalWidth) return true;
          const rect = image.getBoundingClientRect();
          const x = rect.width / image.naturalWidth;
          const y = rect.height / image.naturalHeight;
          return image.naturalWidth !== Number(card.dataset.width) || image.naturalHeight !== Number(card.dataset.height) || Math.abs(x - y) > 0.005 || x >= 1 || y >= 1;
        }).length,
        animationDurations: visible.map((card) => card.getAnimations()[0]?.effect.getTiming().duration),
      };
    });
    assert.equal(state.delay, '7s', `${label}: exit should begin at seven seconds`);
    assert.equal(state.fadeDuration, label === 'tablet' ? '0.001s' : '0.55s', `${label}: fade should respect reduced motion`);
    assert.equal(state.inert, true, `${label}: homepage should not receive focus during opening`);
    assert.ok(state.scrollWidth <= state.viewportWidth + 1, `${label}: no horizontal overflow`);
    const [minimum, maximum] = label === 'desktop' ? [4, 6] : label === 'tablet' ? [3, 5] : [2, 3];
    assert.ok(state.visibleCount >= minimum && state.visibleCount <= maximum, `${label}: expected ${minimum}–${maximum} pictures together; saw ${state.visibleCount} visible / ${state.activeCount} active`);
    assert.equal(state.overlap, false, `${label}: pictures must clear the loading logo and message`);
    assert.equal(state.distorted, 0, `${label}: displayed pictures should be smaller without changing aspect ratio`);
    assert.equal(state.clipped, false, `${label}: no visible picture should leave the viewport`);
    assert.equal(state.paths.length, feedbackCount);
    assert.equal(new Set(state.paths).size, feedbackCount, `${label}: use each supplied picture`);
    assert.ok(state.paths.every((path) => /^\/feedback\/[a-f0-9]{12}\.jpg$/.test(path)), `${label}: use content-versioned original images`);
    if (label !== 'tablet') assert.ok(state.animationDurations.every((duration) => duration >= 1250 && duration <= 1950), `${label}: pictures should hold for 0.8–1.5 seconds plus gentle fades`);
    if (['desktop', 'mobile', 'short-mobile', 'landscape-mobile'].includes(label)) await page.screenshot({ path: resolve(screenshots, `opening-collage-${label}.png`) });
    for (const pause of [2000, 1900]) {
      await page.waitForTimeout(pause);
      const sample = await page.locator('.opening-feedback').evaluateAll((cards) => ({ count: cards.filter((card) => Number(getComputedStyle(card).opacity) > 0.2).length, active: cards.filter((card) => card.dataset.active === 'true').map((card) => Number(getComputedStyle(card).opacity).toFixed(2)) }));
      assert.ok(sample.count >= minimum && sample.count <= maximum, `${label}: picture count should stay within ${minimum}–${maximum}; saw ${sample.count}; active opacities ${sample.active}`);
    }
    await page.waitForFunction(() => document.querySelector('#opening-screen')?.getAnimations()[0]?.currentTime >= 6800, null, { timeout: 8000 });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: screen should still show before seven seconds`);
    const finalCount = await page.locator('.opening-feedback').evaluateAll((cards) => cards.filter((card) => Number(getComputedStyle(card).opacity) > 0.8).length);
    assert.ok(finalCount >= minimum && finalCount <= maximum, `${label}: final group should hold together; saw ${finalCount}`);
    if (label !== 'tablet') {
      await page.waitForFunction(() => document.querySelector('#opening-screen')?.getAnimations()[0]?.currentTime >= 7250, null, { timeout: 2000 });
      const fading = await page.evaluate(() => ({ screen: Number(getComputedStyle(document.querySelector('#opening-screen')).opacity), pictures: [...document.querySelectorAll('.opening-feedback[data-active="true"]')].map((card) => Number(getComputedStyle(card).opacity)) }));
      assert.ok(fading.screen < 1 && fading.screen > 0, `${label}: screen should fade after seven seconds`);
      assert.ok(fading.pictures.length >= minimum && fading.pictures.every((opacity) => opacity < 1 && opacity > 0), `${label}: final pictures should fade with the screen`);
    }
    await page.locator('#opening-screen').waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(await page.locator('#app').evaluate((app) => app.inert), false, `${label}: homepage should be interactive`);
    assert.equal(await page.locator('.opening-feedback').count(), 0, `${label}: all feedback must be removed`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#opening-screen').isVisible(), true, `${label}: opening should show on every homepage load`);
    assert.deepEqual(errors, [], `${label}: browser should not report JavaScript errors`);
    console.log(`${label}: ${state.visibleCount} pictures visible together; ${state.loaded}/${feedbackCount} loaded at 1.2 s`);
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
  console.log('Seven-second feedback collage and direct routes passed.');
} finally {
  await browser.close();
}
