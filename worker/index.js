// The build embeds styles.css and client.js into this single Worker module.
const STYLES = "__STYLES__";
const CLIENT = "__CLIENT__";
const OPENING_FEEDBACK = "__OPENING_FEEDBACK__";
const SHEET_ID = "1qowXiNelPflvWPYv1lWWCf7z9AnltCL5Tem8Sus-arI";
const SHEET_BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
const FACEBOOK = "https://www.facebook.com/GracefulGifts.Manila";
const MESSENGER = "https://m.me/GracefulGifts.Manila";
const BRAND_TABS = [
  ["AP", "1994018057"], ["BVLGARI", "153669170"], ["CARTIER", "327287243"],
  ["CHARRIOL", "976443302"], ["COACH", "1611498834"], ["FOSSIL", "949872863"],
  ["HUBLOT", "1825202400"], ["INVICTA", "1839212129"], ["MARCJACOBS", "1217338794"],
  ["MK", "35068659"], ["MS", "535083943"], ["OMEGA", "1895499623"],
  ["PANERAI", "867802356"], ["PATEK", "742602860"], ["PS", "914894785"],
  ["RADO", "705980892"], ["SEIKO", "324325008"], ["TAG", "1894959040"],
  ["TISSOT", "1920786190"], ["ROLEX", "2073039252"], ["VACHERON", "1215005135"],
];
const CACHE_MS = 5 * 60 * 1000;
let catalogCache = null;
let catalogPromise = null;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const watchName = (watch) => {
  const model = String(watch.model || watch.id).trim();
  return model.toLowerCase().startsWith(watch.brand.toLowerCase() + " ") ? model : `${watch.brand} ${model}`.trim();
};

export function parseCsv(input) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function discoverTabs(html) {
  const captions = [...html.matchAll(/docs-sheet-tab-caption[^>]*>([^<]+)<\/div>/g)]
    .map((match) => match[1].trim()).filter((name) => name && !["CATEGORIES", "DEFINITION"].includes(name));
  const found = [];
  for (const name of captions) {
    const index = html.lastIndexOf(name);
    if (index < 0) continue;
    const ids = [...html.slice(Math.max(0, index - 220), index).matchAll(/\d{6,12}/g)];
    const gid = ids.at(-1)?.[0];
    if (gid) found.push([name, gid]);
  }
  return found.length ? found : BRAND_TABS;
}

export function extractImages(html) {
  const images = new Map();
  for (const row of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
    const id = cells[1]?.[1]?.replace(/<[^>]+>/g, "").trim().toUpperCase();
    const source = row[0].match(/<img\s+src="(https:\/\/docs\.google\.com\/sheets-images-rt\/[^"]+)"/i)?.[1];
    if (/^[A-Z0-9-]{2,20}$/.test(id || "") && source) images.set(id, source.replace(/&amp;/g, "&").replace(/=w\d+-h\d+$/, "=w800-h800"));
  }
  return images;
}

