import { createSign } from 'node:crypto';

const site = 'graceful-gifts-manila';
const project = site;
const base = `https://firebasehosting.googleapis.com/v1beta1/projects/${project}/sites/${site}`;
let token = process.argv[2] !== '--apply' ? process.env.FIREBASE_HOSTING_DRY_RUN_TOKEN : null;
if (!token) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  if (credentials.project_id !== project || !credentials.client_email || !credentials.private_key) {
    throw new Error('The Firebase deployment credential does not match the expected project.');
  }
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const assertion = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.hosting',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(assertion).end().sign(credentials.private_key, 'base64url');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${assertion}.${signature}` }),
    signal: AbortSignal.timeout(30000),
  });
  if (!tokenResponse.ok) throw new Error(`Firebase OAuth returned HTTP ${tokenResponse.status}`);
  ({ access_token: token } = await tokenResponse.json());
}
if (!token) throw new Error('Firebase OAuth did not return an access token.');

const headers = { authorization: `Bearer ${token}` };
async function read(path) {
  const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Firebase Hosting ${path} returned HTTP ${response.status}`);
  return response.json();
}
async function list(path, field) {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Firebase Hosting ${path} returned HTTP ${response.status}`);
    const page = await response.json();
    items.push(...(page[field] || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return items;
}
function versionId(name) {
  const match = String(name || '').match(new RegExp(`(?:^|/)sites/${site}/versions/([a-zA-Z0-9]+)$`));
  if (!match) throw new Error(`Unexpected Hosting version name: ${name}`);
  return match[1];
}

const live = await read('/channels/live');
const currentId = versionId(live.release?.version?.name);
const previousId = process.env.PREVIOUS_VERSION ? versionId(process.env.PREVIOUS_VERSION) : null;
if (process.argv[2] === '--apply' && (!previousId || previousId === currentId)) {
  throw new Error('No new live release was confirmed; refusing to delete older versions.');
}

const releases = await list('/channels/live/releases', 'releases');
const liveReleaseIds = new Set(releases.map((release) => versionId(release.version?.name)));
if (!liveReleaseIds.has(currentId)) throw new Error('The current live version is missing from release history.');
const versions = await list('/versions', 'versions');
const currentReleaseTime = Date.parse(live.release.releaseTime);
if (!Number.isFinite(currentReleaseTime)) throw new Error('The live release time is invalid.');
const oldVersions = versions.filter((version) => version.status === 'FINALIZED'
  && liveReleaseIds.has(versionId(version.name))
  && versionId(version.name) !== currentId
  && Date.parse(version.finalizeTime) < currentReleaseTime);
console.log(`Current live version: ${currentId}. Older finalized live versions: ${oldVersions.length}.`);
if (process.argv[2] !== '--apply') {
  console.log('Dry run only. Pass --apply after a successful deployment to delete older versions.');
  process.exit(0);
}

for (const version of oldVersions) {
  const latest = await read('/channels/live');
  if (versionId(latest.release?.version?.name) !== currentId) {
    throw new Error('The live release changed during cleanup; stopping.');
  }
  const response = await fetch(`${base}/versions/${versionId(version.name)}`, {
    method: 'DELETE', headers, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Could not delete old Hosting version ${versionId(version.name)}: HTTP ${response.status}`);
}
console.log(`Deleted ${oldVersions.length} older Hosting versions. The current live version remains active.`);
