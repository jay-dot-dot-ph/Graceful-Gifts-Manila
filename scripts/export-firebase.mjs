import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackAssets } from './feedback-assets.mjs';
import { loadPublicCatalog } from './public-catalog.mjs';
import { writeSiteFingerprint } from './site-fingerprint.mjs';
import { build as bundle } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'hosting-dist');
const cache = resolve(root, '.image-cache');
if (!output.startsWith(root + sep) || !cache.startsWith(root + sep)) throw new Error('Build paths escaped the site checkout.');
const origin = 'https://graceful-gifts-manila.web.app';
const { default: worker, setCatalogForBuild } = await import('../dist/server/index.js');
const { catalog, embeddedImages } = await loadPublicCatalog();
if (catalog.stale || catalog.failedBrands.length || catalog.duplicateIds.length) {
  throw new Error(`Catalog is incomplete; refusing to publish a partial snapshot. Failed brands: ${catalog.failedBrands.join(', ') || 'none'}; failed image brands: ${catalog.failedImageBrands.join(', ') || 'none'}; duplicate IDs: ${catalog.duplicateIds.join(', ') || 'none'}; stale: ${catalog.stale}.`);
}
if (catalog.brands.length < 23 || catalog.sourceWatchCount !== catalog.watches.length || !catalog.watches.length) {
  throw new Error(`Unexpected source/public catalog size: ${catalog.sourceWatchCount}/${catalog.watches.length}`);
}

// Each public brand-tab workbook export is the source of truth for embedded photos.

mkdirSync(cache, { recursive: true });
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'images'), { recursive: true });
mkdirSync(join(output, 'api'), { recursive: true });
mkdirSync(join(output, 'watch'), { recursive: true });
mkdirSync(join(output, 'feedback'), { recursive: true });
const storeAvatar = join(root, 'chat', 'store-avatar.webp');
if (existsSync(storeAvatar)) {
  if (readFileSync(storeAvatar).length > 1_000_000) throw new Error('Store avatar must be under 1 MB.');
  copyFileSync(storeAvatar, join(output, 'images', 'store-avatar.webp'));
}
for (const { path, bytes } of feedbackAssets(root)) writeFileSync(join(output, path), bytes);

const imageWatches = catalog.watches.filter((watch) => watch.image || embeddedImages.has(watch.id));
let nextImage = 0;
const failures = [];
let downloaded = 0;
let thumbnailsGenerated = 0;
const extension = (type) => type.startsWith('image/jpeg') ? 'jpg' : type.startsWith('image/png') ? 'png' : type.startsWith('image/webp') ? 'webp' : null;
const imageSize = { thumbnail: 480, detail: 800 };

function resizedImageUrl(source, size) {
  if (!/=w\d+-h\d+$/.test(source)) throw new Error(`Image URL is missing its Google Sheets size suffix: ${source}`);
  return source.replace(/=w\d+-h\d+$/, `=w${size}-h${size}`);
}

