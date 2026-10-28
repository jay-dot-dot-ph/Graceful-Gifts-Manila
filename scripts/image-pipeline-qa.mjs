import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'hosting-dist');
const catalogPath = resolve(output, 'api/catalog.json');
assert.ok(existsSync(catalogPath), 'Run npm run build:firebase before image pipeline QA.');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

function dimensions(bytes, extension) {
  if (extension === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (extension === 'jpg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
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

function localFile(url) {
  assert.match(url, /^\/images\/[A-Za-z0-9._-]+$/, `Invalid hosted image URL: ${url}`);
  const file = resolve(output, url.slice(1));
  assert.ok(file.startsWith(output), `Image escaped hosting output: ${url}`);
  assert.ok(existsSync(file), `Missing exported image: ${url}`);
  return file;
}

const ids = new Set();
let thumbnails = 0;
for (const watch of catalog.watches) {
  assert.match(watch.id || '', /^[A-Z0-9-]{2,20}$/, `Invalid watch ID: ${watch.id}`);
  assert.ok(!ids.has(watch.id), `Duplicate watch ID: ${watch.id}`);
  ids.add(watch.id);
  assert.ok(watch.localImage, `Missing detail image for ${watch.id}`);
  assert.ok(watch.thumbnailImage, `Missing thumbnail image for ${watch.id}`);
  const detailFile = localFile(watch.localImage);
  const thumbnailFile = localFile(watch.thumbnailImage);
  assert.match(watch.localImage, new RegExp(`^/images/${watch.id}-detail-[a-f0-9]{12}\\.(jpg|png|webp)$`), `Detail image is not content versioned for ${watch.id}`);
  assert.match(watch.thumbnailImage, new RegExp(`^/images/${watch.id}-(detail|thumbnail)-[a-f0-9]{12}\\.(jpg|png|webp)$`), `Thumbnail image is not content versioned for ${watch.id}`);
  const detailExtension = detailFile.split('.').pop();
  const thumbnailExtension = thumbnailFile.split('.').pop();
  const detail = dimensions(readFileSync(detailFile), detailExtension);
  const thumbnail = dimensions(readFileSync(thumbnailFile), thumbnailExtension);
  if (detail) assert.ok(Math.max(detail.width, detail.height) <= 800, `Detail image exceeds the 800px source bound for ${watch.id}`);
  if (thumbnail && watch.thumbnailImage !== watch.localImage) {
    thumbnails++;
    assert.ok(Math.max(thumbnail.width, thumbnail.height) <= 480, `Thumbnail exceeds 480px for ${watch.id}`);
  }
}

const client = readFileSync(resolve(root, 'worker/client.js'), 'utf8');
assert.match(client, /thumbnailImage/, 'Catalog cards must support thumbnail images.');
assert.match(client, /srcset=/, 'Catalog cards must expose responsive sources.');
assert.match(client, /sizes="\(max-width: 760px\)/, 'Catalog cards must describe their responsive display size.');
assert.match(client, /watch\.thumbnailImage \|\| watch\.localImage/, 'Chat product references must prefer thumbnails while retaining the detail fallback.');
const firebase = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
assert.ok(firebase.hosting.headers.some((entry) => entry.source === '/images/**' && /immutable/.test(entry.headers?.[0]?.value || '')), 'Content-hashed images require immutable cache headers.');

console.log(`Image pipeline QA passed: ${catalog.watches.length} watches, ${thumbnails} generated thumbnails, ${ids.size} stable catalog mappings.`);
