import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const manifestPath = 'api/site-fingerprint.json';

function filesIn(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return filesIn(join(directory, entry.name), relative);
    return relative === manifestPath ? [] : [relative];
  }).sort();
}

export function siteFingerprint(directory) {
  const digest = createHash('sha256');
  const files = filesIn(directory);
  for (const relative of files) {
    let bytes = readFileSync(join(directory, relative));
    if (relative === 'api/catalog.json') {
      const { fetchedAt, ...catalog } = JSON.parse(bytes.toString('utf8'));
      bytes = Buffer.from(JSON.stringify(catalog));
    }
    digest.update(relative).update('\0').update(createHash('sha256').update(bytes).digest()).update('\0');
  }
  return { fingerprint: digest.digest('hex'), fileCount: files.length };
}

export function writeSiteFingerprint(directory) {
  const manifest = siteFingerprint(directory);
  writeFileSync(join(directory, manifestPath), JSON.stringify(manifest));
  return manifest;
}
