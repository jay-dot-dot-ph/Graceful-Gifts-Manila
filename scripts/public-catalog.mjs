import { parseCsv, normalizeRows } from '../worker/index.js';
import { extractWorkbookImages } from './xlsx-images.mjs';
import { createHash } from 'node:crypto';

export const SHEET_ID = '1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8';
export const BRAND_TABS = [
  ['Audemars Piguet', 0], ['Bvlgari', 1080882635], ['Cartier', 849602461],
  ['Charriol', 1576819663], ['Coach', 450216161], ['Fossil', 42737422],
  ['Hublot', 1391385371], ['Invicta', 1085082254], ['Marc Jacobs', 1283112823],
  ['Michael Kors', 704493739], ['MoonSwatch', 1701457948], ['Omega', 1455572936],
  ['Panerai', 2108779103], ['Patek Philippe', 1004989469], ['Philip Stein', 1237273484],
  ['Rado', 1953608877], ['Tag Heuer', 784394304], ['Rolex', 1088962680],
  ['Richard Mille', 758811670], ['Richard Mille Highgrade', 1386566345],
  ['Tissot', 652473343], ['Super clone rolex', 1203455612], ['Vacheron', 439176159],
];

const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

export function extractSheetImages(html) {
  const images = new Map();
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
    const id = cells[1]?.[1]?.replace(/<[^>]+>/g, '').trim().toUpperCase();
    const source = row.match(/<img\s+src="(https:\/\/docs\.google\.com\/sheets-images-rt\/[^"]+)"/i)?.[1];
    if (/^[A-Z0-9-]{2,20}$/.test(id || '') && source) {
      images.set(id, source.replaceAll('&amp;', '&').replace(/=w\d+-h\d+$/, '=w800-h800'));
    }
  }
  return images;
}

async function download(url, label, timeout) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response;
}

async function readBrandSource([name, gid], requireImagePage = false) {
  const [csvResponse, pageResponse] = await Promise.all([
    download(`${base}/export?format=csv&gid=${gid}`, `${name} CSV`, 60000),
    download(`${base}/edit?gid=${gid}`, `${name} image page`, 60000).catch((error) => {
      if (requireImagePage) throw error;
      return null;
    }),
  ]);
  const csv = await csvResponse.text();
  const rows = parseCsv(csv);
  const pageImages = pageResponse ? extractSheetImages(await pageResponse.text()) : new Map();
  const watches = normalizeRows(csv, name, pageImages);
  const sourceFingerprint = createHash('sha256').update(JSON.stringify([name, gid, csv, [...pageImages].sort(([a], [b]) => a.localeCompare(b))])).digest('hex');
  return { name, gid, rows, pageImages, watches, sourceFingerprint };
}

async function readBrand(tab) {
  const { name, gid, rows, pageImages, watches, sourceFingerprint } = await readBrandSource(tab);
  const ids = new Set(watches.map((watch) => watch.id));
  const images = new Map();
  if (watches.some((watch) => !watch.image)) {
    const xlsxResponse = await download(`${base}/export?format=xlsx&gid=${gid}`, `${name} workbook`, 300000);
    const bytes = Buffer.from(await xlsxResponse.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 250_000_000 || bytes.readUInt32LE(0) !== 0x04034b50) {
      throw new Error(`${name} workbook export is invalid or exceeds 250 MB`);
    }
    for (const [id, image] of extractWorkbookImages(bytes, new Map([[name, rows]]))) {
      if (!ids.has(id)) throw new Error(`${name} workbook image ${id} does not match a product ID`);
      if (!pageImages.has(id)) images.set(id, image);
    }
  }
  const missingPhotos = watches.filter((watch) => !watch.image && !images.has(watch.id)).map((watch) => watch.id);
  console.log(`Read ${name}: ${watches.length} watches, ${pageImages.size} public photo links, ${images.size} workbook photos, ${missingPhotos.length} without photos.`);
  return { name, gid, watches, images, sourceFingerprint };
}

async function readTabs(tabs, reader) {
  let next = 0;
  const results = new Array(tabs.length);
  async function pool() {
    while (next < tabs.length) {
      const index = next++;
      results[index] = await reader(tabs[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, tabs.length) }, pool));
  return results;
}

const fingerprintFor = (brands) => createHash('sha256').update(brands.map((brand) => brand.sourceFingerprint).join('\n')).digest('hex');

export async function getPublicSourceFingerprint(tabs = BRAND_TABS) {
  return fingerprintFor(await readTabs(tabs, (tab) => readBrandSource(tab, true)));
}

export async function loadPublicCatalog(tabs = BRAND_TABS) {
  const results = await readTabs(tabs, readBrand);
  const watches = [], embeddedImages = new Map(), ids = new Set(), duplicateIds = [];
  for (const brand of results) {
    for (const watch of brand.watches) {
      if (ids.has(watch.id)) duplicateIds.push(watch.id);
      else { ids.add(watch.id); watches.push(watch); }
    }
    for (const [id, image] of brand.images) embeddedImages.set(id, image);
  }
  if (duplicateIds.length || !watches.length) throw new Error(`Public catalog has ${duplicateIds.length} duplicate IDs and ${watches.length} watches.`);
  return {
    catalog: {
      watches,
      brands: results.map((brand) => ({ name: brand.name, slug: slug(brand.name), gid: String(brand.gid), count: brand.watches.length })),
      sourceFingerprint: fingerprintFor(results),
      sourceWatchCount: watches.length,
      fetchedAt: new Date().toISOString(),
      partial: false, failedBrands: [], failedImageBrands: [], duplicateIds: [], stale: false,
    },
    embeddedImages,
  };
}
