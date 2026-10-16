import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { parseCsv, normalizeRows, getCatalog, setCatalogForBuild } from '../worker/index.js';
import { loadPrivateCatalog, serviceAccountAssertion } from './private-catalog.mjs';
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
assert.deepEqual(normalizeRows(header, 'Tag Heuer'), []);
assert.throws(() => normalizeRows('Watch ID,Model Name\nabc,Example', 'Broken'), /Missing price \(php\) column/);
await assert.rejects(getCatalog(), /authenticated build/);
setCatalogForBuild({ watches, brands: [{ name: 'Invicta', count: 2 }] });
assert.equal((await getCatalog()).watches[0].id, 'INV-001');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = { client_email: 'firebase-adminsdk-fbsvc@graceful-gifts-manila.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const assertion = serviceAccountAssertion(credentials, 1_700_000_000_000);
const [jwtHeader, jwtClaims, signature] = assertion.split('.');
assert.equal(JSON.parse(Buffer.from(jwtClaims, 'base64url')).iss, credentials.client_email);
assert.ok(verify('RSA-SHA256', Buffer.from(`${jwtHeader}.${jwtClaims}`), publicKey, Buffer.from(signature, 'base64url')));
assert.throws(() => serviceAccountAssertion({ ...credentials, client_email: 'wrong@example.com' }), /does not match/);
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
const oldCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const tabs = ['Audemars Piguet', ...Array.from({ length: 22 }, (_, index) => `Brand ${index + 1}`)];
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(credentials);
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token' });
  if (url.includes('/values:batchGet')) return Response.json({ valueRanges: tabs.map((name) => ({ values: name === 'Audemars Piguet' ? [header.split(','), ['', 'ap-001', 'Audemars Piguet Royal Oak', '42mm', 'Blue', 'Steel', 'Steel', 'Automatic', '5,950', '20', 'Details', '2026-10-15']] : [header.split(',')] })) });
  if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) return Response.json({ sheets: [{ properties: { title: 'Brands', sheetId: 100 } }, ...tabs.map((title, sheetId) => ({ properties: { title, sheetId } }))] });
  if (url.includes('/download?mimeType=')) return Response.json({ done: true, response: { downloadUri: 'https://www.googleapis.com/mock-download' } });
  if (url === 'https://www.googleapis.com/mock-download') return new Response(workbook);
  throw new Error(`Unexpected private source request: ${url}`);
};
try {
  const result = await loadPrivateCatalog();
  assert.equal(result.catalog.watches[0].id, 'AP-001');
  assert.equal(result.catalog.brands.length, 23);
  assert.equal(result.embeddedImages.get('AP-001')?.bytes.toString(), 'mock-image');
} finally {
  globalThis.fetch = oldFetch;
  if (oldCredentials === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = oldCredentials;
}
console.log('Private catalog parsing, authentication, and workbook image checks passed.');
