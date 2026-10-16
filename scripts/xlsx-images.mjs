import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';

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

function relationships(files, path) {
  const xml = files.get(path)?.().toString('utf8');
  if (!xml) return new Map();
  return new Map([...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map(([tag]) => [attribute(tag, 'Id'), attribute(tag, 'Target')]).filter(([id, target]) => id && target));
}

function zipTarget(source, target) {
  return target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(source), target));
}

export function extractWorkbookImages(xlsx, rowsByBrand) {
  const files = zipFiles(xlsx);
  const workbook = files.get('xl/workbook.xml')?.().toString('utf8');
  if (!workbook) throw new Error('XLSX workbook metadata is missing.');
  const workbookRels = relationships(files, 'xl/_rels/workbook.xml.rels');
  const images = new Map();
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
    const brand = attribute(tag, 'name')?.replaceAll('&amp;', '&');
    if (!rowsByBrand.has(brand)) continue;
    const worksheet = zipTarget('xl/workbook.xml', workbookRels.get(attribute(tag, 'r:id')) || '');
    const sheetXml = files.get(worksheet)?.().toString('utf8');
    if (!sheetXml) throw new Error(`XLSX worksheet is missing for ${brand}.`);
    const drawingId = sheetXml.match(/<drawing\b[^>]*\br:id="([^"]+)"/)?.[1];
    if (!drawingId) continue;
    const sheetRelsPath = posix.join(posix.dirname(worksheet), '_rels', posix.basename(worksheet) + '.rels');
    const drawingTarget = relationships(files, sheetRelsPath).get(drawingId);
    if (!drawingTarget) throw new Error(`XLSX drawing relationship is missing for ${brand}.`);
    const drawing = zipTarget(worksheet, drawingTarget);
    const drawingXml = files.get(drawing)?.().toString('utf8');
    if (!drawingXml) throw new Error(`XLSX drawing is missing for ${brand}.`);
    const drawingRelsPath = posix.join(posix.dirname(drawing), '_rels', posix.basename(drawing) + '.rels');
    const media = relationships(files, drawingRelsPath);
    for (const [anchor] of drawingXml.matchAll(/<xdr:(?:oneCell|twoCell)Anchor\b[\s\S]*?<\/xdr:(?:oneCell|twoCell)Anchor>/g)) {
      if (!/<xdr:col>0<\/xdr:col>/.test(anchor)) continue;
      const row = Number(anchor.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1]);
      const id = String(rowsByBrand.get(brand)[row]?.[1] || '').trim().toUpperCase();
      const target = media.get(anchor.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1]);
      const path = target && zipTarget(drawing, target);
      if (!/^[A-Z0-9-]{2,20}$/.test(id) || !path || !files.has(path)) continue;
      const extension = path.split('.').pop().toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension)) continue;
      images.set(id, { bytes: files.get(path)(), extension });
    }
  }
  return images;
}
