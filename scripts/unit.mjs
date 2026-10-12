import assert from 'node:assert/strict';
import { parseCsv, normalizeRows, extractImages, discoverTabs } from '../worker/index.js';

assert.deepEqual(parseCsv('a,b\n"hello, world","line 1\nline 2"'), [['a','b'], ['hello, world','line 1\nline 2']]);
const header = ['Image','Watch ID','Brand','Model Name','Size','Category','Dial Color','Case Material','Strap Material','Movement Type','Price (PHP)','Stock Quantity','Description','Image URL','Upload Status','Date Added','Water Resistance','Box Inclusions'].join(',');
const csv = `${header}\n,i-W001,Invicta,Pro Diver,40MM,,Black,Steel,Steel,Automatic,"5,950",0,Test description,,,2026-10-01,50M,"Brand Box, Warranty Card"\n,W156,Vacheron,Overseas,41MM,,Blue,Steel,Steel,Automatic,"8,950",,Details,,,,,`;
const watches = normalizeRows(csv, 'INVICTA');
assert.equal(watches.length, 2);
assert.equal(watches[0].id, 'I-W001');
assert.equal(watches[0].price, 5950);
assert.equal(watches[0].stock, 0);
assert.equal(watches[0].waterResistance, '50M');
assert.equal(watches[0].boxInclusions, 'Brand Box, Warranty Card');
assert.equal(watches[1].id, 'W156');
assert.equal(watches[1].stock, null);
const html = '<tr><th>2</th><td><img src="https://docs.google.com/sheets-images-rt/abc=w100-h106"></td><td>W156</td></tr>';
assert.equal(extractImages(html).get('W156'), 'https://docs.google.com/sheets-images-rt/abc=w800-h800');
const sheetHtml = '<div class="docs-sheet-tab-caption">CATEGORIES</div><div class="docs-sheet-tab-caption">AP</div><div class="docs-sheet-tab-caption">Super clone Rolex</div>'
  + String.raw`[{\"3\":[2,\"AP\"],\"6\":1,\"24\":\"#gid\\u003d1994018057\"}],[{\"3\":[2,\"Super clone Rolex\"],\"6\":1,\"24\":\"#gid\\u003d311075382\"}]`;
assert.deepEqual(discoverTabs(sheetHtml), [['AP', '1994018057'], ['Super clone Rolex', '311075382']]);
assert.throws(() => discoverTabs('<div class="docs-sheet-tab-caption">AP</div>'), /Could not discover every brand tab/);
console.log('Catalog parser and stock-state checks passed.');
