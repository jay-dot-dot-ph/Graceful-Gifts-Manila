const app = document.getElementById('app');
const config = window.GGM_CONFIG || {};
const money = (value) => value === null || value === undefined ? 'Price on request' : '₱' + Number(value).toLocaleString('en-PH');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const watchUrl = (watch) => location.origin + '/watch/' + encodeURIComponent(watch.id);
const watchImage = (watch) => watch.localImage || '/image/' + encodeURIComponent(watch.id);
const watchName = (watch) => {
  const model = (watch.model || 'Watch').trim();
  return model.toLowerCase().startsWith(watch.brand.toLowerCase() + ' ') ? model : (watch.brand + ' ' + model).trim();
};
const stockText = (watch) => watch.stock === 0 ? 'Sold out' : watch.stock === null ? 'Availability on request' : watch.stock === 1 ? 'Only 1 remaining' : `${watch.stock} available`;
const stored = () => { try { return JSON.parse(localStorage.getItem('ggm-favorites') || '[]'); } catch { return []; } };
let favorites = new Set(stored());
let selected = new Set();
let catalog = null;
let shown = 24;
let feedbackTimer = null;
// Store-selected best sellers, in display order.
const bestSellerIds = ['CT-W011', 'TG-W004', 'TG-W054', 'RLX-W025', 'RLX-W031'];
let filters = { query: new URLSearchParams(location.search).get('q') || '', brand: '', size: '', dial: '', movement: '', category: '', availability: '', min: '', max: '', sort: 'newest' };
const path = decodeURIComponent(location.pathname);
if (path.startsWith('/watches/')) filters.brand = path.split('/')[2];

