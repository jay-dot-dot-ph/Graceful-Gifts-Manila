import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackAssets } from './feedback-assets.mjs';
import { extractXlsxImages } from './xlsx-images.mjs';
import { SHEET_BASE } from '../worker/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'hosting-dist');
const cache = resolve(root, '.image-cache');
if (!output.startsWith(root + sep) || !cache.startsWith(root + sep)) throw new Error('Build paths escaped the site checkout.');
const origin = 'https://graceful-gifts-manila.web.app';
const { default: worker } = await import('../dist/server/index.js');
const catalogResponse = await worker.fetch(new Request(`${origin}/api/catalog`));
if (!catalogResponse.ok) throw new Error(`Live catalog returned ${catalogResponse.status}`);
const catalog = await catalogResponse.json();
const publishedImagePaths = new Map();
if (catalog.failedImageBrands.length && !catalog.failedBrands.length) {
  const previousResponse = await fetch(`${origin}/api/catalog.json`, { signal: AbortSignal.timeout(20000) });
  if (!previousResponse.ok) throw new Error(`Published image catalog returned ${previousResponse.status}`);
  const previous = await previousResponse.json();
  const previousById = new Map(previous.watches.map((watch) => [watch.id, watch]));
  const missingTabs = new Set(catalog.failedImageBrands);
  let preserved = 0;
  for (const watch of catalog.watches) {
    if (!missingTabs.has(watch.brandTab) || watch.image) continue;
    const old = previousById.get(watch.id);
    if (old?.brandTab === watch.brandTab && old.image) {
      watch.image = old.image;
      if (/^\/images\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(old.localImage || '')) publishedImagePaths.set(watch.id, old.localImage);
      preserved++;
    }
  }
  const lost = catalog.watches.filter((watch) => missingTabs.has(watch.brandTab) && previousById.get(watch.id)?.image && !watch.image);
  if (lost.length) throw new Error(`Could not preserve ${lost.length} published images: ${lost.slice(0, 10).map((watch) => watch.id).join(', ')}`);
  catalog.imageFallbackBrands = [...missingTabs];
  catalog.failedImageBrands = [];
  catalog.partial = false;
  console.log(`Google's embedded image pages were unavailable for ${missingTabs.size} brands; preserved ${preserved} published image sources.`);
}
if (catalog.partial || catalog.stale || catalog.failedBrands.length || catalog.duplicateIds.length) {
  throw new Error(`Catalog is incomplete; refusing to publish a partial snapshot. Failed brands: ${catalog.failedBrands.join(', ') || 'none'}; failed image brands: ${catalog.failedImageBrands.join(', ') || 'none'}; duplicate IDs: ${catalog.duplicateIds.join(', ') || 'none'}; stale: ${catalog.stale}.`);
}
if (catalog.sourceWatchCount < 560 || catalog.watches.length < 560 ||
    catalog.sourceWatchCount - catalog.watches.length !== catalog.excludedMisfiledCount) {
  throw new Error(`Unexpected source/public catalog size: ${catalog.sourceWatchCount}/${catalog.watches.length}`);
}
if ((catalog.brands.find((brand) => brand.name === 'VACHERON')?.count ?? 0) < 9 ||
    catalog.watches.some((watch) => watch.brandTab === 'VACHERON' && !/^vacheron(?:\s|$)/i.test(watch.brand))) {
  throw new Error('VACHERON public catalog contains unexpected brands or too few watches.');
}

