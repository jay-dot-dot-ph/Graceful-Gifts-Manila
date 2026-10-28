import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { summarizeNetworkEntries } from './network-classification.mjs';

const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const baseOrigin = new URL(base).origin;
const output = resolve(process.env.NETWORK_BENCHMARK_DIR || '.sites-runtime');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined);
mkdirSync(output, { recursive: true });

function category(entry) {
  const path = new URL(entry.url).pathname;
  if (path.startsWith('/images/')) return 'product images';
  if (path === '/api/catalog.json') return 'catalog JSON';
  if (/\/chat\.js$|\/customer\.js$|\/firebase-config\.json$|\/push-config\.json$|\/media-config\.json$/.test(path)) return 'chat assets';
  if (entry.type === 'Document' || path.endsWith('.html') || !path.includes('.')) return 'page HTML';
  if (/\.(?:js|css)$/.test(path)) return 'scripts/styles';
  return 'other';
}

function networkProbe(page) {
  const entries = [];
  const byId = new Map();
  const client = page.context().newCDPSession(page);
  const ready = client.then(async (cdp) => {
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', (event) => {
      const entry = { id: event.requestId, url: event.request.url, type: event.type, status: null, encodedDataLength: 0, fromDiskCache: false, fromServiceWorker: false };
      entries.push(entry);
      byId.set(event.requestId, entry);
    });
    cdp.on('Network.responseReceived', (event) => {
      const entry = byId.get(event.requestId);
      if (!entry) return;
      entry.status = event.response.status;
      entry.fromDiskCache = event.response.fromDiskCache === true;
      entry.fromServiceWorker = event.response.fromServiceWorker === true;
      entry.mimeType = event.response.mimeType;
    });
    cdp.on('Network.loadingFinished', (event) => {
      const entry = byId.get(event.requestId);
      if (entry) entry.encodedDataLength = event.encodedDataLength || 0;
    });
  });
  return {
    async mark() { await ready; return entries.length; },
    async summary(from) {
      await ready;
      const measured = entries.slice(from);
      const totals = summarizeNetworkEntries(measured, baseOrigin, category);
      assert.equal(
        totals.unexpected.length,
        0,
        `Benchmark found unexpected third-party transfers: ${totals.unexpected.map((item) => item.url).join(', ')}`,
      );
      return {
        ...totals.hosting,
        googleFonts: totals.googleFonts,
      };
    },
  };
}

async function settle(page) {
  await page.waitForTimeout(600);
}

async function loadCards(page, count) {
  await page.locator('.watch-card').nth(count - 1).waitFor({ timeout: 30000 });
  for (let index = 0; index < count; index++) await page.locator('.watch-card').nth(index).scrollIntoViewIfNeeded();
  await page.waitForFunction((target) => [...document.querySelectorAll('.watch-card img')].length >= target && [...document.querySelectorAll('.watch-card img')].every((image) => image.complete && image.naturalWidth > 0), count, { timeout: 30000 });
}

async function withColdPage(browser, name, action) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  const probe = networkProbe(page);
  const marker = await probe.mark();
  await action(page);
  await settle(page);
  const result = { scenario: name, cache: 'cold', ...(await probe.summary(marker)) };
  await context.close();
  return result;
}

