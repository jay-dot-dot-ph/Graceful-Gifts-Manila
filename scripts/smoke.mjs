import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('hosting-dist');
const catalog = JSON.parse(readFileSync(resolve(root, 'api/catalog.json'), 'utf8'));
assert.ok(catalog.watches.length > 0, 'The public Sheet should provide watches');
assert.equal(catalog.sourceWatchCount, catalog.watches.length);
assert.ok(catalog.brands.length >= 23, 'Every brand tab should be present');
assert.ok(catalog.brands.find((brand) => brand.name === 'Audemars Piguet')?.count >= 9);
assert.ok(catalog.brands.find((brand) => brand.name === 'Tag Heuer'));
assert.equal(catalog.brands.find((brand) => brand.name === 'Richard Mille')?.count, 7);
assert.ok(catalog.watches.filter((watch) => watch.brandTab === 'Richard Mille').every((watch) => watch.localImage));
assert.ok(!catalog.brands.some((brand) => brand.name === 'Brands'));
assert.deepEqual(catalog.duplicateIds, []);
assert.equal(catalog.watches.find((watch) => watch.id === 'AP-001')?.price, 5950);
assert.equal(catalog.watches.find((watch) => watch.id === 'AP-001')?.stock, 20);
const page = readFileSync(resolve(root, 'watch/AP-001.html'), 'utf8');
assert.match(page, /Audemars Piguet Royal Oak/);
for (const watch of catalog.watches.filter((item) => item.localImage)) {
  assert.ok(existsSync(resolve(root, watch.localImage.slice(1))), `Missing exported image for ${watch.id}`);
}
console.log(`Public Sheet export passed: ${catalog.watches.length} watches, ${catalog.watches.filter((watch) => watch.localImage).length} images, ${catalog.brands.length} brand tabs.`);
