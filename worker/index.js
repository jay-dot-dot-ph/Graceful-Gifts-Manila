// The build embeds styles.css and client.js into this single Worker module.
const STYLES = "__STYLES__";
const OPENING_STYLES = "__OPENING_STYLES__";
const CLIENT = "__CLIENT__";
const OPENING_SCRIPT = "__OPENING_SCRIPT__";
const OPENING_BG = "__OPENING_BG__";
const OPENING_BG_PATH = "__OPENING_BG_PATH__";
const FEEDBACK_IMAGES = "__FEEDBACK_IMAGES__";
const FACEBOOK = "https://www.facebook.com/GracefulGifts.Manila";
const MESSENGER = "https://m.me/GracefulGifts.Manila";
let catalogCache = null;
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

export function normalizeRows(csv, tabName, images = new Map()) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error(`Missing headers in ${tabName}`);
  const columns = new Map(rows[0].map((header, index) => [String(header).trim().toLowerCase(), index]));
  for (const header of ["watch id", "model name", "price (php)", "stock quantity"]) {
    if (!columns.has(header)) throw new Error(`Missing ${header} column in ${tabName}`);
  }
  const cell = (row, header) => String(row[columns.get(header)] || "").trim();
  const watches = [];
  for (const cells of rows.slice(1)) {
    const id = cell(cells, "watch id").toUpperCase();
    if (!/^[A-Z0-9-]{2,20}$/.test(id)) continue;
    const model = cell(cells, "model name");
    if (!model) continue;
    const rawPrice = cell(cells, "price (php)").replace(/[^\d.]/g, "");
    const rawStock = cell(cells, "stock quantity");
    const imageUrl = cell(cells, "image url");
    watches.push({
      id, brand: cell(cells, "brand") || tabName, brandTab: tabName, brandSlug: slug(tabName),
      model, size: cell(cells, "size"),
      category: cell(cells, "category"), dialColor: cell(cells, "dial color"),
      caseMaterial: cell(cells, "case material"), strapMaterial: cell(cells, "strap material"),
      movement: cell(cells, "movement type"),
      price: rawPrice && Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null,
      stock: /^\d+$/.test(rawStock) ? Number(rawStock) : null,
      description: cell(cells, "description"),
      image: images.get(id) || (/^https:\/\//i.test(imageUrl) ? imageUrl : null),
      dateAdded: cell(cells, "date added"),
    });
  }
  return watches;
}

export async function getCatalog() {
  if (!catalogCache) throw new Error('The catalog must be loaded by the static build.');
  return catalogCache;
}
export function setCatalogForBuild(catalog) {
  catalogCache = { ...catalog, fetchedAt: new Date().toISOString() };
}

function htmlPage(request, product = null) {
  const url = new URL(request.url);
  const showOpening = url.pathname === "/";
  const title = product ? `${watchName(product)} | Graceful Gifts Manila` : "Graceful Gifts Manila | Luxury Watch Collection";
  const description = product ? `View ${watchName(product)}, ID ${product.id}, and inquire with Graceful Gifts Manila.` : "Explore watches by brand, price, and style. Save favorites and inquire with Graceful Gifts Manila.";
  const imagePath = product?.image ? `${url.origin}/image/${encodeURIComponent(product.id)}` : null;
  const imageMeta = imagePath ? `<meta property="og:image" content="${escapeHtml(imagePath)}">` : "";
  const initial = product ? `<main class="container product-initial"><p class="eyebrow">WATCH DETAILS</p><h1>${escapeHtml(watchName(product))}</h1><p>Watch ID ${escapeHtml(product.id)}</p>${imagePath ? `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(watchName(product))}" width="540" height="540">` : ""}<p>${product.price === null ? "Price on request" : `₱${product.price.toLocaleString("en-PH")}`}</p></main>` : `<main class="container loading-screen"><p>Preparing the collection…</p></main>`;
  const opening = showOpening ? `<div id="opening-screen" class="opening-screen" role="status" aria-label="Preparing the Graceful Gifts Manila collection"><div class="opening-content"><div class="opening-brand"><span class="opening-mark" aria-hidden="true">G</span><p class="opening-name">GRACEFUL GIFTS <span>MANILA</span></p><span class="opening-rule" aria-hidden="true"></span><p class="opening-message">Preparing your collection</p></div><div class="opening-collage" aria-hidden="true">${FEEDBACK_IMAGES.map((image) => `<figure class="opening-feedback" data-width="${image.width}" data-height="${image.height}"><img src="data:image/jpeg;base64,${image.base64}" alt="" width="${image.width}" height="${image.height}" loading="eager" decoding="async"></figure>`).join("")}</div></div></div>` : "";
  const openingScript = showOpening ? `<script>${OPENING_SCRIPT}</script>` : "";
  const styles = showOpening ? `<style>${OPENING_STYLES}</style><link rel="preload" as="image" href="${OPENING_BG_PATH}"><link rel="preload" as="style" href="/styles.css" onload="this.onload=null;this.rel='stylesheet';document.documentElement.classList.add('site-styles-ready')"><noscript><link rel="stylesheet" href="/styles.css"></noscript>` : `<link rel="stylesheet" href="/styles.css">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f7f4ed"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="${product ? "product" : "website"}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url.toString())}">${imageMeta}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><script>(()=>{let seen=false;try{seen=sessionStorage.getItem('ggm-opening-seen')==='1';sessionStorage.setItem('ggm-opening-seen','1')}catch{}if(${showOpening}&&(location.pathname!=='/'||((seen||location.hash==='#physical-store')&&performance.getEntriesByType('navigation')[0]?.type!=='reload')))document.documentElement.classList.add('opening-route-skip')})()</script>${styles}</head><body>${opening}<div id="app">${initial}</div>${openingScript}<script>window.GGM_CONFIG=${JSON.stringify({ facebook: FACEBOOK, messenger: MESSENGER })};</script><script src="/app.js" defer></script></body></html>`;
}
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#171813"/><circle cx="32" cy="32" r="21" fill="none" stroke="#c6a56d" stroke-width="1.5"/><path d="M32 17v15l10 6" fill="none" stroke="#c6a56d" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="32" r="2" fill="#c6a56d"/></svg>`;
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/styles.css") return new Response(STYLES, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (pathname === "/app.js") return new Response(CLIENT, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (pathname === "/favicon.svg") return new Response(favicon, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    if (pathname === OPENING_BG_PATH) return new Response(Uint8Array.from(atob(OPENING_BG), (character) => character.charCodeAt(0)), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    const feedback = FEEDBACK_IMAGES.find((image) => image.path === pathname);
    if (feedback) return new Response(Uint8Array.from(atob(feedback.base64), (character) => character.charCodeAt(0)), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
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
    if (["/", "/watches", "/brands", "/favorites", "/contact"].includes(pathname) || /^\/watches\/[a-z0-9-]+$/.test(pathname)) return new Response(htmlPage(request), { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("Page not found", { status: 404 });
  },
};
