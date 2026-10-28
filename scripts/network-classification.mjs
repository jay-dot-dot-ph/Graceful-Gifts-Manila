export const ALLOWED_GOOGLE_FONT_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

export function classifyNetworkRequest(url, firstPartyOrigin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'unexpected-third-party', url, origin: 'invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return { kind: 'non-network', url, origin: parsed.origin };
  if (parsed.origin === firstPartyOrigin) return { kind: 'first-party', url, origin: parsed.origin };
  if (parsed.protocol === 'https:' && ALLOWED_GOOGLE_FONT_HOSTS.has(parsed.hostname)) {
    return { kind: 'google-fonts', url, origin: parsed.origin };
  }
  return { kind: 'unexpected-third-party', url, origin: parsed.origin };
}

function emptyTotals() {
  return { transferredBytes: 0, requestCount: 0, cacheHits: 0 };
}

function transferredBytes(entry) {
  const bytes = Number(entry.encodedDataLength);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function wasCacheHit(entry) {
  return entry.fromDiskCache === true
    || entry.fromServiceWorker === true
    || entry.status === 304
    || (entry.status === 200 && transferredBytes(entry) === 0);
}

function addEntry(totals, entry) {
  totals.transferredBytes += transferredBytes(entry);
  totals.requestCount++;
  if (wasCacheHit(entry)) totals.cacheHits++;
}

export function summarizeNetworkEntries(entries, firstPartyOrigin, category) {
  const hosting = { ...emptyTotals(), categories: {} };
  const googleFonts = emptyTotals();
  const unexpected = [];

  for (const entry of entries) {
    const classification = classifyNetworkRequest(entry.url, firstPartyOrigin);
    if (classification.kind === 'non-network') continue;
    if (classification.kind === 'unexpected-third-party') {
      unexpected.push({ ...classification, entry });
      continue;
    }
    if (classification.kind === 'google-fonts') {
      addEntry(googleFonts, entry);
      continue;
    }

    addEntry(hosting, entry);
    const name = category(entry);
    const value = hosting.categories[name] || emptyTotals();
    addEntry(value, entry);
    hosting.categories[name] = value;
  }

  return { hosting, googleFonts, unexpected };
}