function markdown(report) {
  const bytes = (value) => new Intl.NumberFormat('en-US').format(value);
  const lines = [
    '# Local browser transfer benchmark',
    '',
    'Measured with Chromium CDP `Network.loadingFinished.encodedDataLength` against the local preview. Firebase Hosting totals include only the exact local preview origin. Google Fonts traffic is reported separately and excluded from Hosting totals; any other third-party request fails the benchmark. Cache hits use CDP disk-cache/service-worker/status/zero-transfer evidence. Values are directional and are not Firebase CDN or monthly Hosting usage measurements.',
    '',
    '| Scenario | Cache | Firebase Hosting transfer bytes | Hosting requests | Hosting cache hits | Google Fonts transfer bytes | Google Fonts requests | Google Fonts cache hits |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.scenarios.map((item) => {
      const fonts = item.googleFonts || { transferredBytes: 0, requestCount: 0, cacheHits: 0 };
      return `| ${item.scenario} | ${item.cache} | ${bytes(item.transferredBytes)} | ${item.requestCount} | ${item.cacheHits} | ${bytes(fonts.transferredBytes)} | ${fonts.requestCount} | ${fonts.cacheHits} |`;
    }),
  ];
  for (const item of report.scenarios) {
    lines.push('', `## ${item.scenario} (${item.cache})`, '', '| Category | Transfer bytes | Requests | Cache hits |', '| --- | ---: | ---: | ---: |');
    for (const [name, value] of Object.entries(item.categories)) lines.push(`| ${name} | ${bytes(value.transferredBytes)} | ${value.requestCount} | ${value.cacheHits} |`);
  }
  lines.push('', 'A same-catalog Phase-2 legacy-format build was not executed in this job, so no real before/after network-transfer reduction is claimed. The recorded Phase-2 artifact baseline is reported separately by `npm run report:performance`.');
  return `${lines.join('\n')}\n`;
}

const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const scenarios = [];
let activePage;
try {
  scenarios.push(await withColdPage(browser, 'home', async (page) => {
    activePage = page;
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.hero h1').waitFor({ timeout: 30000 });
    await page.locator('.hero-visual img').waitFor({ timeout: 30000 });
    await page.screenshot({ path: resolve(output, 'network-benchmark-home.png') });
  }));
  scenarios.push(await withColdPage(browser, 'catalog-first-24', async (page) => {
    activePage = page;
    await page.goto(`${base}/watches`, { waitUntil: 'domcontentloaded' });
    await loadCards(page, 24);
    await page.screenshot({ path: resolve(output, 'network-benchmark-catalog.png') });
  }));
  scenarios.push(await withColdPage(browser, 'watch-detail', async (page) => {
    activePage = page;
    await page.goto(`${base}/watch/AP-001`, { waitUntil: 'domcontentloaded' });
    await page.locator('.detail-copy h1').waitFor({ timeout: 30000 });
  }));
  scenarios.push(await withColdPage(browser, 'customer-inquiry-preview', async (page) => {
    activePage = page;
    await page.route(/\/chat\.js(?:\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: 'export async function openChat(products) { window.__benchmarkInquiry = products; } export async function watchChat() {}' }));
    await page.goto(`${base}/watch/AP-001`, { waitUntil: 'domcontentloaded' });
    await page.locator('.inquiry-button').click();
    await page.waitForFunction(() => window.__benchmarkInquiry?.length === 1, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__benchmarkInquiry[0].id), 'AP-001');
  }));

  const warmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const warmPage = await warmContext.newPage();
  activePage = warmPage;
  const warmProbe = networkProbe(warmPage);
  const initial = await warmProbe.mark();
  await warmPage.goto(`${base}/watches`, { waitUntil: 'domcontentloaded' });
  await loadCards(warmPage, 24);
  await settle(warmPage);
  scenarios.push({ scenario: 'catalog-first-24', cache: 'warm-prime', ...(await warmProbe.summary(initial)) });
  const refresh = await warmProbe.mark();
  await warmPage.reload({ waitUntil: 'domcontentloaded' });
  await loadCards(warmPage, 24);
  await settle(warmPage);
  scenarios.push({ scenario: 'catalog-refresh', cache: 'warm', ...(await warmProbe.summary(refresh)) });
  const more = await warmProbe.mark();
  await warmPage.locator('[data-load-more]').click();
  await loadCards(warmPage, 48);
  await settle(warmPage);
  scenarios.push({ scenario: 'catalog-additional-24', cache: 'warm', ...(await warmProbe.summary(more)) });
  await warmContext.close();

  const report = { schemaVersion: 2, base, firstPartyOrigin: baseOrigin, viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 }, scenarios };
  writeFileSync(resolve(output, 'network-benchmark.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(output, 'network-benchmark.md'), markdown(report));
  console.log(markdown(report));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: resolve(output, 'network-benchmark-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
