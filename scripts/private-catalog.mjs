import { createSign } from 'node:crypto';
import { normalizeRows } from '../worker/index.js';
import { extractWorkbookImages } from './xlsx-images.mjs';

const SHEET_ID = '1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8';
const SERVICE_EMAIL = 'firebase-adminsdk-fbsvc@graceful-gifts-manila.iam.gserviceaccount.com';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const base64url = (value) => Buffer.from(value).toString('base64url');
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const csv = (rows) => rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function serviceAccountAssertion(credentials, now = Date.now()) {
  if (credentials.client_email !== SERVICE_EMAIL || !credentials.private_key) throw new Error('The Firebase service account secret does not match the account granted access to the Sheet.');
  const issued = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issued,
    exp: issued + 3600,
  }));
  const body = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(body).end().sign(credentials.private_key, 'base64url');
  return `${body}.${signature}`;
}

async function responseOrThrow(response, label) {
  if (response.ok) return response;
  const body = (await response.text()).slice(0, 400);
  throw new Error(`${label} returned HTTP ${response.status}: ${body}`);
}

async function accessToken(credentials) {
  const response = await responseOrThrow(await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(credentials) }),
    signal: AbortSignal.timeout(30000),
  }), 'Google OAuth');
  const data = await response.json();
  if (!data.access_token) throw new Error('Google OAuth did not return an access token.');
  return data.access_token;
}

async function googleJson(url, token, label, options = {}) {
  const response = await responseOrThrow(await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(60000),
  }), label);
  return response.json();
}

async function workbookExport(token) {
  const startUrl = `https://www.googleapis.com/drive/v3/files/${SHEET_ID}/download?mimeType=${encodeURIComponent(XLSX)}`;
  let operation = await googleJson(startUrl, token, 'Drive workbook export', { method: 'POST' });
  for (let attempt = 0; !operation.done && attempt < 90; attempt++) {
    if (!operation.name) throw new Error('Drive export did not provide an operation name.');
    await delay(10000);
    const name = operation.name.replace(/^operations\//, '');
    operation = await googleJson(`https://www.googleapis.com/drive/v3/operations/${encodeURIComponent(name)}`, token, 'Drive export status');
  }
  if (!operation.done || operation.error || !operation.response?.downloadUri) throw new Error(`Drive workbook export failed: ${JSON.stringify(operation.error || operation).slice(0, 400)}`);
  const url = new URL(operation.response.downloadUri);
  if (url.protocol !== 'https:' || !/(^|\.)googleapis\.com$|(^|\.)googleusercontent\.com$|^(docs|drive)\.google\.com$/.test(url.hostname)) throw new Error('Unexpected Drive download host.');
  const headers = url.hostname.endsWith('googleusercontent.com') ? {} : { authorization: `Bearer ${token}` };
  const response = await responseOrThrow(await fetch(url, { headers, signal: AbortSignal.timeout(300000) }), 'Drive workbook download');
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 1_000_000_000) throw new Error('Workbook export exceeds the 1 GB build limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 1_000_000_000) throw new Error('Workbook export has an unexpected size.');
  return bytes;
}

export async function loadPrivateCatalog() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is required to read the private Sheet.');
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const token = await accessToken(credentials);
  const metadata = await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets(properties(sheetId,title,hidden))`, token, 'Sheet metadata');
  const tabs = metadata.sheets.map(({ properties }) => properties).filter((sheet) => !sheet.hidden && sheet.title.toLowerCase() !== 'brands');
  if (tabs.length < 23) throw new Error(`Expected at least 23 brand tabs, found ${tabs.length}.`);
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet`);
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  for (const tab of tabs) url.searchParams.append('ranges', `'${tab.title.replaceAll("'", "''")}'!A1:L1000`);
  const values = await googleJson(url, token, 'Sheet values');
  if (values.valueRanges?.length !== tabs.length) throw new Error('Google returned an incomplete set of brand tabs.');
  const watches = [], ids = new Set(), duplicateIds = [];
  const rowsByBrand = new Map();
  for (let index = 0; index < tabs.length; index++) {
    const tab = tabs[index];
    const rows = values.valueRanges[index].values || [];
    rowsByBrand.set(tab.title, rows);
    for (const watch of normalizeRows(csv(rows), tab.title)) {
      if (ids.has(watch.id)) duplicateIds.push(watch.id);
      else { ids.add(watch.id); watches.push(watch); }
    }
  }
  if (duplicateIds.length || !watches.length) throw new Error(`Private catalog has ${duplicateIds.length} duplicate IDs and ${watches.length} watches.`);
  const catalog = {
    watches,
    brands: tabs.map((tab) => ({ name: tab.title, slug: slug(tab.title), gid: String(tab.sheetId), count: watches.filter((watch) => watch.brandTab === tab.title).length })),
    sourceWatchCount: watches.length,
    fetchedAt: new Date().toISOString(),
    partial: false, failedBrands: [], failedImageBrands: [], duplicateIds: [], stale: false,
  };
  const embeddedImages = extractWorkbookImages(await workbookExport(token), rowsByBrand);
  if (!embeddedImages.size) throw new Error('The private workbook export contained no product images.');
  const knownIds = new Set(watches.map((watch) => watch.id));
  if ([...embeddedImages.keys()].some((id) => !knownIds.has(id))) throw new Error('The workbook has images attached to unknown Watch IDs.');
  return { catalog, embeddedImages };
}
