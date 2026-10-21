export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function watchCard(record, className = 'chat-product') {
  const id = String(record?.id || '');
  if (!/^[A-Z0-9-]{2,20}$/.test(id)) return '';
  const image = /^\/images\/[A-Za-z0-9._-]+$/.test(record.image || '') ? record.image : '';
  const size = typeof record.size === 'string' && record.size.trim() ? record.size.trim() : '';
  const stock = Number.isInteger(record.stock) && record.stock >= 0 ? record.stock === 0 ? 'Sold out' : record.stock === 1 ? '1 available' : `${record.stock} available` : '';
  const price = Number.isFinite(record.price) && record.price >= 0 ? `₱${record.price.toLocaleString('en-PH')}` : 'Price on request';
  const name = record.name || id;
  return `<a class="${className}" href="/watch/${encodeURIComponent(id)}" target="_blank" rel="noopener"><span class="chat-watch-photo">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy">` : '<span aria-hidden="true">GGM</span>'}</span><span class="chat-watch-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(record.brand || '')} · ID ${escapeHtml(id)}</small><small>${escapeHtml([price, size, stock].filter(Boolean).join(' · '))}</small></span></a>`;
}

export function receiptLabel(message) {
  if (message.failed) return 'Failed · Retry';
  if (message.pending || message.metadata?.hasPendingWrites) return 'Sending…';
  if (message.seenAt) return 'Seen';
  if (message.deliveredAt) return 'Delivered';
  return 'Sent';
}

export function isVisibleInThread(element, scroller) {
  if (!element || !scroller || document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  const a = element.getBoundingClientRect(), b = scroller.getBoundingClientRect();
  return a.height > 0 && a.top < b.bottom - 12 && a.bottom > b.top + 12;
}

export function bindBrokenImages(root) {
  root.querySelectorAll('.chat-watch-photo img').forEach((image) => {
    image.addEventListener('error', () => { image.replaceWith(Object.assign(document.createElement('span'), { textContent: 'GGM' })); }, { once: true });
  });
}
