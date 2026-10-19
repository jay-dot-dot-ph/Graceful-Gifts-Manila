import assert from 'node:assert/strict';
import { parseCsv, normalizeRows, getCatalog, setCatalogForBuild } from '../worker/index.js';
import { extractSheetImages, loadPublicCatalog, SHEET_ID, BRAND_TABS } from './public-catalog.mjs';
import { extractWorkbookImages } from './xlsx-images.mjs';

function storedZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const path = Buffer.from(name);
    const body = Buffer.from(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(path.length, 26);
    locals.push(local, path, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(path.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, path);
    offset += local.length + path.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

assert.deepEqual(parseCsv('a,b\n"hello, world","line 1\nline 2"'), [['a','b'], ['hello, world','line 1\nline 2']]);
const header = ['Image','Watch ID','Model Name','Size','Dial Color','Case Material','Strap Material','Movement Type','Price (PHP)','Stock Quantity','Description','Date Added'].join(',');
const csv = `${header}\n,inv-001,Invicta Pro Diver,40MM,Black,Steel,Steel,Automatic,"5,950",0,Test description,2026-10-15\n,inv-002,Invicta Specialty,41MM,Blue,Steel,Steel,Automatic,"8,950",,Details,2026-10-16`;
const watches = normalizeRows(csv, 'Invicta');
assert.equal(watches.length, 2);
assert.equal(watches[0].id, 'INV-001');
assert.equal(watches[0].brand, 'Invicta');
assert.equal(watches[0].model, 'Invicta Pro Diver');
assert.equal(watches[0].dialColor, 'Black');
assert.equal(watches[0].dateAdded, '2026-10-15');
assert.equal(watches[0].price, 5950);
assert.equal(watches[0].stock, 0);
assert.equal(watches[1].id, 'INV-002');
assert.equal(watches[1].stock, null);
assert.equal(normalizeRows(`${header}\n,rm-001,RM 35-02,,,,,,"5,950",1,,\n,hb-w040,,,,,,,,,,`, 'Richard Mille').length, 1);
assert.deepEqual(normalizeRows(header, 'Tag Heuer'), []);
assert.throws(() => normalizeRows('Watch ID,Model Name\nabc,Example', 'Broken'), /Missing price \(php\) column/);
await assert.rejects(getCatalog(), /static build/);
setCatalogForBuild({ watches, brands: [{ name: 'Invicta', count: 2 }] });
assert.equal((await getCatalog()).watches[0].id, 'INV-001');
assert.equal(BRAND_TABS.length, 23);
assert.equal(SHEET_ID, '1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8');
assert.equal(extractSheetImages('<tr><td><img src="https://docs.google.com/sheets-images-rt/example=w100-h120"></td><td>ap-001</td></tr>').get('AP-001'), 'https://docs.google.com/sheets-images-rt/example=w800-h800');
const workbook = storedZip([
  ['xl/workbook.xml', '<workbook><sheets><sheet name="Audemars Piguet" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml', '<worksheet><drawing r:id="rId2"/></worksheet>'],
  ['xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="rId2" Target="../drawings/drawing1.xml"/></Relationships>'],
  ['xl/drawings/drawing1.xml', '<xdr:wsDr><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>1</xdr:row></xdr:from><a:blip r:embed="rId3"/></xdr:oneCellAnchor></xdr:wsDr>'],
  ['xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="rId3" Target="../media/image1.png"/></Relationships>'],
  ['xl/media/image1.png', 'mock-image'],
]);
const workbookImages = extractWorkbookImages(workbook, new Map([['Audemars Piguet', [['Image', 'Watch ID'], ['', 'ap-001']]]]));
assert.equal(workbookImages.get('AP-001')?.bytes.toString(), 'mock-image');
const oldFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`) {
    return new Response(`${header}\n,ap-001,Audemars Piguet Royal Oak,42mm,Blue,Steel,Steel,Automatic,"5,950",20,Details,2026-10-15`);
  }
  if (url === `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx&gid=0`) return new Response(workbook);
  throw new Error(`Unexpected public source request: ${url}`);
};
try {
  const result = await loadPublicCatalog([['Audemars Piguet', 0]]);
  assert.equal(result.catalog.watches[0].id, 'AP-001');
  assert.equal(result.catalog.brands.length, 1);
  assert.equal(result.embeddedImages.get('AP-001')?.bytes.toString(), 'mock-image');
} finally {
  globalThis.fetch = oldFetch;
}
console.log('Public catalog parsing and workbook image checks passed.');
