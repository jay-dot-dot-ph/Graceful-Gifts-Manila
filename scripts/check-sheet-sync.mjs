import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getPublicSourceFingerprint } from './public-catalog.mjs';

const fingerprintPattern = /^[a-f0-9]{64}$/;

function endpoint(origin, path) {
  return `${origin}${path}?sync-check=${Date.now()}`;
}

function assertFingerprint(value, label) {
  if (!fingerprintPattern.test(value?.fingerprint) || !Number.isInteger(value.fileCount) || value.fileCount < 1) {
    throw new Error(`${label} site fingerprint is invalid.`);
  }
}

async function fetchLive(origin, path, fetchImpl) {
  return fetchImpl(endpoint(origin, path), {
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
}

export async function checkHostingAvailability({ origin, fetchImpl = fetch }) {
  const response = await fetchLive(origin, '/api/catalog.json', fetchImpl);
  if (response.status === 509) return { quotaBlocked: true };
  if (!response.ok) throw new Error(`Live catalog returned HTTP ${response.status}`);
  return { quotaBlocked: false };
}

export async function compareSource({ origin, sourceFingerprint, fetchImpl = fetch }) {
  const response = await fetchLive(origin, '/api/catalog.json', fetchImpl);
  if (response.status === 509) return { changed: false, quotaBlocked: true };
  if (!response.ok) throw new Error(`Live catalog returned HTTP ${response.status}`);

  const live = await response.json();
  if (!fingerprintPattern.test(live?.sourceFingerprint)) {
    throw new Error('Live catalog source fingerprint is invalid.');
  }
  return { changed: sourceFingerprint !== live.sourceFingerprint, quotaBlocked: false };
}

export async function compareArtifact({ origin, built, allowQuotaDeploy = false, fetchImpl = fetch }) {
  assertFingerprint(built, 'Built');

  const response = await fetchLive(origin, '/api/site-fingerprint.json', fetchImpl);
  if (response.status === 404) return { changed: true, quotaBlocked: false };
  if (response.status === 509) return { changed: allowQuotaDeploy, quotaBlocked: true };
  if (!response.ok) throw new Error(`Live site fingerprint returned HTTP ${response.status}`);

  const live = await response.json();
  assertFingerprint(live, 'Live');
  return { changed: built.fingerprint !== live.fingerprint, quotaBlocked: false };
}

async function main() {
  const mode = process.argv[2];
  if (!['availability', 'source', 'artifact'].includes(mode)) {
    throw new Error('Use availability, source, or artifact mode.');
  }

  const origin = process.env.SITE_ORIGIN || 'https://graceful-gifts-manila.web.app';
  let result;
  if (mode === 'availability') {
    result = await checkHostingAvailability({ origin });
  } else if (mode === 'source') {
    result = await compareSource({ origin, sourceFingerprint: await getPublicSourceFingerprint() });
  } else {
    const built = JSON.parse(readFileSync('hosting-dist/api/site-fingerprint.json', 'utf8'));
    result = await compareArtifact({
      origin,
      built,
      allowQuotaDeploy: process.env.ALLOW_QUOTA_DEPLOY === 'true',
    });
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed ?? false}\nquota_blocked=${result.quotaBlocked}\n`);
  }

  if (result.quotaBlocked) {
    const canDeploy = result.changed === true;
    console.log(`Firebase Hosting bandwidth quota is blocking the live ${mode === 'artifact' ? 'fingerprint' : 'catalog'} endpoint. ${canDeploy ? 'This event will attempt deployment after its valid build.' : 'Scheduled build and deployment are skipped until Hosting is available.'}`);
  } else if (mode === 'availability') {
    console.log('Live Firebase Hosting is available.');
  } else {
    console.log(`${mode === 'source' ? 'Sheet source' : 'Built site'} ${result.changed ? 'changed; deployment needed.' : 'unchanged; deployment skipped.'}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
