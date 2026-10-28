import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('hosting-dist');
const imagesRoot = join(root, 'images');
const baseline = {
  hostingBytes: 300_404_568,
  imageBytes: 294_360_291,
  imageCount: 1_180,
  pngBytes: 139_201_655,
};

if (!existsSync(root) || !existsSync(imagesRoot)) throw new Error('Run npm run build:firebase before reporting performance.');

function filesIn(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else files.push(path);
    }
  }
  return files;
}

const allFiles = filesIn(root);
const imageFiles = allFiles.filter((file) => (file.startsWith(imagesRoot + '\\') || file.startsWith(imagesRoot + '/')) && /\.(?:jpg|jpeg|png|webp)$/i.test(file));
const totals = (files) => files.reduce((sum, file) => sum + statSync(file).size, 0);
const bytes = (value) => new Intl.NumberFormat('en-US').format(value);
const percentage = (actual, before) => `${((before - actual) / before * 100).toFixed(2)}%`;
const extension = (file) => (file.match(/\.([a-z0-9]+)$/i)?.[1] || 'other').toLowerCase();
const byExtension = Object.groupBy(imageFiles, extension);
const thumbnails = imageFiles.filter((file) => /-thumbnail-[a-f0-9]{12}\.(?:jpg|png|webp)$/i.test(file));
const details = imageFiles.filter((file) => /-detail-[a-f0-9]{12}\.(?:jpg|png|webp)$/i.test(file));
const over500k = imageFiles.filter((file) => statSync(file).size > 500_000);
const catalog = JSON.parse(readFileSync(join(root, 'api', 'catalog.json'), 'utf8'));
const imageRefs = catalog.watches.flatMap((watch) => [watch.localImage, watch.thumbnailImage].filter(Boolean));
const missingRefs = imageRefs.filter((url) => !url.startsWith('/images/') || !existsSync(join(root, url.slice(1))));
const largest = [...imageFiles].sort((left, right) => statSync(right).size - statSync(left).size).slice(0, 8);

const row = (label, actual, before) => `| ${label} | ${actual} | ${bytes(before)} | ${percentage(Number(actual.replaceAll(',', '')), before)} |`;
const lines = [
  '## Hosting and image performance',
  '',
  '| Metric | Current | Before | Reduction |',
  '| --- | ---: | ---: | ---: |',
  row('Hosting artifact bytes', bytes(totals(allFiles)), baseline.hostingBytes),
  row('Product image bytes', bytes(totals(imageFiles)), baseline.imageBytes),
  row('Product image files', bytes(imageFiles.length), baseline.imageCount),
  row('PNG image bytes', bytes(totals(byExtension.png || [])), baseline.pngBytes),
  '',
  `- Thumbnails: **${bytes(thumbnails.length)}** files, **${bytes(totals(thumbnails))}** bytes`,
  `- Detail images: **${bytes(details.length)}** files, **${bytes(totals(details))}** bytes`,
  `- JPEG: **${bytes((byExtension.jpg || []).length)}** files, **${bytes(totals(byExtension.jpg || []))}** bytes`,
  `- PNG: **${bytes((byExtension.png || []).length)}** files, **${bytes(totals(byExtension.png || []))}** bytes`,
  `- WebP: **${bytes((byExtension.webp || []).length)}** files, **${bytes(totals(byExtension.webp || []))}** bytes`,
  `- Over 500 KB: **${bytes(over500k.length)}** files, **${bytes(totals(over500k))}** bytes`,
  `- Missing or broken catalog image references: **${bytes(missingRefs.length)}**`,
  '',
  '### Largest generated product images',
  '',
  '| File | Bytes |',
  '| --- | ---: |',
  ...largest.map((file) => `| ${relative(root, file).replaceAll('\\', '/')} | ${bytes(statSync(file).size)} |`),
  '',
  'Reductions are calculated from the recorded baseline. A negative percentage means the current output is larger.',
  '',
];

const report = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