function nav(active) {
  const links = [['/', 'Home'], ['/watches', 'Watches'], ['/brands', 'Brands'], ['/favorites', 'Favorites'], ['/contact', 'Contact'], ['/#physical-store', 'Physical Store']];
  return `<header class="site-header"><div class="nav-wrap container"><a class="brand-mark" href="/" aria-label="Graceful Gifts Manila, home"><span class="brand-symbol">G</span><span class="brand-words">GRACEFUL GIFTS<small>MANILA</small></span></a><nav class="desktop-nav" aria-label="Main navigation">${links.map(([href, label]) => `<a href="${href}" ${active === label ? 'aria-current="page"' : ''}>${label}${label === 'Favorites' ? `<span class="fav-count">${favorites.size || ''}</span>` : ''}</a>`).join('')}</nav><div class="nav-actions"><a class="search-shortcut" href="/watches" aria-label="Search watches">⌕</a><button class="menu-button" data-menu type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button></div></div><nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav></header>`;
}
function footer() {
  return `<footer class="site-footer"><div class="container footer-grid"><div><a class="footer-logo" href="/">GRACEFUL GIFTS <span>MANILA</span></a><p>A refined way to discover a watch you love. Browse beautifully, choose easily, inquire instantly.</p></div><div><h3>Explore</h3><a href="/watches">All watches</a><a href="/brands">Shop by brand</a><a href="/favorites">My favorites</a></div><div><h3>Connect</h3><a href="${config.facebook}" target="_blank" rel="noopener">Facebook</a><a href="${config.messenger}" target="_blank" rel="noopener">Messenger</a><a href="tel:+639755996605">0975 599 6605</a></div></div><div class="container footer-bottom"><span>© ${new Date().getFullYear()} Graceful Gifts Manila</span><span>Prices and availability are subject to confirmation.</span></div></footer>`;
}
function card(watch) {
  const saved = favorites.has(watch.id);
  const img = watch.image ? `<img src="${watchImage(watch)}" alt="${esc(watchName(watch))}" loading="lazy" decoding="async" width="500" height="500">` : `<div class="image-placeholder"><span>GGM</span><small>Image coming soon</small></div>`;
  return `<article class="watch-card"><div class="card-image"><a href="/watch/${encodeURIComponent(watch.id)}" aria-label="View ${esc(watchName(watch))}">${img}</a><button class="heart ${saved ? 'saved' : ''}" data-favorite="${esc(watch.id)}" type="button" aria-label="${saved ? 'Remove' : 'Save'} ${esc(watchName(watch))} ${saved ? 'from' : 'to'} favorites" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button>${watch.stock === 0 ? '<span class="image-badge">SOLD OUT</span>' : ''}</div><div class="card-info"><p class="eyebrow">${esc(watch.brand)}</p><h3><a href="/watch/${encodeURIComponent(watch.id)}">${esc(watch.model || 'Watch details on request')}</a></h3><p class="card-meta">${esc([watch.movement, watch.size].filter(Boolean).join(' · ') || watch.id)}</p><div class="card-bottom"><strong>${money(watch.price)}</strong><span class="${watch.stock === 0 ? 'soldout' : ''}">${stockText(watch)}</span></div></div></article>`;
}
function sectionHead(eyebrow, title, link, label) {
  return `<div class="section-head"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div>${link ? `<a class="text-link" href="${link}">${label || 'View all'} <span aria-hidden="true">↗</span></a>` : ''}</div>`;
}
function brandTiles(brands, limit, id = '') {
  return `<div class="brand-grid" ${id ? `id="${id}"` : ''}>${brands.filter((brand) => brand.count).slice(0, limit).map((brand) => `<a class="brand-tile" href="/watches/${brand.slug}"><span>${esc(brand.name)}</span><small>${brand.count} ${brand.count === 1 ? 'watch' : 'watches'} <span aria-hidden="true">↗</span></small></a>`).join('')}</div>`;
}
function isNew(watch) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(watch.dateAdded)) return false;
  const age = Date.now() - Date.parse(watch.dateAdded + 'T00:00:00+08:00');
  return age >= 0 && age <= 90 * 86400000;
}
function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
function mixedBrandPreview(watches, limit, previousIds = []) {
  const byBrand = new Map();
  for (const watch of watches) {
    if (!watch.image || !watch.model) continue;
    const brand = watch.brandSlug || watch.brand;
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(watch);
  }
  const previous = new Set(previousIds);
  const previousBrands = new Set([...byBrand].filter(([, group]) => group.some((watch) => previous.has(watch.id))).map(([brand]) => brand));
  const brands = [...shuffled([...byBrand.keys()].filter((brand) => !previousBrands.has(brand))), ...shuffled(previousBrands)];
  const preview = [];
  for (const brand of brands) {
    const group = byBrand.get(brand);
    const newWatches = group.filter((watch) => !previous.has(watch.id));
    const candidates = newWatches.length ? newWatches : group;
    preview.push(candidates[Math.floor(Math.random() * candidates.length)]);
    if (preview.length === limit) break;
  }
  return preview;
}
function home() {
  const visual = catalog.watches.find((watch) => watch.id === 'RLX-W001' && watch.image) || catalog.watches.find((watch) => watch.image && watch.stock !== 0);
  const arrivals = catalog.watches.filter(isNew).sort((a,b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 4);
  const bestSellers = bestSellerIds.map((id) => catalog.watches.find((watch) => watch.id === id)).filter(Boolean);
  let previousPreview = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem('ggm-home-preview') || '[]');
    if (Array.isArray(saved)) previousPreview = saved;
  } catch {}
  const preview = mixedBrandPreview(catalog.watches, 6, previousPreview);
  try { sessionStorage.setItem('ggm-home-preview', JSON.stringify(preview.map((watch) => watch.id))); } catch {}
  const visualHtml = visual ? `<img src="${watchImage(visual)}" alt="${esc(watchName(visual))}" width="680" height="680"><div class="hero-watch-note"><span>${esc(visual.brand)}</span><strong>${esc(visual.model || visual.id)}</strong><small>Explore the collection ↗</small></div>` : `<div class="hero-monogram">GGM</div>`;
  app.innerHTML = nav('Home') + `<main><section class="hero"><div class="container hero-inner"><div class="hero-copy"><h1>Inspired By<br><em>Love and Elegance</em></h1><div class="hero-actions"><a class="button button-dark" href="/watches">Explore watches <span>↗</span></a><a class="button button-outline" href="/brands">Shop by brand</a></div><div class="hero-stats"><div><strong>${catalog.watches.length}</strong><span>Watches to explore</span></div><div><strong>${catalog.brands.filter((brand) => brand.count).length}</strong><span>Brands in the collection</span></div></div></div><a href="/watch/${visual ? encodeURIComponent(visual.id) : ''}" class="hero-visual" aria-label="Explore ${visual ? esc(watchName(visual)) : 'watches'}"><div class="hero-orbit"></div>${visualHtml}</a></div></section><section class="intro-strip"><div class="container intro-strip-inner"><span>01 &nbsp; DISCOVER</span><i></i><span>02 &nbsp; SAVE YOUR FAVORITES</span><i></i><span>03 &nbsp; INQUIRE DIRECTLY</span></div></section>${bestSellers.length ? `<section class="section container best-sellers-section">${sectionHead('WATCH HIGHLIGHTS', 'Best sellers', '/watches', 'View all watches')}<div class="watch-grid">${bestSellers.map(card).join('')}</div></section>` : ''}<section class="section container arrivals-section">${sectionHead('FRESH TO THE COLLECTION', 'New arrivals', '/watches', 'Explore all watches')}${arrivals.length ? `<div class="watch-grid">${arrivals.map(card).join('')}</div>` : `<div class="quiet-panel"><p>New arrivals will appear here when their date is recorded in the collection.</p><a class="text-link" href="/watches">Explore all watches ↗</a></div>`}</section><section class="section brands-section" id="brands"><div class="container">${sectionHead('A WORLD OF WATCHMAKING', 'Shop by brand', '/brands', 'View all brands')}${brandTiles(catalog.brands, 12)}</div></section><section class="section container collection-section">${sectionHead('THE COLLECTION', 'Find the one that stays with you', '/watches', 'View all watches')}<div class="watch-grid">${preview.map(card).join('')}</div></section><section class="story-section visit-section" id="physical-store"><div class="container visit-layout"><div class="visit-intro"><p class="eyebrow">VISIT OUR STORE</p><h2>A closer look at<br><em>Graceful Gifts Manila.</em></h2><a class="button button-light" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=14.6084144%2C120.9940068&heading=231.21&pitch=-2.39&fov=75" target="_blank" rel="noopener">View store <span aria-hidden="true">↗</span></a></div><aside class="visit-card"><p class="visit-card-label">FORBES COMMERCIAL</p><address>785 Lacson Ave.<br>Sampaloc, Manila 1008</address><dl class="visit-facts"><div><dt>OPEN DAILY</dt><dd>11:00 AM – 8:00 PM</dd></div><div><dt>CALL THE STORE</dt><dd><a href="tel:+639755996605">0975 599 6605</a></dd></div></dl></aside></div></section><section class="section container featured-section">${sectionHead('COMING TO THE SHOWROOM', 'Featured watches')}<div class="quiet-panel"><p>Handpicked features will appear here when the collection marks them for display.</p></div></section>${feedbackSection()}<section class="contact-banner"><div class="container contact-banner-inner"><div><p class="eyebrow">LET'S TALK WATCHES</p><h2>Found something you love?</h2><p>Send us the watch details through Messenger and our team can help with availability.</p></div><a class="button button-dark" href="${config.messenger}" target="_blank" rel="noopener">Message us on Messenger ↗</a></div></section></main>` + footer();
  afterRender();
}
function feedbackSection() {
  const images = config.feedbackImages || [];
  if (!images.length) return '';
  return `<section class="section container feedback-section">${sectionHead('WORDS FROM OUR COMMUNITY', 'Customer feedback')}<div class="feedback-gallery">${images.map((src, i) => `<img src="${esc(src)}" alt="Customer feedback ${i + 1}" loading="lazy">`).join('')}</div></section>`;
}
function optionList(values, selectedValue, first) {
  return `<option value="">${first}</option>${[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map((value)=>`<option value="${esc(value)}" ${value === selectedValue ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
}
function filterForm() {
  const rows = catalog.watches;
  return `<div class="filter-heading"><h2>Filter watches</h2><button type="button" data-close-filters aria-label="Close filters">×</button></div><label>Brand<select data-filter="brand"><option value="">All brands</option>${catalog.brands.map((brand) => `<option value="${esc(brand.slug)}" ${filters.brand === brand.slug ? 'selected' : ''}>${esc(brand.name)}</option>`).join('')}</select></label><label>Size<select data-filter="size">${optionList(rows.map((watch) => watch.size), filters.size, 'All sizes')}</select></label><label>Dial color<select data-filter="dial">${optionList(rows.map((watch) => watch.dialColor), filters.dial, 'All colors')}</select></label><label>Movement<select data-filter="movement">${optionList(rows.map((watch) => watch.movement), filters.movement, 'All movements')}</select></label><label>Category<select data-filter="category">${optionList(rows.map((watch) => watch.category), filters.category, 'All categories')}</select></label><label>Availability<select data-filter="availability"><option value="">All watches</option><option value="instock" ${filters.availability === 'instock' ? 'selected' : ''}>In stock</option><option value="soldout" ${filters.availability === 'soldout' ? 'selected' : ''}>Sold out</option></select></label><div class="price-fields"><label>Min price<input type="number" min="0" inputmode="numeric" placeholder="₱ 0" data-filter="min" value="${esc(filters.min)}"></label><label>Max price<input type="number" min="0" inputmode="numeric" placeholder="Any" data-filter="max" value="${esc(filters.max)}"></label></div><button class="clear-button" type="button" data-clear>Clear filters</button>`;
}
function filteredRows() {
  const q = filters.query.trim().toLowerCase();
  const rows = catalog.watches.filter((watch) => {
    if (filters.brand && watch.brandSlug !== filters.brand) return false;
    if (filters.size && watch.size !== filters.size) return false;
    if (filters.dial && watch.dialColor !== filters.dial) return false;
    if (filters.movement && watch.movement !== filters.movement) return false;
    if (filters.category && watch.category !== filters.category) return false;
    if (filters.availability === 'instock' && !(watch.stock > 0)) return false;
    if (filters.availability === 'soldout' && watch.stock !== 0) return false;
    if (filters.min && (watch.price === null || watch.price < Number(filters.min))) return false;
    if (filters.max && (watch.price === null || watch.price > Number(filters.max))) return false;
    if (q && ![watch.id, watch.brand, watch.model, watch.size, watch.category, watch.dialColor, watch.caseMaterial, watch.strapMaterial, watch.movement, watch.description].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
  if (filters.sort === 'price-asc') rows.sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else if (filters.sort === 'price-desc') rows.sort((a,b) => (b.price ?? -1) - (a.price ?? -1));
  else if (filters.sort === 'brand') rows.sort((a,b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  else rows.sort((a,b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
  return rows;
}
function updateResults() {
  const rows = filteredRows();
  const count = document.getElementById('result-count');
  const target = document.getElementById('catalog-results');
  if (!target) return;
  count.textContent = `${rows.length} ${rows.length === 1 ? 'watch' : 'watches'}`;
  target.innerHTML = rows.length ? `<div class="watch-grid">${rows.slice(0, shown).map(card).join('')}</div>${rows.length > shown ? `<button type="button" class="button button-outline load-more" data-load-more>Load more watches</button>` : ''}` : `<div class="empty-state"><h3>No watches found</h3><p>Try another search or clear your filters.</p><button class="button button-dark" type="button" data-clear>Clear filters</button></div>`;
}
function brandsPage() {
  const brands = catalog.brands.filter((brand) => brand.count);
  document.title = 'Watch Brands | Graceful Gifts Manila';
  app.innerHTML = nav('Brands') + `<main><section class="page-heading brands-page-heading"><div class="container"><p class="eyebrow">A WORLD OF WATCHMAKING</p><h1>Explore our brands</h1><p>Choose a brand to see its watches.</p></div></section><section class="section container brands-page-content"><div class="brands-page-topline"><p class="eyebrow">ALL BRANDS</p><span>${brands.length} brands in the collection</span></div>${brandTiles(brands)}</section></main>` + footer();
  afterRender();
}
function catalogPage() {
  const brand = catalog.brands.find((item) => item.slug === filters.brand);
  app.innerHTML = nav('Watches') + `<main><section class="page-heading catalog-heading"><div class="container catalog-container"><p class="eyebrow">THE COLLECTION</p><h1>${brand ? esc(brand.name) + ' watches' : 'Explore the collection'}</h1></div></section><section class="container catalog-container brand-list-section" id="brands">${brandTiles(catalog.brands, undefined, 'catalog-brand-grid')}<button class="brand-toggle" type="button" data-brand-toggle aria-controls="catalog-brand-grid" aria-expanded="false">See more brands</button></section><section class="container catalog-container catalog-layout"><aside class="filters" id="filters-panel">${filterForm()}</aside><div class="catalog-main"><div class="catalog-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="catalog-search" type="search" placeholder="Search brand, model, Watch ID…" value="${esc(filters.query)}" aria-label="Search watches"></label><button class="mobile-filter-button" type="button" data-open-filters>Filter & sort <span>☷</span></button><label class="sort-control">Sort by <select id="catalog-sort"><option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="brand">Brand: A–Z</option></select></label></div><div class="catalog-count"><span id="result-count"></span><span>Prices in Philippine pesos</span></div><div id="catalog-results"></div></div></section></main><div class="filter-backdrop" data-close-filters></div>` + footer();
  document.getElementById('catalog-sort').value = filters.sort;
  document.querySelector('[data-brand-toggle]').addEventListener('click', (event) => {
    const expanded = document.getElementById('brands').classList.toggle('expanded');
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = expanded ? 'See fewer brands' : 'See more brands';
  });
  document.getElementById('catalog-search').addEventListener('input', (event) => { filters.query = event.target.value; shown = 24; updateResults(); });
  document.getElementById('catalog-sort').addEventListener('change', (event) => { filters.sort = event.target.value; shown = 24; updateResults(); });
  document.querySelectorAll('[data-filter]').forEach((field) => field.addEventListener('input', (event) => {
    if (event.target.dataset.filter === 'brand') {
      location.assign(event.target.value ? `/watches/${encodeURIComponent(event.target.value)}` : '/watches');
      return;
    }
    filters[event.target.dataset.filter] = event.target.value; shown = 24; updateResults();
  }));
  updateResults(); afterRender();
}
function detailPage(watch) {
  if (!watch) { app.innerHTML = nav('Watches') + `<main class="container empty-state"><h1>Watch not found</h1><p>This watch may no longer be listed.</p><a class="button button-dark" href="/watches">Browse watches</a></main>` + footer(); afterRender(); return; }
  const specs = [['Brand', watch.brand], ['Model', watch.model], ['Watch ID', watch.id], ['Size', watch.size], ['Category', watch.category], ['Dial color', watch.dialColor], ['Case material', watch.caseMaterial], ['Strap material', watch.strapMaterial], ['Movement', watch.movement]];
  app.innerHTML = nav('Watches') + `<main class="container detail-page"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/watches">Watches</a><span>/</span><a href="/watches/${watch.brandSlug}">${esc(watch.brand)}</a><span>/</span><span>${esc(watch.model || watch.id)}</span></nav><div class="detail-grid"><div class="detail-image">${watch.image ? `<img src="${watchImage(watch)}" alt="${esc(watchName(watch))}" width="800" height="800">` : `<div class="image-placeholder"><span>GGM</span><small>Image coming soon</small></div>`}</div><div class="detail-copy"><p class="eyebrow">${esc(watch.brand)}</p><h1>${esc(watch.model || 'Watch details on request')}</h1><p class="watch-id">Watch ID: ${esc(watch.id)}</p><div class="detail-rule"></div><div class="detail-price">${money(watch.price)}</div><div class="detail-stock ${watch.stock === 0 ? 'soldout' : ''}"><span class="stock-dot"></span>${stockText(watch)}</div><p class="detail-description">${esc(watch.description || 'Please message us for full details about this watch.')}</p><div class="detail-actions"><button class="button button-dark inquiry-button" type="button" data-inquire="${esc(watch.id)}">${watch.stock === 0 ? 'Ask about this watch' : 'Message to inquire'} <span>↗</span></button><button class="button button-outline favorite-detail ${favorites.has(watch.id) ? 'saved' : ''}" type="button" data-favorite="${esc(watch.id)}">${favorites.has(watch.id) ? '♥ Saved' : '♡ Favorite'}</button></div><p class="inquiry-note">Your message will be copied first, then you can open Messenger and paste it.</p><button class="share-link" type="button" data-share="${esc(watch.id)}">Copy watch page link ↗</button></div></div><section class="specs-section"><div><p class="eyebrow">THE DETAILS</p><h2>Watch specifications</h2></div><dl class="specs-grid">${specs.filter(([,value]) => value).map(([label,value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></section><section class="related-section">${sectionHead('KEEP EXPLORING', 'More from ' + esc(watch.brand), '/watches/' + watch.brandSlug, 'View brand')}<div class="watch-grid">${catalog.watches.filter((item) => item.id !== watch.id && item.brandSlug === watch.brandSlug).slice(0, 4).map(card).join('')}</div></section></main><div class="mobile-inquiry-bar"><span>${watch.stock === 0 ? 'SOLD OUT' : money(watch.price)}</span><button type="button" data-inquire="${esc(watch.id)}">${watch.stock === 0 ? 'Ask about this watch' : 'Message to inquire'} ↗</button></div>` + footer();
  afterRender();
}
function favoritesPage() {
  const rows = catalog.watches.filter((watch) => favorites.has(watch.id));
  selected = new Set([...selected].filter((id) => favorites.has(id)));
  app.innerHTML = nav('Favorites') + `<main><section class="page-heading"><div class="container"><p class="eyebrow">YOUR SHORTLIST</p><h1>My favorites</h1></div></section><section class="container favorites-content">${rows.length ? `<div class="favorites-toolbar"><span>${rows.length} saved ${rows.length === 1 ? 'watch' : 'watches'}</span><button type="button" data-select-all>${selected.size === rows.length ? 'Deselect all' : 'Select all'}</button></div><div class="favorites-list">${rows.map((watch) => `<div class="favorite-row"><label class="select-watch"><input type="checkbox" data-select="${esc(watch.id)}" ${selected.has(watch.id) ? 'checked' : ''}><span class="visually-hidden">Select ${esc(watchName(watch))}</span></label><a href="/watch/${encodeURIComponent(watch.id)}" class="favorite-photo">${watch.image ? `<img src="${watchImage(watch)}" alt="${esc(watchName(watch))}" loading="lazy">` : '<span>GGM</span>'}</a><div class="favorite-description"><p class="eyebrow">${esc(watch.brand)}</p><h2><a href="/watch/${encodeURIComponent(watch.id)}">${esc(watch.model || watch.id)}</a></h2><small>${esc(watch.id)} · ${stockText(watch)}</small></div><strong>${money(watch.price)}</strong><button type="button" class="remove-favorite" data-favorite="${esc(watch.id)}" aria-label="Remove ${esc(watchName(watch))} from favorites">×</button></div>`).join('')}</div><div class="favorites-actions"><span>${selected.size} selected</span><button class="button button-dark" type="button" data-inquire-selected ${selected.size ? '' : 'disabled'}>Inquire about selected ↗</button></div>` : `<div class="empty-state"><h2>You haven't saved any watches yet.</h2><p>Explore the collection and tap a heart to make your shortlist.</p><a class="button button-dark" href="/watches">Browse watches ↗</a></div>`}</section></main>` + footer();
  afterRender();
}
function contactPage() {
  app.innerHTML = nav('Contact') + `<main><section class="page-heading"><div class="container"><p class="eyebrow">HERE TO HELP</p><h1>Let's talk watches.</h1><p>Questions about a piece? We would love to hear from you.</p></div></section><section class="container contact-page"><div class="contact-intro"><h2>Choose the way that works for you.</h2><p>For the fastest watch inquiry, open a watch page and copy its prepared message before opening Messenger. We will know exactly which piece you mean.</p></div><div class="contact-methods"><a class="contact-method" href="${config.messenger}" target="_blank" rel="noopener"><span class="contact-icon">↗</span><div><small>CHAT WITH US</small><h3>Messenger</h3><p>Send a direct message to Graceful Gifts Manila.</p></div><span>↗</span></a><a class="contact-method" href="tel:+639755996605"><span class="contact-icon">☎</span><div><small>GIVE US A CALL</small><h3>0975 599 6605</h3><p>Call us from your mobile phone.</p></div><span>↗</span></a><a class="contact-method" href="viber://chat?number=%2B639755996605"><span class="contact-icon">✦</span><div><small>MESSAGE ON VIBER</small><h3>0975 599 6605</h3><p>Open a conversation in Viber.</p></div><span>↗</span></a><a class="contact-method" href="${config.facebook}" target="_blank" rel="noopener"><span class="contact-icon">f</span><div><small>FOLLOW THE PAGE</small><h3>Facebook</h3><p>Visit our official Graceful Gifts Manila page.</p></div><span>↗</span></a></div></section></main>` + footer();
  afterRender();
}
function notice(message) {
  let live = document.getElementById('live-notice');
  if (!live) { live = document.createElement('div'); live.id = 'live-notice'; live.className = 'toast'; live.setAttribute('role', 'status'); document.body.appendChild(live); }
  live.textContent = message; live.classList.add('visible');
  clearTimeout(live._hide); live._hide = setTimeout(() => live.classList.remove('visible'), 3500);
}
function updateFavorite(id) {
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  try { localStorage.setItem('ggm-favorites', JSON.stringify([...favorites])); } catch { notice('Favorites could not be saved on this browser.'); }
  if (path === '/favorites') favoritesPage();
  else if (path.startsWith('/watch/')) detailPage(catalog.watches.find((watch) => watch.id === path.split('/')[2].toUpperCase()));
  else if (path === '/') home(); else if (path.startsWith('/watches')) catalogPage();
}
function inquiryMessage(watches) {
  if (watches.length === 1) {
    const watch = watches[0];
    return `Hello Graceful Gifts Manila!\n\nI saw this watch on your website:\n${watchName(watch)}\nWatch ID: ${watch.id}\nPrice: ${money(watch.price)}\nWatch link: ${watchUrl(watch)}\n\n${watch.stock === 0 ? 'I noticed it is currently sold out. Do you have another unit or a similar model available?' : 'Is this still available?'}`;
  }
  return `Hello Graceful Gifts Manila!\n\nI'm interested in these watches:\n\n${watches.map((watch, index) => `${index + 1}. ${watchName(watch)}\n   Watch ID: ${watch.id}\n   ${money(watch.price)}\n   ${watchUrl(watch)}`).join('\n\n')}\n\nWhich of these are currently available?`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const box = document.createElement('textarea'); box.value = text; box.style.position = 'fixed'; box.style.opacity = '0'; document.body.appendChild(box); box.select();
    const copied = document.execCommand('copy'); box.remove(); return copied;
  }
}
async function handleInquiry(button, watches) {
  if (button.dataset.copied === 'true') { window.open(config.messenger, '_blank', 'noopener'); return; }
  if (!watches.length) { notice('Select at least one watch first.'); return; }
  try {
    if (!await copyText(inquiryMessage(watches))) throw new Error('Copy failed');
    button.dataset.copied = 'true'; button.textContent = '✓ Message copied — Open Messenger';
    button.classList.add('copied'); notice('Message copied. Open Messenger and paste it.');
  } catch { notice('Could not copy the message. Please check clipboard permission.'); }
}
function afterRender() {
  if (catalog?.partial || catalog?.stale) {
    const warning = document.createElement('div'); warning.className = 'data-warning'; warning.textContent = 'Some catalog information may be temporarily unavailable. Please confirm details with us.';
    document.querySelector('main')?.prepend(warning);
  }
}
function startFeedback() {
  const images = config.feedbackImages || [];
  if (!images.length) return;
  let index = 0;
  const show = () => {
    const old = document.getElementById('feedback-float'); if (old) old.remove();
    const box = document.createElement('div'); box.id = 'feedback-float'; box.className = 'feedback-float';
    box.innerHTML = `<button type="button" aria-label="Dismiss customer feedback" data-dismiss-feedback>×</button><p>Customer feedback</p><img src="${esc(images[index % images.length])}" alt="Customer feedback image" loading="lazy">`;
    document.body.appendChild(box); requestAnimationFrame(() => box.classList.add('visible'));
    setTimeout(() => { box.classList.remove('visible'); setTimeout(() => box.remove(), 400); }, 6500);
    index++; feedbackTimer = setTimeout(show, 22000);
  };
  feedbackTimer = setTimeout(show, 6500);
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.matches('[data-menu]')) { const menu = document.getElementById('mobile-nav'); const open = menu.classList.toggle('open'); button.setAttribute('aria-expanded', String(open)); return; }
  if (button.matches('[data-favorite]')) { updateFavorite(button.dataset.favorite); return; }
  if (button.matches('[data-open-filters]')) { document.body.classList.add('filters-open'); return; }
  if (button.matches('[data-close-filters]')) { document.body.classList.remove('filters-open'); return; }
  if (button.matches('[data-clear]')) {
    if (location.pathname !== '/watches' || location.search) { location.assign('/watches'); return; }
    filters = { query:'', brand:'', size:'', dial:'', movement:'', category:'', availability:'', min:'', max:'', sort:'newest' }; shown = 24; catalogPage(); return;
  }
  if (button.matches('[data-load-more]')) { shown += 24; updateResults(); return; }
  if (button.matches('[data-inquire]')) { const watch = catalog.watches.find((item) => item.id === button.dataset.inquire); await handleInquiry(button, watch ? [watch] : []); return; }
  if (button.matches('[data-inquire-selected]')) { await handleInquiry(button, catalog.watches.filter((watch) => selected.has(watch.id))); return; }
  if (button.matches('[data-select-all]')) { const rows = catalog.watches.filter((watch) => favorites.has(watch.id)); selected = selected.size === rows.length ? new Set() : new Set(rows.map((watch) => watch.id)); favoritesPage(); return; }
  if (button.matches('[data-share]')) { const watch = catalog.watches.find((item) => item.id === button.dataset.share); if (watch && await copyText(watchUrl(watch))) notice('Watch link copied.'); return; }
  if (button.matches('[data-dismiss-feedback]')) { document.getElementById('feedback-float')?.remove(); return; }
});
document.addEventListener('change', (event) => { if (event.target.matches('[data-select]')) { if (event.target.checked) selected.add(event.target.dataset.select); else selected.delete(event.target.dataset.select); favoritesPage(); } });
async function init() {
  try {
    const response = await fetch('/api/catalog'); if (!response.ok) throw new Error('Catalog request failed');
    catalog = await response.json(); if (!Array.isArray(catalog.watches)) throw new Error('Invalid catalog');
    if (path === '/') home(); else if (path === '/brands') brandsPage(); else if (path === '/favorites') favoritesPage(); else if (path === '/contact') contactPage();
    else if (path.startsWith('/watch/')) detailPage(catalog.watches.find((watch) => watch.id === path.split('/')[2].toUpperCase()));
    else catalogPage();
    if (location.hash === '#physical-store') requestAnimationFrame(() => document.getElementById('physical-store')?.scrollIntoView());
    startFeedback();
  } catch {
    app.innerHTML = nav('') + `<main class="container empty-state"><h1>We're having trouble loading the collection.</h1><p>Please try again in a moment, or contact us directly.</p><button class="button button-dark" onclick="location.reload()" type="button">Try again</button><a class="text-link" href="${config.messenger}" target="_blank" rel="noopener">Message us on Messenger ↗</a></main>` + footer();
  }
}
init();
