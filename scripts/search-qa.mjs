import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const errors = [];
try {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.goto(base + '/');
  await phone.locator('.hero h1').waitFor();
  await phone.waitForFunction(() => getComputedStyle(document.querySelector('.search-shortcut')).display === 'grid');
  await phone.locator('[data-search-toggle]').tap();
  assert.equal(await phone.locator('#header-search-panel').isVisible(), true);
  assert.equal(await phone.locator('[data-search-toggle]').getAttribute('aria-expanded'), 'true');
  assert.equal(await phone.locator('#header-search-input').evaluate((input) => input === document.activeElement), true);
  await phone.locator('#header-search-input').fill('MS-007');
  await phone.locator('#header-search-input').press('Enter');
  await phone.waitForURL('**/watches?q=MS-007');
  await phone.locator('.watch-card').first().waitFor();
  assert.equal(await phone.locator('#result-count').innerText(), '1 watch');
  assert.match(await phone.locator('.watch-card').first().innerText(), /Mission to Pluto/);
  await phone.locator('[data-search-toggle]').tap();
  assert.equal(await phone.locator('#header-search-input').inputValue(), 'MS-007');
  await phone.keyboard.press('Escape');
  assert.equal(await phone.locator('#header-search-panel').isVisible(), false);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/watch/MS-007');
  await page.locator('.detail-page h1').waitFor();
  await page.locator('[data-search-toggle]').click();
  assert.equal(await page.locator('#header-search-panel').isVisible(), true);
  await page.locator('#header-search-input').fill('MS-009');
  await page.locator('.header-search-submit').click();
  await page.waitForURL('**/watches?q=MS-009');
  await page.locator('.watch-card').first().waitFor();
  assert.equal(await page.locator('#result-count').innerText(), '1 watch');
  assert.deepEqual(errors, []);
  console.log('Header search QA passed: phone and desktop open search and return matching watch results.');
} finally {
  await browser.close();
}
