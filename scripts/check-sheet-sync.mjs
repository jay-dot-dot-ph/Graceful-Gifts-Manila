import { appendFileSync, readFileSync } from 'node:fs';
import { getPublicSourceFingerprint } from './public-catalog.mjs';

const mode = process.argv[2];
if (!['source', 'artifact'].includes(mode)) throw new Error('Use source or artifact mode.');

const origin = process.env.SITE_ORIGIN || 'https://graceful-gifts-manila.web.app';
let changed;
if (mode === 'source') {
  const response = await fetch(`${origin}/api/catalog.json?sync-check=${Date.now()}`, {
    cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Live catalog returned HTTP ${response.status}`);
  const live = await response.json();
  const fingerprint = await getPublicSourceFingerprint();
  changed = fingerprint !== live.sourceFingerprint;
} else {
  const built = JSON.parse(readFileSync('hosting-dist/api/site-fingerprint.json', 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(built.fingerprint) || built.fileCount < 1) throw new Error('Built site fingerprint is invalid.');
  const response = await fetch(`${origin}/api/site-fingerprint.json?sync-check=${Date.now()}`, {
    cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) changed = true;
  else {
    if (!response.ok) throw new Error(`Live site fingerprint returned HTTP ${response.status}`);
    const live = await response.json();
    changed = built.fingerprint !== live.fingerprint;
  }
}

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
console.log(`${mode === 'source' ? 'Sheet source' : 'Built site'} ${changed ? 'changed; deployment needed.' : 'unchanged; deployment skipped.'}`);
