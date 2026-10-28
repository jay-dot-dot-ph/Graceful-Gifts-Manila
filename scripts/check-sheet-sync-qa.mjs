import assert from 'node:assert/strict';
import { checkHostingAvailability, compareArtifact, compareSource } from './check-sheet-sync.mjs';

const origin = 'https://example.test';
const built = { fingerprint: 'a'.repeat(64), fileCount: 4 };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});
const status = (code) => new Response('', { status: code });

assert.deepEqual(
  await compareArtifact({ origin, built, fetchImpl: async () => json(built) }),
  { changed: false, quotaBlocked: false },
  'matching live artifact should skip deployment',
);
assert.deepEqual(
  await compareArtifact({ origin, built, fetchImpl: async () => json({ fingerprint: 'b'.repeat(64), fileCount: 4 }) }),
  { changed: true, quotaBlocked: false },
  'changed artifact should deploy',
);
assert.deepEqual(
  await compareArtifact({ origin, built, fetchImpl: async () => status(404) }),
  { changed: true, quotaBlocked: false },
  'missing live fingerprint should deploy',
);
assert.deepEqual(
  await compareArtifact({ origin, built, allowQuotaDeploy: true, fetchImpl: async () => status(509) }),
  { changed: true, quotaBlocked: true },
  'push and manual events should attempt deployment when Hosting is quota-blocked',
);
assert.deepEqual(
  await compareArtifact({ origin, built, fetchImpl: async () => status(509) }),
  { changed: false, quotaBlocked: true },
  'scheduled events should not deploy when Hosting is quota-blocked',
);
assert.deepEqual(
  await compareSource({ origin, sourceFingerprint: 'a'.repeat(64), fetchImpl: async () => status(509) }),
  { changed: false, quotaBlocked: true },
  'source checks should expose a quota block',
);
assert.deepEqual(
  await checkHostingAvailability({ origin, fetchImpl: async () => json({ sourceFingerprint: 'a'.repeat(64) }) }),
  { quotaBlocked: false },
  'available Hosting should pass the preflight',
);

await assert.rejects(
  compareArtifact({ origin, built, fetchImpl: async () => status(500) }),
  /Live site fingerprint returned HTTP 500/,
  'unexpected server errors must fail the workflow',
);
await assert.rejects(
  compareSource({ origin, sourceFingerprint: 'a'.repeat(64), fetchImpl: async () => status(401) }),
  /Live catalog returned HTTP 401/,
  'authentication failures must fail the workflow',
);
await assert.rejects(
  compareArtifact({ origin, built, fetchImpl: async () => json({ fingerprint: 'invalid', fileCount: 0 }) }),
  /Live site fingerprint is invalid/,
  'invalid live fingerprints must fail the workflow',
);

console.log('Sheet synchronization checks passed.');
