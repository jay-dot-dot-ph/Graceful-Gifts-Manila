import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const client = readFileSync(new URL('../worker/client.js', import.meta.url));
const catalog = { watches: [
  { id: 'AP-001', brand: 'Audemars Piguet', brandSlug: 'audemars-piguet', model: 'Royal Oak', price: 5950, stock: 1 },
  { id: 'MK-001', brand: 'Michael Kors', brandSlug: 'michael-kors', model: 'Chronograph', price: 3950, stock: 0 }
] };
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(client); return; }
  if (request.url === '/api/catalog') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(catalog)); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<div id="app"></div><script>window.GGM_CONFIG={messenger:"https://m.me/GracefulGifts.Manila",facebook:"https://www.facebook.com/GracefulGifts.Manila"}</script><script src="/app.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('https://m.me/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Messenger</title>' }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/watch/AP-001');
  await page.locator('.inquiry-button').waitFor();
  assert.match(await page.locator('.inquiry-button').innerText(), /Send a message/);
  const [singlePopup] = await Promise.all([page.waitForEvent('popup'), page.locator('.inquiry-button').click()]);
  await singlePopup.waitForURL('https://m.me/GracefulGifts.Manila');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Hello! Is Audemars Piguet Royal Oak still available\?\nWatch ID: AP-001\n.*\/watch\/AP-001$/);
  await singlePopup.close();

  await page.goto(base + '/watch/MK-001');
  await page.locator('.inquiry-button').waitFor();
  const [soldOutPopup] = await Promise.all([page.waitForEvent('popup'), page.locator('.inquiry-button').click()]);
  await soldOutPopup.waitForURL('https://m.me/GracefulGifts.Manila');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Do you have another unit of Michael Kors Chronograph or a similar watch available\?/);
  await soldOutPopup.close();

  await page.goto(base + '/favorites');
  await page.evaluate(() => localStorage.setItem('ggm-favorites', JSON.stringify(['AP-001', 'MK-001'])));
  await page.reload();
  await page.locator('[data-select-all]').click();
  const [selectedPopup] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-inquire-selected]').click()]);
  await selectedPopup.waitForURL('https://m.me/GracefulGifts.Manila');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /AP-001[\s\S]*MK-001/);
  await selectedPopup.close();
  assert.deepEqual(errors, []);
  console.log('Inquiry clipboard and Messenger checks passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
