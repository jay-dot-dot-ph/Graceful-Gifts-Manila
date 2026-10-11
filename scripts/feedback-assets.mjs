import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Read the JPEG headers without decoding or changing any image pixels.
function dimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid JPEG');
  for (let offset = 2; offset < bytes.length - 9;) {
    if (bytes[offset] !== 0xff) throw new Error('Invalid JPEG marker');
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) throw new Error('Invalid JPEG segment');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  throw new Error('JPEG dimensions unavailable');
}

export function feedbackAssets(root) {
  return readdirSync(join(root, 'feedback')).filter((name) => /\.jpe?g$/i.test(name)).sort().map((name) => {
    const bytes = readFileSync(join(root, 'feedback-preview', name));
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    return { name, ...dimensions(bytes), path: `/feedback/${digest}.jpg`, bytes };
  });
}
