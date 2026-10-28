import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const jpegMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];

export const imageMime = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function extensionForContentType(type) {
  if (type.startsWith('image/jpeg')) return 'jpg';
  if (type.startsWith('image/png')) return 'png';
  if (type.startsWith('image/webp')) return 'webp';
  return null;
}

export function imageDimensions(bytes, type) {
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
      if (jpegMarkers.includes(marker)) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += length + 2;
    }
  }
  if (type === 'webp' && bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) {
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const value = bytes.readUInt32LE(21);
      return { width: (value & 0x3fff) + 1, height: ((value >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    }
  }
  return null;
}

export function hasAlpha(bytes, type) {
  if (type === 'png') return [4, 6].includes(bytes[25]);
  if (type !== 'webp' || bytes.subarray(0, 4).toString('ascii') !== 'RIFF') return false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.subarray(offset, offset + 4).toString('ascii');
    const length = bytes.readUInt32LE(offset + 4);
    if (chunk === 'ALPH') return true;
    if (chunk === 'VP8X' && offset + 9 <= bytes.length && (bytes[offset + 8] & 0x10) !== 0) return true;
    offset += 8 + length + (length % 2);
  }
  return false;
}

export function hasNonDefaultOrientation(bytes, type) {
  if (type !== 'jpg' || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) break;
    if (marker === 0xe1 && bytes.subarray(offset + 4, offset + 10).equals(Buffer.from('Exif\0\0'))) {
      const tiff = offset + 10;
      const little = bytes.subarray(tiff, tiff + 2).toString('ascii') === 'II';
      const validEndian = little || bytes.subarray(tiff, tiff + 2).toString('ascii') === 'MM';
      const read16 = (position) => little ? bytes.readUInt16LE(position) : bytes.readUInt16BE(position);
      const read32 = (position) => little ? bytes.readUInt32LE(position) : bytes.readUInt32BE(position);
      if (validEndian && tiff + 8 <= bytes.length && read16(tiff + 2) === 42) {
        const ifd = tiff + read32(tiff + 4);
        if (ifd + 2 <= bytes.length) {
          const count = read16(ifd);
          for (let index = 0; index < count; index++) {
            const entry = ifd + 2 + index * 12;
            if (entry + 12 > bytes.length) break;
            if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) === 1) {
              const orientation = read16(entry + 8);
              return orientation > 1 && orientation <= 8;
            }
          }
        }
      }
    }
    offset += length + 2;
  }
  return false;
}

export function imageCommand() {
  return process.platform === 'win32' ? ['magick.exe', 'magick', 'convert.exe', 'convert'] : ['magick', 'convert'];
}

function identifyCommands() {
  return process.platform === 'win32'
    ? [['magick.exe', 'identify'], ['magick', 'identify'], ['identify.exe'], ['identify']]
    : [['magick', 'identify'], ['identify']];
}

function runImageMagick(args, label) {
  let unavailable = true;
  let failure;
  for (const command of imageCommand()) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    unavailable = false;
    if (result.status === 0) return;
    failure = result.error?.message || result.stderr || `exit code ${result.status}`;
    break;
  }
  if (unavailable) throw new Error(`${label}: ImageMagick is unavailable. Install it or run GitHub Actions CI.`);
  throw new Error(`${label}: ${String(failure).trim()}`);
}

export function transformImage(bytes, ext, outputExt, maximum, quality, label) {
  const directory = mkdtempSync(join(tmpdir(), 'ggm-image-'));
  const input = join(directory, `source.${ext}`);
  const output = join(directory, `result.${outputExt}`);
  writeFileSync(input, bytes);
  try {
    const args = [input, '-auto-orient', '-resize', `${maximum}x${maximum}>`];
    if (outputExt === 'webp') args.push('-define', 'webp:method=6', '-quality', String(quality));
    args.push(output);
    runImageMagick(args, label);
    if (!existsSync(output)) throw new Error(`${label}: ImageMagick did not create an output file.`);
    return readFileSync(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function inspectWithImageMagick(files) {
  if (!files.length) return [];
  let unavailable = true;
  let failure;
  for (const [command, ...prefix] of identifyCommands()) {
    const result = spawnSync(command, [...prefix, '-format', '%m|%w|%h|%[channels]\\n', ...files], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    unavailable = false;
    if (result.status === 0) return result.stdout.trimEnd().split('\n').filter(Boolean);
    failure = result.error?.message || result.stderr || `exit code ${result.status}`;
    break;
  }
  if (unavailable) throw new Error('Image pipeline QA requires ImageMagick to decode generated images.');
  throw new Error(`ImageMagick could not decode generated images: ${String(failure).trim()}`);
}
