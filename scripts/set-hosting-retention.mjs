import { createSign } from 'node:crypto';

const site = 'graceful-gifts-manila';
const channel = `sites/${site}/channels/live`;
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
if (credentials.project_id !== site || !credentials.client_email || !credentials.private_key) {
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
const { access_token: token } = await tokenResponse.json();
if (!token) throw new Error('Firebase OAuth did not return an access token.');

const url = `https://firebasehosting.googleapis.com/v1beta1/${channel}`;
const headers = { authorization: `Bearer ${token}` };
const currentResponse = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
if (!currentResponse.ok) throw new Error(`Could not read live Hosting channel: HTTP ${currentResponse.status}`);
const current = await currentResponse.json();
console.log(`Live Hosting channel currently retains ${current.retainedReleaseCount ?? 'an unspecified number of'} releases.`);
if (process.argv[2] !== '--apply') {
  console.log('Dry run only. Pass --apply to retain one previous release.');
  process.exit(0);
}

const response = await fetch(`${url}?updateMask=retainedReleaseCount`, {
  method: 'PATCH',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ name: channel, retainedReleaseCount: 1 }),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Could not set live Hosting retention: HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
const updated = await response.json();
if (updated.retainedReleaseCount !== 1) throw new Error('Firebase did not confirm the new Hosting retention setting.');
console.log('Live Hosting now retains one previous release. Older rollback versions are scheduled for deletion.');
