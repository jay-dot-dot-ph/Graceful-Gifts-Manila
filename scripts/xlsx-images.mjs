import { inflateRawSync } from 'node:zlib';
import { parseCsv } from '../worker/index.js';

function zipFiles(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 22) throw new Error('Invalid XLSX archive');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid XLSX archive');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid XLSX directory');
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('Truncated XLSX directory');
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    files.set(name, () => {
      if (size > 10_000_000 || localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid XLSX entry: ${name}`);
      const start = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
      if (start + compressed > bytes.length) throw new Error(`Truncated XLSX entry: ${name}`);
      const data = bytes.subarray(start, start + compressed);
      const result = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 10_000_000 }) : null;
      if (!result || result.length !== size) throw new Error(`Unsupported XLSX entry: ${name}`);
      return result;
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function attribute(tag, name) {
  return tag.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`))?.[1];
}

export function extractXlsxImages(xlsx, csv) {
  const files = zipFiles(xlsx);
  const sheets = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (sheets.length !== 1) throw new Error('Expected a single-sheet XLSX export');
  const drawings = [...files.keys()].filter((name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
  if (drawings.length > 1) throw new Error('Expected one XLSX image drawing');
  const drawing = drawings[0];
  if (!drawing) return new Map();
  const relationships = drawing.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
  const xml = files.get(drawing)().toString('utf8');
  const rels = files.get(relationships)?.().toString('utf8');
  if (!rels) throw new Error('XLSX drawing relationships are missing');
  const media = new Map();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = attribute(match[0], 'Id');
    const target = attribute(match[0], 'Target');
    if (id && /^\.\.\/media\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/i.test(target || '')) media.set(id, `xl/media/${target.split('/').pop()}`);
  }
  const rows = parseCsv(csv);
  const images = new Map();
  for (const match of xml.matchAll(/<xdr:(?:oneCell|twoCell)Anchor\b[\s\S]*?<\/xdr:(?:oneCell|twoCell)Anchor>/g)) {
    const anchor = match[0];
    if (!/<xdr:col>0<\/xdr:col>/.test(anchor)) continue;
    const row = Number(anchor.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1]);
    const id = rows[row]?.[1]?.trim().toUpperCase();
    const relationship = anchor.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
    const name = media.get(relationship);
    if (!/^[A-Z0-9-]{2,20}$/.test(id || '') || !name || !files.has(name)) continue;
    images.set(id, { bytes: files.get(name)(), extension: name.split('.').pop().toLowerCase() });
  }
  return images;
}
