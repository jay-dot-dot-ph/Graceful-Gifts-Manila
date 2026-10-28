import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('hosting-dist');
const imagesRoot = join(root, 'images');
const phase2 = {
  label: 'Recorded Phase-2 artifact (same recorded release, not a browser-transfer measurement)',
  hostingBytes: 378_711_326,
  imageBytes: 373_810_186,
  thumbnailBytes: 111_643_549,
  detailBytes: 262_166_637,
  jpegBytes: 179_947_023,
  pngBytes: 193_863_163,
  webpBytes: 0,
  thumbnailCount: 1_180,
  detailCount: 1_180,
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
const extension = (file) => (file.match(/\.([a-z0-9]+)$/i)?.[1] || 'other').toLowerCase();
const byExtension = Object.groupBy(imageFiles, extension);
const thumbnails = imageFiles.filter((file) => /-thumbnail-[a-f0-9]{12}\.(?:jpg|png|webp)$/i.test(file));
const details = imageFiles.filter((file) => /-detail-[a-f0-9]{12}\.(?:jpg|png|webp)$/i.test(file));
const over500k = imageFiles.filter((file) => statSync(file).size > 500_000);
const catalog = JSON.parse(readFileSync(join(root, 'api', 'catalog.json'), 'utf8'));
const pipeline = JSON.parse(readFileSync(join(root, 'api', 'image-pipeline-report.json'), 'utf8'));
const imageRefs = new Set(catalog.watches.flatMap((watch) => [watch.localImage, watch.thumbnailImage].filter(Boolean)));
const missingRefs = [...imageRefs].filter((url) => !url.startsWith('/images/') || !existsSync(join(root, url.slice(1))));
const largest = [...imageFiles].sort((left, right) => statSync(right).size - statSync(left).size).slice(0, 8);
const current = {
  hostingBytes: totals(allFiles), imageBytes: totals(imageFiles), thumbnailBytes: totals(thumbnails), detailBytes: totals(details),
  jpegBytes: totals([...(byExtension.jpg || []), ...(byExtension.jpeg || [])]), pngBytes: totals(byExtension.png || []), webpBytes: totals(byExtension.webp || []),
  thumbnailCount: thumbnails.length, detailCount: details.length,
};
const change = (after, before) => before ? `${((after - before) / before * 100).toFixed(2)}%` : 'n/a';
const row = (label, after, before) => `| ${label} | ${bytes(after)} | ${bytes(before)} | ${change(after, before)} |`;
const benchmarkPath = resolve('.sites-runtime/network-benchmark.json');
const benchmark = existsSync(benchmarkPath) ? JSON.parse(readFileSync(benchmarkPath, 'utf8')) : null;
const lines = [
  '## Hosting and image performance',
  '',
  `Baseline: ${phase2.label}. Positive change means the current artifact is larger.`,
  '',
  '| Metric | Current | Phase-2 recorded baseline | Change |',
  '| --- | ---: | ---: | ---: |',
  row('Hosting artifact bytes', current.hostingBytes, phase2.hostingBytes),
  row('Product image bytes', current.imageBytes, phase2.imageBytes),
  row('Thumbnail bytes', current.thumbnailBytes, phase2.thumbnailBytes),
  row('Detail bytes', current.detailBytes, phase2.detailBytes),
  row('JPEG bytes', current.jpegBytes, phase2.jpegBytes),
  row('PNG bytes', current.pngBytes, phase2.pngBytes),
  row('WebP bytes', current.webpBytes, phase2.webpBytes),
  '',
  `- Thumbnails: **${bytes(current.thumbnailCount)}** files (Phase 2: ${bytes(phase2.thumbnailCount)})`,
  `- Details: **${bytes(current.detailCount)}** files (Phase 2: ${bytes(phase2.detailCount)})`,
  `- Emitted formats: JPEG **${bytes((byExtension.jpg || []).length + (byExtension.jpeg || []).length)}**, PNG **${bytes((byExtension.png || []).length)}**, WebP **${bytes((byExtension.webp || []).length)}**`,
  `- Files over 500 KB: **${bytes(over500k.length)}**`,
  `- Missing catalog image references: **${bytes(missingRefs.length)}**`,
  `- Validated original-format fallbacks: **${bytes(Object.values(pipeline.fallbackCounts).reduce((sum, count) => sum + count, 0))}** (${Object.entries(pipeline.fallbackCounts).map(([reason, count]) => `${reason}: ${count}`).join(', ') || 'none'})`,
  '',
  '### Largest generated product images',
  '',
  '| File | Bytes |',
  '| --- | ---: |',
  ...largest.map((file) => `| ${relative(root, file).replaceAll('\\', '/')} | ${bytes(statSync(file).size)} |`),
  '',
  '### Browser network benchmark',
  '',
];

if (benchmark) {
  lines.push('| Scenario | Cache | Browser-reported transfer bytes | Requests | Cache hits |', '| --- | --- | ---: | ---: | ---: |');
  for (const scenario of benchmark.scenarios) lines.push(`| ${scenario.scenario} | ${scenario.cache} | ${bytes(scenario.transferredBytes)} | ${scenario.requestCount} | ${scenario.cacheHits} |`);
  lines.push('', 'These are local Chromium transfer measurements using CDP encoded transfer bytes. A same-snapshot Phase-2 legacy-format browser build was not run, so no real before/after transfer reduction is claimed. Firebase CDN delivery and monthly Hosting usage require a separately approved deployment and live measurement.');
} else {
  lines.push('Network benchmark artifact is unavailable. This report intentionally does not claim browser-transfer savings without measurement.');
}
lines.push('', 'Dual thumbnail/detail variants can increase total artifact size while still reducing a visitor’s transfer because cards load the smaller thumbnail and the detail image is deferred until needed.', '');

const report = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
