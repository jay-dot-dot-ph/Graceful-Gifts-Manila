import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'hosting-dist');
const cache = resolve(root, '.image-cache');
if (!output.startsWith(root + sep) || !cache.startsWith(root + sep)) throw new Error('Build paths escaped the site checkout.');
const origin = 'https://graceful-gifts-manila.web.app';
const { default: worker } = await import('../dist/server/index.js');
const catalogResponse = await worker.fetch(new Request(`${origin}/api/catalog`));
if (!catalogResponse.ok) throw new Error(`Live catalog returned ${catalogResponse.status}`);
const catalog = await catalogResponse.json();
if (catalog.partial || catalog.stale || catalog.failedBrands.length || catalog.duplicateIds.length) throw new Error('Catalog is incomplete; refusing to publish a partial snapshot.');
if (catalog.watches.length < 600) throw new Error(`Unexpected catalog size: ${catalog.watches.length}`);

mkdirSync(cache, { recursive: true });
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'images'), { recursive: true });
mkdirSync(join(output, 'api'), { recursive: true });
mkdirSync(join(output, 'watch'), { recursive: true });

const imageWatches = catalog.watches.filter((watch) => watch.image);
let nextImage = 0;
const failures = [];
let downloaded = 0;
const extension = (type) => type.startsWith('image/jpeg') ? 'jpg' : type.startsWith('image/png') ? 'png' : type.startsWith('image/webp') ? 'webp' : null;
async function downloadImage(watch) {
  const source = new URL(watch.image);
  if (source.protocol !== 'https:' || source.hostname !== 'docs.google.com' || !source.pathname.startsWith('/sheets-images-rt/')) throw new Error(`Unexpected image host for ${watch.id}`);
  const digest = createHash('sha256').update(watch.image).digest('hex').slice(0, 12);
  const prefix = `${watch.id}-${digest}.`;
  let existing = readdirSync(cache).find((name) => name.startsWith(prefix));
  if (!existing) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(source.toString(), { signal: AbortSignal.timeout(25000) });
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
writeFileSync(join(output, 'favicon.svg'), await readRoute('/favicon.svg'));
writeFileSync(join(output, 'robots.txt'), await readRoute('/robots.txt'));
writeFileSync(join(output, 'api', 'catalog.json'), JSON.stringify(catalog));
writeFileSync(join(output, 'index.html'), await readRoute('/'));
writeFileSync(join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found | Graceful Gifts Manila</title><meta name="viewport" content="width=device-width,initial-scale=1"><main style="font:18px system-ui;margin:12vh auto;max-width:40rem;padding:1rem"><h1>Page not found</h1><p>This address is not in the watch collection.</p><a href="/watches">Browse watches</a></main></html>');

for (const watch of catalog.watches) {
  let html = await readRoute(`/watch/${encodeURIComponent(watch.id)}`);
  if (watch.localImage) html = html.replaceAll(`/image/${encodeURIComponent(watch.id)}`, watch.localImage);
  writeFileSync(join(output, 'watch', `${watch.id}.html`), html);
}
const escapeXml = (value) => value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
const urls = ['/', '/watches', '/favorites', '/contact', ...catalog.brands.map((brand) => `/watches/${brand.slug}`), ...catalog.watches.map((watch) => `/watch/${encodeURIComponent(watch.id)}`)];
writeFileSync(join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeXml(origin + path)}</loc></url>`).join('')}</urlset>`);
console.log(`Firebase export ready: ${catalog.watches.length} watches, ${imageWatches.length} images (${downloaded} downloaded, ${imageWatches.length - downloaded} cached), ${catalog.brands.length} brands.`);
