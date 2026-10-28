import assert from 'node:assert/strict';
import { classifyNetworkRequest, summarizeNetworkEntries } from './network-classification.mjs';

const previewOrigin = 'http://127.0.0.1:4173';

assert.equal(
  classifyNetworkRequest(`${previewOrigin}/images/AP-001-thumbnail.webp`, previewOrigin).kind,
  'first-party',
  'the exact preview origin must count toward Firebase Hosting totals',
);
assert.equal(
  classifyNetworkRequest('https://fonts.googleapis.com/css2?family=Inter', previewOrigin).kind,
  'google-fonts',
  'Google Fonts stylesheet requests must be reported separately',
);
assert.equal(
  classifyNetworkRequest('https://fonts.gstatic.com/s/inter.woff2', previewOrigin).kind,
  'google-fonts',
  'Google Fonts font-file requests must be reported separately',
);
assert.equal(
  classifyNetworkRequest('https://cdn.example.test/app.js', previewOrigin).kind,
  'unexpected-third-party',
  'unapproved third-party requests must remain benchmark failures',
);
assert.equal(
  classifyNetworkRequest('http://127.0.0.1:4173.example.test/app.js', previewOrigin).kind,
  'unexpected-third-party',
  'a URL that only shares the preview-origin prefix must not count as Firebase Hosting traffic',
);

const summary = summarizeNetworkEntries([
  { url: `${previewOrigin}/app.js`, status: 200, encodedDataLength: 120, fromDiskCache: false, fromServiceWorker: false },
  { url: `${previewOrigin}/images/AP-001-thumbnail.webp`, status: 304, encodedDataLength: 0, fromDiskCache: false, fromServiceWorker: false },
  { url: 'https://fonts.googleapis.com/css2?family=Inter', status: 200, encodedDataLength: 80, fromDiskCache: false, fromServiceWorker: false },
  { url: 'https://fonts.gstatic.com/s/inter.woff2', status: 200, encodedDataLength: 0, fromDiskCache: true, fromServiceWorker: false },
  { url: 'https://cdn.example.test/app.js', status: 200, encodedDataLength: 999, fromDiskCache: false, fromServiceWorker: false },
], previewOrigin, (entry) => entry.url.includes('/images/') ? 'product images' : 'scripts/styles');

assert.deepEqual(summary.hosting, {
  transferredBytes: 120,
  requestCount: 2,
  cacheHits: 1,
  categories: {
    'scripts/styles': { transferredBytes: 120, requestCount: 1, cacheHits: 0 },
    'product images': { transferredBytes: 0, requestCount: 1, cacheHits: 1 },
  },
});
assert.deepEqual(summary.googleFonts, { transferredBytes: 80, requestCount: 2, cacheHits: 1 });
assert.equal(summary.unexpected.length, 1);
assert.equal(summary.unexpected[0].url, 'https://cdn.example.test/app.js');

console.log('Network benchmark request classification passed.');
