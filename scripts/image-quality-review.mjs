import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { imageDimensions, transformImage } from './image-tools.mjs';

const root = resolve('.');
const output = resolve(root, 'hosting-dist');
const reviewRoot = resolve(process.env.IMAGE_QUALITY_REVIEW_DIR || '.sites-runtime/image-quality-review');
const report = JSON.parse(readFileSync(join(output, 'api/image-pipeline-report.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(output, 'api/catalog.json'), 'utf8'));
const watches = new Map(catalog.watches.map((watch) => [watch.id, watch]));
const candidates = report.images.filter((image) => image.emittedFormat === 'webp' && image.sourceFormat !== 'webp');
assert.ok(candidates.length, 'No converted WebP files are available for visual review.');

function select(predicate) {
  return candidates.find((image) => !selected.has(image.path) && predicate(watches.get(image.id) || {}, image));
}

const selected = new Set();
const samples = [];
for (const [label, predicate] of [
  ['Transparency', (_watch, image) => image.sourceHasAlpha],
  ['Dark dial', (watch) => /black|dark|blue/i.test(watch.dialColor || '')],
  ['Silver bracelet', (watch) => /silver|steel/i.test(`${watch.strapMaterial || ''} ${watch.caseMaterial || ''}`)],
  ['Fine lettering / general detail', () => true],
]) {
  const image = select(predicate);
  if (!image) continue;
  selected.add(image.path);
  samples.push({ label, image, watch: watches.get(image.id) });
}
assert.ok(samples.length >= 2, 'At least two representative WebP samples are required for visual review.');

rmSync(reviewRoot, { recursive: true, force: true });
mkdirSync(reviewRoot, { recursive: true });
const panels = [];
for (const [index, sample] of samples.entries()) {
  const source = resolve(root, '.image-cache', sample.image.sourceCacheFile);
  const emitted = resolve(output, sample.image.path.slice(1));
  assert.ok(source.startsWith(resolve(root, '.image-cache')) && existsSync(source), `Missing cached source for ${sample.image.path}`);
  const sourceExt = source.split('.').pop().toLowerCase();
  const sourceBytes = readFileSync(source);
  const emittedBytes = readFileSync(emitted);
  assert.ok(imageDimensions(sourceBytes, sourceExt), `Unreadable source image for ${sample.image.path}`);
  assert.ok(imageDimensions(emittedBytes, 'webp'), `Unreadable WebP image for ${sample.image.path}`);
  const originalPanel = join(reviewRoot, `${index + 1}-original.png`);
  const webpPanel = join(reviewRoot, `${index + 1}-webp.png`);
  writeFileSync(originalPanel, transformImage(sourceBytes, sourceExt, 'png', 360, undefined, `Quality review original ${sample.image.id}`));
  writeFileSync(webpPanel, transformImage(emittedBytes, 'webp', 'png', 360, undefined, `Quality review WebP ${sample.image.id}`));
  panels.push(originalPanel, webpPanel);
}

let montageFailure;
let madeSheet = false;
for (const command of process.platform === 'win32' ? [['magick.exe', 'montage'], ['magick', 'montage'], ['montage.exe'], ['montage']] : [['magick', 'montage'], ['montage']]) {
  const [program, ...prefix] = command;
  const result = spawnSync(program, [...prefix, ...panels, '-tile', '2x', '-geometry', '360x360+8+8', join(reviewRoot, 'image-quality-contact-sheet.png')], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.status === 0) { madeSheet = true; break; }
  montageFailure = result.stderr || result.error?.message || `exit code ${result.status}`;
  break;
}
if (!madeSheet) throw new Error(`Could not create the WebP quality contact sheet: ${montageFailure || 'ImageMagick montage is unavailable'}`);

const lines = [
  '# WebP visual quality review',
  '',
  'Open `image-quality-contact-sheet.png`. Each row shows the normalized original-format source on the left and the emitted WebP at the same 360px review size on the right.',
  '',
  '| Row | Focus | Watch | Source format | WebP bytes | Original bytes |',
  '| --- | --- | --- | --- | ---: | ---: |',
  ...samples.map((sample, index) => `| ${index + 1} | ${sample.label} | ${sample.image.id} | ${sample.image.sourceFormat.toUpperCase()} | ${sample.image.emittedBytes.toLocaleString()} | ${sample.image.sourceBytes.toLocaleString()} |`),
  '',
  'Review watch-dial lettering, bracelet edges, highlights, gradients, and transparent regions before approving a deployment. This contact sheet is a human visual check; smaller file size alone does not prove visual quality.',
];
writeFileSync(join(reviewRoot, 'image-quality-review.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