const embeddedImages = new Map();
const missingImageBrands = new Set(catalog.watches.filter((watch) => !watch.image).map((watch) => watch.brandTab));
for (const name of missingImageBrands) {
  const brand = catalog.brands.find((item) => item.name === name);
  if (!brand?.gid) throw new Error(`Missing sheet ID for ${name}`);
  const [csvResponse, xlsxResponse] = await Promise.all([
    fetch(`${SHEET_BASE}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30000) }),
    fetch(`${SHEET_BASE}/export?format=xlsx&gid=${encodeURIComponent(brand.gid)}`, { signal: AbortSignal.timeout(120000) }),
  ]);
  if (!csvResponse.ok || !xlsxResponse.ok) throw new Error(`Could not read embedded images for ${name}: CSV ${csvResponse.status}, XLSX ${xlsxResponse.status}`);
  const csv = await csvResponse.text();
  const xlsx = Buffer.from(await xlsxResponse.arrayBuffer());
  if (xlsx.length > 100_000_000) throw new Error(`XLSX export for ${name} is too large`);
  const images = extractXlsxImages(xlsx, csv);
  const brandWatches = catalog.watches.filter((watch) => watch.brandTab === name);
  const ids = new Set(brandWatches.map((watch) => watch.id));
  if ([...images.keys()].some((id) => !ids.has(id))) throw new Error(`XLSX images do not match the ${name} catalog`);
  for (const watch of brandWatches) {
    if (!watch.image && images.has(watch.id)) embeddedImages.set(watch.id, images.get(watch.id));
  }
  console.log(`Recovered ${[...embeddedImages.keys()].filter((id) => ids.has(id)).length} embedded images for ${name}.`);
}

mkdirSync(cache, { recursive: true });
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'images'), { recursive: true });
mkdirSync(join(output, 'api'), { recursive: true });
mkdirSync(join(output, 'watch'), { recursive: true });
mkdirSync(join(output, 'feedback'), { recursive: true });
mkdirSync(join(output, 'assets'), { recursive: true });
for (const { path, bytes } of feedbackAssets(root)) writeFileSync(join(output, path), bytes);
const openingBackground = readFileSync(join(root, 'assets/loading-background.jpg'));
const openingBackgroundName = `opening-bg-${createHash('sha256').update(openingBackground).digest('hex').slice(0, 12)}.jpg`;
writeFileSync(join(output, 'assets', openingBackgroundName), openingBackground);

const imageWatches = catalog.watches.filter((watch) => watch.image || embeddedImages.has(watch.id));
let nextImage = 0;
const failures = [];
let downloaded = 0;
const extension = (type) => type.startsWith('image/jpeg') ? 'jpg' : type.startsWith('image/png') ? 'png' : type.startsWith('image/webp') ? 'webp' : null;
async function downloadImage(watch) {
  const embedded = embeddedImages.get(watch.id);
  if (embedded) {
    const digest = createHash('sha256').update(embedded.bytes).digest('hex').slice(0, 12);
    const filename = `${watch.id}-${digest}.${embedded.extension}`;
    writeFileSync(join(output, 'images', filename), embedded.bytes);
    watch.localImage = `/images/${filename}`;
    watch.image = watch.localImage;
    return;
  }
  const source = new URL(watch.image);
  if (source.protocol !== 'https:' || source.hostname !== 'docs.google.com' || !source.pathname.startsWith('/sheets-images-rt/')) throw new Error(`Unexpected image host for ${watch.id}`);
  const digest = createHash('sha256').update(watch.image).digest('hex').slice(0, 12);
  const prefix = `${watch.id}-${digest}.`;
  let existing = readdirSync(cache).find((name) => name.startsWith(prefix));
  if (!existing) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const target = attempt === 2 && publishedImagePaths.has(watch.id) ? origin + publishedImagePaths.get(watch.id) : source.toString();
        const response = await fetch(target, { signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ext = extension(response.headers.get('content-type') || '');
        if (!ext) throw new Error(`Unsupported image type: ${response.headers.get('content-type')}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 100 || bytes.length > 5_000_000) throw new Error(`Unexpected image size: ${bytes.length}`);
        existing = `${prefix}${ext}`;
        writeFileSync(join(cache, existing), bytes);
        downloaded++;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (attempt + 1)));
      }
    }
    if (!existing) throw new Error(`${watch.id}: ${lastError?.message || 'image unavailable'}`);
  }
  copyFileSync(join(cache, existing), join(output, 'images', existing));
  watch.localImage = `/images/${existing}`;
}
async function imagePool() {
  while (nextImage < imageWatches.length) {
    const watch = imageWatches[nextImage++];
    try { await downloadImage(watch); }
    catch (error) { failures.push(error.message); }
  }
}
await Promise.all(Array.from({ length: 8 }, imagePool));
if (failures.length) throw new Error(`Image export failed for ${failures.length} watches: ${failures.slice(0, 12).join('; ')}`);

const readRoute = async (path) => {
  const response = await worker.fetch(new Request(origin + path));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
};
writeFileSync(join(output, 'styles.css'), await readRoute('/styles.css'));
const client = await readRoute('/app.js');
const staticClient = client.replace("fetch('/api/catalog')", "fetch('/api/catalog.json')");
if (staticClient === client) throw new Error('Catalog URL was not replaced in the browser script.');
writeFileSync(join(output, 'app.js'), staticClient);
const versionedClient = `app-${createHash('sha256').update(staticClient).digest('hex').slice(0, 12)}.js`;
writeFileSync(join(output, versionedClient), staticClient);
const versionedPage = (html) => {
  if (!html.includes('src="/app.js"')) throw new Error('Page is missing the catalog browser script.');
  return html.replace('src="/app.js"', `src="/${versionedClient}"`);
};
writeFileSync(join(output, 'favicon.svg'), await readRoute('/favicon.svg'));
writeFileSync(join(output, 'robots.txt'), await readRoute('/robots.txt'));
writeFileSync(join(output, 'api', 'catalog.json'), JSON.stringify(catalog));
writeFileSync(join(output, 'index.html'), versionedPage(await readRoute('/')));
writeFileSync(join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found | Graceful Gifts Manila</title><meta name="viewport" content="width=device-width,initial-scale=1"><main style="font:18px system-ui;margin:12vh auto;max-width:40rem;padding:1rem"><h1>Page not found</h1><p>This address is not in the watch collection.</p><a href="/watches">Browse watches</a></main></html>');

for (const watch of catalog.watches) {
  let html = versionedPage(await readRoute(`/watch/${encodeURIComponent(watch.id)}`));
  if (watch.localImage) html = html.replaceAll(`/image/${encodeURIComponent(watch.id)}`, watch.localImage);
  writeFileSync(join(output, 'watch', `${watch.id}.html`), html);
}
const escapeXml = (value) => value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
const urls = ['/', '/watches', '/favorites', '/contact', ...catalog.brands.map((brand) => `/watches/${brand.slug}`), ...catalog.watches.map((watch) => `/watch/${encodeURIComponent(watch.id)}`)];
writeFileSync(join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeXml(origin + path)}</loc></url>`).join('')}</urlset>`);
console.log(`Firebase export ready: ${catalog.watches.length} watches, ${imageWatches.length} images (${downloaded} downloaded, ${imageWatches.length - downloaded} cached), ${catalog.brands.length} brands.`);