export function normalizeRows(csv, tabName, images = new Map()) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const watches = [];
  for (const cells of rows.slice(1)) {
    const id = String(cells[1] || "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,20}$/.test(id)) continue;
    const rawPrice = String(cells[10] || "").replace(/[^\d.]/g, "");
    const rawStock = String(cells[11] || "").trim();
    const imageUrl = String(cells[13] || "").trim();
    watches.push({
      id, brand: String(cells[2] || tabName).trim() || tabName, brandTab: tabName, brandSlug: slug(tabName),
      model: String(cells[3] || "").trim(), size: String(cells[4] || "").trim(),
      category: String(cells[5] || "").trim(), dialColor: String(cells[6] || "").trim(),
      caseMaterial: String(cells[7] || "").trim(), strapMaterial: String(cells[8] || "").trim(),
      movement: String(cells[9] || "").trim(),
      price: rawPrice && Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null,
      stock: /^\d+$/.test(rawStock) ? Number(rawStock) : null,
      description: String(cells[12] || "").trim(),
      image: images.get(id) || (/^https:\/\//i.test(imageUrl) ? imageUrl : null),
      dateAdded: String(cells[15] || "").trim(),
    });
  }
  return watches;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(14000) });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) { lastError = error; if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350)); }
  }
  throw lastError;
}
async function loadBrand([name, gid]) {
  const csv = `${SHEET_BASE}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const page = `${SHEET_BASE}/edit?gid=${encodeURIComponent(gid)}`;
  const [data, imagePage] = await Promise.all([fetchText(csv), fetchText(page).catch(() => null)]);
  let images = imagePage ? extractImages(imagePage) : new Map();
  const watches = normalizeRows(data, name, images);
  if (watches.length && !watches.some((watch) => watch.image)) {
    for (let attempt = 0; attempt < 2 && !images.size; attempt++) {
      const retryPage = await fetchText(page).catch(() => null);
      if (retryPage) images = extractImages(retryPage);
    }
  }
  return { watches: normalizeRows(data, name, images), missingImages: watches.length > 0 && !images.size && !watches.some((watch) => watch.image) };
}
async function loadCatalog() {
  const tabs = BRAND_TABS;
  const results = [];
  for (let i = 0; i < tabs.length; i += 6) results.push(...await Promise.allSettled(tabs.slice(i, i + 6).map(loadBrand)));
  const failedBrands = [], failedImageBrands = [], watches = [], ids = new Set(), duplicateIds = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") { failedBrands.push(tabs[index][0]); return; }
    if (result.value.missingImages) failedImageBrands.push(tabs[index][0]);
    for (const watch of result.value.watches) {
      if (ids.has(watch.id)) { duplicateIds.push(watch.id); continue; }
      ids.add(watch.id); watches.push(watch);
    }
  });
  if (!watches.length) throw new Error("The watch catalog could not be loaded.");
  if (failedBrands.length && catalogCache) return { ...catalogCache, stale: true, failedBrands };
  return { watches, brands: tabs.map(([name]) => ({ name, slug: slug(name), count: watches.filter((watch) => watch.brandTab === name).length })), fetchedAt: new Date().toISOString(), partial: failedBrands.length > 0 || failedImageBrands.length > 0, failedBrands, failedImageBrands, duplicateIds, stale: false };
}
async function getCatalog() {
  if (catalogCache && Date.now() - Date.parse(catalogCache.fetchedAt) < CACHE_MS) return catalogCache;
  if (!catalogPromise) catalogPromise = loadCatalog().then((data) => { catalogCache = data; return data; }).finally(() => { catalogPromise = null; });
  try { return await catalogPromise; }
  catch (error) { if (catalogCache) return { ...catalogCache, stale: true }; throw error; }
}

function htmlPage(request, product = null) {
  const url = new URL(request.url);
  const showOpening = url.pathname === "/";
  const title = product ? `${watchName(product)} | Graceful Gifts Manila` : "Graceful Gifts Manila | Luxury Watch Collection";
  const description = product ? `View ${watchName(product)}, ID ${product.id}, and inquire with Graceful Gifts Manila.` : "Explore watches by brand, price, and style. Save favorites and inquire with Graceful Gifts Manila.";
  const imagePath = product?.image ? `${url.origin}/image/${encodeURIComponent(product.id)}` : null;
  const imageMeta = imagePath ? `<meta property="og:image" content="${escapeHtml(imagePath)}">` : "";
  const initial = product ? `<main class="container product-initial"><p class="eyebrow">WATCH DETAILS</p><h1>${escapeHtml(watchName(product))}</h1><p>Watch ID ${escapeHtml(product.id)}</p>${imagePath ? `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(watchName(product))}" width="540" height="540">` : ""}<p>${product.price === null ? "Price on request" : `₱${product.price.toLocaleString("en-PH")}`}</p></main>` : `<main class="container loading-screen"><p>Preparing the collection…</p></main>`;
  const opening = showOpening ? `<div id="opening-screen" class="opening-screen" role="status" aria-label="Preparing the Graceful Gifts Manila collection"><div class="opening-content"><div class="opening-brand"><span class="opening-mark" aria-hidden="true">G</span><p class="opening-name">GRACEFUL GIFTS <span>MANILA</span></p><span class="opening-rule" aria-hidden="true"></span><p class="opening-message">Preparing your collection</p></div><div class="opening-feedback-slot"><div class="opening-feedback"><p>From our customers</p><img src="/feedback/opening.jpg" alt="Customer feedback screenshot showing a received watch and a thank-you message" width="647" height="1536" fetchpriority="high"></div></div></div></div>` : "";
  const openingScript = showOpening ? `<script>(()=>{const opening=document.getElementById('opening-screen');const app=document.getElementById('app');if(document.documentElement.classList.contains('opening-seen')){opening.remove();}else{app.inert=true;opening.addEventListener('animationend',event=>{if(event.target!==opening)return;app.inert=false;opening.remove();try{sessionStorage.setItem('ggm-opening-seen','1')}catch{}})}})()</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f7f4ed"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="${product ? "product" : "website"}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url.toString())}">${imageMeta}<link rel="icon" href="/favicon.svg" type="image/svg+xml">${showOpening ? `<link rel="preload" href="/feedback/opening.jpg" as="image"><script>try{if(location.pathname!=='/'||sessionStorage.getItem('ggm-opening-seen'))document.documentElement.classList.add('opening-seen')}catch{if(location.pathname!=='/')document.documentElement.classList.add('opening-seen')}</script>` : ""}<link rel="stylesheet" href="/styles.css"></head><body>${opening}<div id="app">${initial}</div>${openingScript}<script>window.GGM_CONFIG=${JSON.stringify({ facebook: FACEBOOK, messenger: MESSENGER })};</script><script src="/app.js" defer></script></body></html>`;
}
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#171813"/><circle cx="32" cy="32" r="21" fill="none" stroke="#c6a56d" stroke-width="1.5"/><path d="M32 17v15l10 6" fill="none" stroke="#c6a56d" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="32" r="2" fill="#c6a56d"/></svg>`;
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/styles.css") return new Response(STYLES, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (pathname === "/app.js") return new Response(CLIENT, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (pathname === "/favicon.svg") return new Response(favicon, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    if (pathname === "/feedback/opening.jpg") return new Response(Uint8Array.from(atob(OPENING_FEEDBACK), (character) => character.charCodeAt(0)), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
    if (/^\/image\/[A-Z0-9-]+$/i.test(pathname)) {
      try {
        const id = pathname.split('/')[2].toUpperCase();
        const catalog = await getCatalog();
        const image = catalog.watches.find((watch) => watch.id === id)?.image;
        if (!image) return new Response('Image not found', { status: 404 });
        const source = new URL(image);
        if (source.protocol !== 'https:' || !(source.hostname === 'docs.google.com' && source.pathname.startsWith('/sheets-images-rt/'))) return new Response('Image source unavailable', { status: 404 });
        const result = await fetch(source.toString(), { signal: AbortSignal.timeout(12000) });
        if (!result.ok) return new Response('Image temporarily unavailable', { status: 502 });
        return new Response(result.body, { headers: { 'content-type': result.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
      } catch { return new Response('Image temporarily unavailable', { status: 502 }); }
    }
    if (pathname === "/api/catalog") {
      try { return Response.json(await getCatalog(), { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=240" } }); }
      catch { return Response.json({ error: "Collection temporarily unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
    }
    if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    if (/^\/watch\/[A-Z0-9-]+$/i.test(pathname)) {
      try {
        const catalog = await getCatalog();
        const product = catalog.watches.find((watch) => watch.id === pathname.split("/")[2].toUpperCase());
        if (!product) return new Response("Watch not found", { status: 404 });
        return new Response(htmlPage(request, product), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
      } catch { return new Response(htmlPage(request), { headers: { "content-type": "text/html; charset=utf-8" } }); }
    }
    if (["/", "/watches", "/favorites", "/contact"].includes(pathname) || /^\/watches\/[a-z0-9-]+$/.test(pathname)) return new Response(htmlPage(request), { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("Page not found", { status: 404 });
  },
};