function imageDimensions(bytes, type) {
  if (type === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (type === 'jpg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset < bytes.length - 9;) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  return null;
}

function writeHostedImage(id, variant, bytes, ext) {
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const filename = `${id}-${variant}-${digest}.${ext}`;
  writeFileSync(join(output, 'images', filename), bytes);
  return { path: `/images/${filename}`, dimensions: imageDimensions(bytes, ext) };
}

async function downloadImageVariant(watch, variant) {
  const size = imageSize[variant];
  const source = new URL(resizedImageUrl(watch.image, size));
  if (source.protocol !== 'https:' || source.hostname !== 'docs.google.com' || !source.pathname.startsWith('/sheets-images-rt/')) throw new Error(`Unexpected image host for ${watch.id}`);
  const urlDigest = createHash('sha256').update(source.toString()).digest('hex').slice(0, 12);
  const prefix = `${watch.id}-${variant}-${urlDigest}.`;
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
    if (!existing) throw new Error(`${watch.id} ${variant}: ${lastError?.message || 'image unavailable'}`);
  }
  const ext = existing.split('.').pop();
  return writeHostedImage(watch.id, variant, readFileSync(join(cache, existing)), ext);
}

async function downloadImage(watch) {
  const embedded = embeddedImages.get(watch.id);
  if (embedded) {
    const detail = writeHostedImage(watch.id, 'detail', embedded.bytes, embedded.extension);
    watch.localImage = detail.path;
    watch.thumbnailImage = detail.path;
    watch.image = watch.localImage;
    return;
  }
  const detail = await downloadImageVariant(watch, 'detail');
  watch.localImage = detail.path;
  watch.thumbnailImage = detail.dimensions && Math.max(detail.dimensions.width, detail.dimensions.height) <= imageSize.thumbnail
    ? detail.path
    : (await downloadImageVariant(watch, 'thumbnail')).path;
  if (watch.thumbnailImage !== detail.path) thumbnailsGenerated++;
  watch.image = watch.localImage;
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
for (const watch of catalog.watches) if (watch.localImage) watch.image = watch.localImage;
setCatalogForBuild(catalog);

const readRoute = async (path) => {
  const response = await worker.fetch(new Request(origin + path));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
};
const styles = await readRoute('/styles.css');
writeFileSync(join(output, 'styles.css'), styles);
const versionedStyles = `styles-${createHash('sha256').update(styles).digest('hex').slice(0, 12)}.css`;
writeFileSync(join(output, versionedStyles), styles);
copyFileSync(join(root, 'worker', 'admin.css'), join(output, 'admin.css'));
copyFileSync(join(root, 'worker', 'admin.html'), join(output, 'admin.html'));
await bundle({ entryPoints: [join(root, 'chat', 'customer.js'), join(root, 'chat', 'admin.js')], outdir: output, entryNames: '[name]', bundle: true, format: 'esm', splitting: true, minify: true, target: 'es2022' });
await bundle({ entryPoints: [join(root, 'chat', 'messaging-sw.js')], outfile: join(output, 'firebase-messaging-sw.js'), bundle: true, format: 'iife', minify: true, target: 'es2022' });
copyFileSync(join(output, 'customer.js'), join(output, 'chat.js'));
const adminVersion = createHash('sha256')
  .update(readFileSync(join(output, 'admin.js')))
  .update(readFileSync(join(output, 'admin.css')))
  .digest('hex').slice(0, 12);
const adminPage = readFileSync(join(output, 'admin.html'), 'utf8');
if (!adminPage.includes('href="/styles.css"') || !adminPage.includes('href="/admin.css"') || !adminPage.includes('src="/admin.js"')) {
  throw new Error('Admin page is missing its expected stylesheet or script.');
}
writeFileSync(join(output, 'admin.html'), adminPage
  .replace('href="/styles.css"', `href="/${versionedStyles}"`)
  .replace('href="/admin.css"', `href="/admin.css?v=${adminVersion}"`)
  .replace('src="/admin.js"', `src="/admin.js?v=${adminVersion}"`));
const localFirebaseConfig = join(root, 'firebase-config.local.json');
const webConfig = process.env.GGM_FIREBASE_WEB_CONFIG || (existsSync(localFirebaseConfig) ? readFileSync(localFirebaseConfig, 'utf8') : '{}');
const parsedWebConfig = JSON.parse(webConfig);
writeFileSync(join(output, 'firebase-config.json'), JSON.stringify(parsedWebConfig));
writeFileSync(join(output, 'push-config.json'), JSON.stringify({ vapidKey: process.env.GGM_FCM_VAPID_PUBLIC_KEY || '' }));
writeFileSync(join(output, 'media-config.json'), JSON.stringify({ enabled: process.env.GGM_CHAT_MEDIA_ENABLED === 'true' }));
const client = await readRoute('/app.js');
const chatImport = "import('/chat.js')";
if (!client.includes(chatImport)) throw new Error('Customer chat import was not found in the browser script.');
const chatVersion = createHash('sha256').update(readFileSync(join(output, 'chat.js'))).digest('hex').slice(0, 12);
const staticClient = client.replace("fetch('/api/catalog')", "fetch('/api/catalog.json')")
  .replaceAll(chatImport, `import('/chat.js?v=${chatVersion}')`);
if (staticClient === client) throw new Error('Catalog URL was not replaced in the browser script.');
writeFileSync(join(output, 'app.js'), staticClient);
const versionedClient = `app-${createHash('sha256').update(staticClient).digest('hex').slice(0, 12)}.js`;
writeFileSync(join(output, versionedClient), staticClient);
const versionedPage = (html) => {
  if (!html.includes('src="/app.js"')) throw new Error('Page is missing the catalog browser script.');
  if (!html.includes('href="/styles.css"')) throw new Error('Page is missing the site stylesheet.');
  return html
    .replaceAll('href="/styles.css"', `href="/${versionedStyles}"`)
    .replace('src="/app.js"', `src="/${versionedClient}"`);
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
const urls = ['/', '/watches', '/brands', '/favorites', '/contact', ...catalog.brands.map((brand) => `/watches/${brand.slug}`), ...catalog.watches.map((watch) => `/watch/${encodeURIComponent(watch.id)}`)];
writeFileSync(join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeXml(origin + path)}</loc></url>`).join('')}</urlset>`);
const { fingerprint } = writeSiteFingerprint(output);
console.log(`Firebase export ready: ${catalog.watches.length} watches, ${imageWatches.length} detail images, ${thumbnailsGenerated} responsive thumbnails (${downloaded} image variants downloaded), ${catalog.brands.length} brands.`);
console.log(`Site fingerprint: ${fingerprint}`);
