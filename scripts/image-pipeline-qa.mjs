import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAlpha, imageDimensions, imageMime, inspectWithImageMagick } from './image-tools.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'hosting-dist');
const imagesRoot = resolve(output, 'images');
const productionOrigin = 'https://graceful-gifts-manila.web.app';
const catalogPath = resolve(output, 'api/catalog.json');
const reportPath = resolve(output, 'api/image-pipeline-report.json');
assert.ok(existsSync(catalogPath) && existsSync(reportPath), 'Run npm run build:firebase before image pipeline QA.');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const supported = new Set(Object.keys(imageMime));

function localFile(url) {
  assert.match(url, /^\/images\/[A-Za-z0-9._-]+$/, `Invalid hosted image URL: ${url}`);
  const file = resolve(output, url.slice(1));
  assert.ok(file.startsWith(imagesRoot + '\\') || file.startsWith(imagesRoot + '/'), `Image escaped hosting output: ${url}`);
  assert.ok(existsSync(file), `Missing exported image: ${url}`);
  return file;
}

function actualExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'webp';
  return null;
}

const ids = new Set();
const imageReferences = new Set();
let generatedThumbnails = 0;
for (const watch of catalog.watches) {
  assert.match(watch.id || '', /^[A-Z0-9-]{2,20}$/, `Invalid watch ID: ${watch.id}`);
  assert.ok(!ids.has(watch.id), `Duplicate watch ID: ${watch.id}`);
  ids.add(watch.id);
  assert.ok(watch.localImage, `Missing detail image for ${watch.id}`);
  assert.ok(watch.thumbnailImage, `Missing thumbnail image for ${watch.id}`);
  const detailFile = localFile(watch.localImage);
  const thumbnailFile = localFile(watch.thumbnailImage);
  const page = readFileSync(resolve(output, 'watch', `${watch.id}.html`), 'utf8');
  assert.ok(page.includes(`src="${watch.localImage}"`), `Watch page visible image must be same-origin for ${watch.id}`);
  assert.ok(page.includes(`<meta property="og:image" content="${productionOrigin}${watch.localImage}">`), `Watch page Open Graph image must keep its absolute canonical URL for ${watch.id}`);
  assert.doesNotMatch(page, /<img\b[^>]*\bsrc="https:\/\/graceful-gifts-manila\.web\.app\/images\//, `Watch page must not embed a production-hosted visible image for ${watch.id}`);
  assert.match(watch.localImage, new RegExp(`^/images/${watch.id}-detail-[a-f0-9]{12}\\.(jpg|png|webp)$`), `Detail image is not content versioned for ${watch.id}`);
  assert.match(watch.thumbnailImage, new RegExp(`^/images/${watch.id}-(detail|thumbnail)-[a-f0-9]{12}\\.(jpg|png|webp)$`), `Thumbnail image is not content versioned for ${watch.id}`);
  imageReferences.add(watch.localImage);
  imageReferences.add(watch.thumbnailImage);
  if (watch.thumbnailImage !== watch.localImage) generatedThumbnails++;
  for (const [variant, file, maximum] of [['detail', detailFile, 800], ['thumbnail', thumbnailFile, 480]]) {
    const extension = file.split('.').pop().toLowerCase();
    const bytes = readFileSync(file);
    assert.ok(supported.has(extension), `Unsupported ${variant} extension for ${watch.id}: ${extension}`);
    assert.equal(actualExtension(bytes), extension, `${variant} extension and encoded format differ for ${watch.id}`);
    const dimensions = imageDimensions(bytes, extension);
    assert.ok(dimensions, `${variant} ${imageMime[extension]} dimensions are unreadable for ${watch.id}`);
    assert.ok(Math.max(dimensions.width, dimensions.height) <= maximum, `${variant} image exceeds ${maximum}px for ${watch.id}`);
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    assert.match(file, new RegExp(`-${digest}\\.${extension}$`), `${variant} filename must hash final emitted bytes for ${watch.id}`);
  }
}

assert.equal(report.schemaVersion, 1, 'Image pipeline report schema must be recognized.');
assert.equal(report.sourceImageCount, catalog.watches.length, 'Every catalog watch must have an image export source.');
assert.deepEqual(report.settings.maximumDimensions, { thumbnail: 480, detail: 800 }, 'Image size limits changed unexpectedly.');
assert.deepEqual(report.settings.webpQuality, { thumbnail: 80, detail: 85 }, 'WebP quality settings changed unexpectedly.');
assert.ok(report.emittedFormatCounts.webp > 0, 'Expected at least one smaller WebP derivative.');
assert.equal(new Set(report.images.map((image) => image.path)).size, report.images.length, 'Image pipeline report contains duplicate output paths.');
for (const image of report.images) {
  assert.ok(imageReferences.has(image.path), `Unreferenced generated product image: ${image.path}`);
  assert.ok(existsSync(resolve(root, '.image-cache', image.sourceCacheFile)), `Missing source cache entry for ${image.path}`);
  assert.ok(supported.has(image.emittedFormat), `Unknown emitted format for ${image.path}`);
  assert.equal(image.emittedBytes, readFileSync(localFile(image.path)).length, `Recorded byte size differs for ${image.path}`);
  if (image.sourceHasAlpha) assert.equal(image.emittedHasAlpha, true, `Transparency was not preserved for ${image.path}`);
  if (image.emittedFormat === 'webp') assert.equal(image.fallbackReason, null, `WebP output should not have a fallback reason for ${image.path}`);
}

const generatedFiles = readdirSync(imagesRoot)
  .filter((name) => /^[A-Z0-9-]+-(?:detail|thumbnail)-[a-f0-9]{12}\.(?:jpg|png|webp)$/.test(name))
  .map((name) => `/images/${name}`);
assert.deepEqual(new Set(generatedFiles), imageReferences, 'Generated product output contains missing or unreferenced files.');

const decoded = inspectWithImageMagick([...imageReferences].map(localFile));
assert.equal(decoded.length, imageReferences.size, 'ImageMagick did not decode every emitted product image.');
for (const [index, line] of decoded.entries()) {
  const [format, width, height, channels] = line.split('|');
  const file = localFile([...imageReferences][index]);
  const extension = file.split('.').pop().toLowerCase();
  assert.equal(format.toLowerCase(), extension === 'jpg' ? 'jpeg' : extension, `ImageMagick format mismatch for ${file}`);
  const parsed = imageDimensions(readFileSync(file), extension);
  assert.equal(Number(width), parsed.width, `ImageMagick width mismatch for ${file}`);
  assert.equal(Number(height), parsed.height, `ImageMagick height mismatch for ${file}`);
  if (hasAlpha(readFileSync(file), extension)) assert.match(channels.toLowerCase(), /a/, `ImageMagick did not retain alpha for ${file}`);
}

const client = readFileSync(resolve(root, 'worker/client.js'), 'utf8');
assert.match(client, /thumbnailImage/, 'Catalog cards must support thumbnail images.');
assert.match(client, /srcset=/, 'Catalog cards must expose responsive sources.');
assert.match(client, /sizes="\(max-width: 760px\)/, 'Catalog cards must describe their responsive display size.');
assert.match(client, /watch\.thumbnailImage \|\| watch\.localImage/, 'Chat product references must prefer thumbnails while retaining the detail fallback.');
const firebase = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
assert.ok(firebase.hosting.headers.some((entry) => entry.source === '/images/**' && /immutable/.test(entry.headers?.[0]?.value || '')), 'Content-hashed images require immutable cache headers.');

console.log(`Image pipeline QA passed: ${catalog.watches.length} watches, ${generatedThumbnails} generated thumbnails, ${report.emittedFormatCounts.webp} WebP files, ${Object.values(report.fallbackCounts).reduce((sum, count) => sum + count, 0)} validated original-format fallbacks.`);
