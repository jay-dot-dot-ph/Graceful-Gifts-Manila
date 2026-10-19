import { appendFileSync, readFileSync } from 'node:fs';
import { getPublicSourceFingerprint } from './public-catalog.mjs';

const mode = process.argv[2];
if (!['source', 'artifact'].includes(mode)) throw new Error('Use source or artifact mode.');

const origin = process.env.SITE_ORIGIN || 'https://graceful-gifts-manila.web.app';
const response = await fetch(`${origin}/api/catalog.json?sync-check=${Date.now()}`, {
  cache: 'no-store', signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Live catalog returned HTTP ${response.status}`);
const live = await response.json();

let changed;
if (mode === 'source') {
  const fingerprint = await getPublicSourceFingerprint();
  changed = fingerprint !== live.sourceFingerprint;
} else {
  const built = JSON.parse(readFileSync('hosting-dist/api/catalog.json', 'utf8'));
  const comparable = ({ fetchedAt, ...catalog }) => catalog;
  changed = JSON.stringify(comparable(built)) !== JSON.stringify(comparable(live));
}

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
console.log(`${mode === 'source' ? 'Sheet source' : 'Built catalog'} ${changed ? 'changed; deployment needed.' : 'unchanged; deployment skipped.'}`);
