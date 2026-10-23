import { firebase, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, collection, query, where, orderBy, limit, startAfter, getDoc, getDocs, onSnapshot, runTransaction, writeBatch, updateDoc, setDoc, deleteDoc, serverTimestamp, sendMessage, newMessageId, displayError } from './firebase.js';
import { acknowledge, subscribeReceipts, olderReceipts, status, bubbleVisible } from './receipts.js';
import { createNotifier, soundIcon } from './notify.js';
import { guestIdentity } from './guest.js';
import { displayMessage } from './message-text.js';
import { enablePush, refreshPush, revokePush, pushEnabled, pushAvailable } from './push.js';
import { mediaEnabled, checkFile, uploadMedia, deleteChatMedia, mediaMarkup, hydrateMedia } from './media.js';

const root = document.getElementById('admin-app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stamp = (value) => value?.toDate ? value.toDate().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now';
const state = { user: null, profile: null, staff: [], activity: [], settings: { staffSoundEnabled: false, storeAvatarUrl: '' }, rows: [], selected: null, threadReady: false, threadSynced: false, messages: [], older: [], receipts: new Map(), inboxReceipts: new Map(), inboxReceiptListeners: new Map(), expandedTimes: new Set(), first: null, page: 'chat', filter: 'all', search: '', cursor: null, more: false, error: '', notice: '', noticeCentered: false, deletingId: null, loading: true, unread: 0, inboxInitialized: false, knownInbox: new Map(), pushActive: false, pushAvailable: false, replyDraft: '', replySending: false, pendingReply: null, attachment: null, uploadProgress: 0, mediaAvailable: false, blocked: false, moderationBusy: false, staffCreating: false, readInFlight: false, unsubInbox: null, unsubSelected: null, unsubMessages: null, unsubReceipts: null, unsubBlock: null, unsubProfile: null, unsubStaff: null, unsubActivity: null, unsubSettings: null };
const sound = createNotifier('staff', () => updateHeader());
let noticeTimer, deepLinkHandled = false;
function cleanup() { if (previewDialog?.open) previewDialog.close(); for (const listener of state.inboxReceiptListeners.values()) listener.unsubscribe(); state.inboxReceiptListeners.clear(); state.inboxReceipts.clear(); for (const key of ['unsubInbox', 'unsubSelected', 'unsubMessages', 'unsubReceipts', 'unsubBlock', 'unsubProfile', 'unsubStaff', 'unsubActivity', 'unsubSettings']) { state[key]?.(); state[key] = null; } }
function profileName(uid) { return state.staff.find((person) => person.id === uid)?.displayName || (uid ? 'Staff member' : 'Unassigned'); }
function product(watch) { if (!/^[A-Z0-9-]{2,20}$/.test(watch.id || '')) return ''; const image = /^\/images\/[A-Za-z0-9._-]+$/.test(watch.image || '') ? watch.image : ''; const detail = [watch.id, watch.brand, watch.price == null ? 'Price on request' : `₱${Number(watch.price).toLocaleString('en-PH')}`, watch.size || ''].filter(Boolean).join(' · '); return `<button type="button" class="admin-product" data-preview-product="${esc(watch.id)}" aria-label="Preview ${esc(watch.name || watch.id)}"><span class="chat-watch-photo">${image ? `<img src="${esc(image)}" alt="${esc(watch.name || watch.id)}" loading="lazy">` : '<span aria-hidden="true">G</span>'}</span><span><strong>${esc(watch.name || watch.id)}</strong><small>${esc(detail)}</small></span></button>`; }
function adminMessage(message) {
  const showTime = state.expandedTimes.has(`${state.selected}/${message.id}`);
  return `<div class="admin-message ${message.senderRole === 'customer' ? 'customer' : 'staff'}${message.productReferences?.length ? ' has-product' : ''}" data-message-id="${esc(message.id)}" tabindex="0" aria-expanded="${showTime}" title="Click to ${showTime ? 'hide' : 'show'} date and time"><p>${esc(displayMessage(message.message))}</p>${(message.productReferences || []).map(product).join('')}<small class="admin-message-time" ${showTime ? '' : 'hidden'}>${stamp(message.createdAt)}</small></div>`;
}
function toggleAdminMessageTime(bubble) {
  const id = bubble?.dataset.messageId, label = bubble?.querySelector('.admin-message-time');
  if (!id || !label) return;
  const key = `${state.selected}/${id}`, show = !state.expandedTimes.has(key);
  if (show) state.expandedTimes.add(key); else state.expandedTimes.delete(key);
  label.hidden = !show;
  bubble.setAttribute('aria-expanded', String(show));
  bubble.title = show ? 'Click to hide date and time' : 'Click to show date and time';
}
function avatar(identity) { return `<span class="guest-avatar guest-shape-${identity.shape}" style="--guest-color:${identity.color}" aria-hidden="true">${identity.mark}</span>`; }
function customerLabel(item) { const identity = guestIdentity(item.id, item.customerName); return `<span class="guest-identity">${avatar(identity)}<span class="guest-names"><strong>${esc(identity.label)}</strong>${identity.label !== identity.reference ? `<small>${esc(identity.reference)}</small>` : ''}</span></span>`; }
function unreadConversation(item) { return item.lastSenderRole === 'customer' && (!item.staffReadAt || item.lastMessageAt?.toMillis() > item.staffReadAt?.toMillis()); }
function keepNewerReadMarker(item, previous) {
  if (!previous || item.lastMessageId !== previous.lastMessageId) return item;
  const previousRead = previous.staffReadAt?.toMillis?.();
  const incomingRead = item.staffReadAt?.toMillis?.();
  return previousRead != null && (incomingRead == null || previousRead > incomingRead) ? { ...item, staffReadAt: previous.staffReadAt } : item;
}
let previewDialog, catalogPromise;
function openProductPreview(id, opener) {
  const conversation = state.rows.find((item) => item.id === state.selected);
  const watches = [...(conversation?.productReferences || []), ...[...state.older, ...state.messages].flatMap((item) => item.productReferences || [])];
  const watch = watches.find((item) => item.id === id);
  if (!watch) return;
  if (!previewDialog) {
    previewDialog = document.createElement('dialog'); previewDialog.className = 'admin-product-dialog'; document.body.append(previewDialog);
    previewDialog.addEventListener('click', (event) => { if (event.target === previewDialog) previewDialog.close(); });
  }
  const image = /^\/images\/[A-Za-z0-9._-]+$/.test(watch.image || '') ? watch.image : '';
  const facts = [['Brand', watch.brand], ['Watch ID', watch.id], ['Price', watch.price == null ? 'Price on request' : `₱${Number(watch.price).toLocaleString('en-PH')}`], ['Size', watch.size]].filter(([, value]) => value);
  previewDialog.dataset.watchId = id;
  previewDialog.innerHTML = `<div class="admin-preview-panel"><button type="button" class="admin-preview-close" aria-label="Close watch preview">×</button><div class="admin-preview-image">${image ? `<img src="${esc(image)}" alt="${esc(watch.name || watch.id)}">` : '<span aria-hidden="true">GGM</span>'}</div><div><p class="eyebrow">WATCH INQUIRY</p><h2>${esc(watch.name || watch.id)}</h2><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><section class="admin-catalog-details" data-catalog-details hidden></section></div></div>`;
  const previewImage = previewDialog.querySelector('.admin-preview-image');
  if (image) {
    previewImage.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const bounds = previewImage.getBoundingClientRect();
      previewImage.style.setProperty('--preview-zoom-x', `${Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100))}%`);
      previewImage.style.setProperty('--preview-zoom-y', `${Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100))}%`);
    });
  }
  previewDialog.querySelector('.admin-preview-close').onclick = () => previewDialog.close();
  previewDialog.querySelector('img')?.addEventListener('error', (event) => { event.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Image unavailable' })); });
  previewDialog.addEventListener('close', () => {
    const focusTarget = opener.isConnected ? opener : [...root.querySelectorAll('[data-preview-product]')].find((button) => button.dataset.previewProduct === id);
    focusTarget?.focus();
  }, { once: true });
  previewDialog.showModal(); previewDialog.querySelector('.admin-preview-close').focus();
  catalogPromise ||= fetch('/api/catalog.json').then((response) => response.ok ? response.json() : null).catch(() => null);
  catalogPromise.then((catalog) => {
    if (!previewDialog?.open || previewDialog.dataset.watchId !== id) return;
    const current = catalog?.watches?.find((item) => item.id === id);
    if (!current) return;
    const extras = [['Category', current.category], ['Dial color', current.dialColor], ['Case material', current.caseMaterial], ['Strap material', current.strapMaterial], ['Movement', current.movement]].filter(([, value]) => value);
    const section = previewDialog.querySelector('[data-catalog-details]');
    if (!section || !extras.length) return;
    section.hidden = false;
    section.innerHTML = `<h3>Current catalog details</h3><dl>${extras.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  });
}
root.addEventListener('click', (event) => { const opener = event.target.closest?.('[data-preview-product]'); if (opener) openProductPreview(opener.dataset.previewProduct, opener); });
root.addEventListener('click', (event) => { if (!event.target.closest?.('button, a')) toggleAdminMessageTime(event.target.closest?.('#admin-thread-body .admin-message')); });
root.addEventListener('keydown', (event) => { if (event.target.matches?.('#admin-thread-body .admin-message') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleAdminMessageTime(event.target); } });
root.addEventListener('error', (event) => { if (event.target.matches?.('.admin-product img')) event.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'G' })); }, true);
const adminPalettes = [['navy', 'Navy'], ['gold', 'Gold'], ['forest', 'Forest'], ['plum', 'Plum']];
function appearanceMarkup() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const palette = document.documentElement.dataset.adminPalette || 'navy';
  return `<details class="admin-appearance"><summary aria-label="Appearance settings" title="Appearance settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="14" cy="7" r="1"/><circle cx="17" cy="12" r="1"/><path d="M12 21c-1.5-1.4-1.6-3.1-.3-4.2 1.2-1 2.9-.7 4.1-1.1"/></svg></summary><div class="admin-appearance-panel"><strong>Appearance</strong><span class="admin-appearance-label">Mode</span><div class="admin-theme-options" role="group" aria-label="Display mode"><button type="button" data-admin-theme="light" aria-pressed="${theme === 'light'}">☀ Light</button><button type="button" data-admin-theme="dark" aria-pressed="${theme === 'dark'}">☾ Dark</button></div><span class="admin-appearance-label">Color palette</span><div class="admin-palette-options" role="group" aria-label="Color palette">${adminPalettes.map(([id, name]) => `<button type="button" data-admin-palette="${id}" aria-pressed="${palette === id}"><i class="admin-palette-dot admin-palette-${id}" aria-hidden="true"></i>${name}</button>`).join('')}</div><small>Saved on this browser</small></div></details>`;
}
function setAdminAppearance(kind, value) {
  if (kind === 'theme' && ['light', 'dark'].includes(value)) {
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem('ggm-admin-theme', value); } catch {}
  } else if (kind === 'palette' && adminPalettes.some(([id]) => id === value)) {
    document.documentElement.dataset.adminPalette = value;
    try { localStorage.setItem('ggm-admin-palette', value); } catch {}
  }
  root.querySelectorAll('[data-admin-theme]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.adminTheme === document.documentElement.dataset.theme)));
  root.querySelectorAll('[data-admin-palette]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.adminPalette === document.documentElement.dataset.adminPalette)));
}
function bindAppearance() {
  root.querySelectorAll('[data-admin-theme]').forEach((button) => button.onclick = () => setAdminAppearance('theme', button.dataset.adminTheme));
  root.querySelectorAll('[data-admin-palette]').forEach((button) => button.onclick = () => setAdminAppearance('palette', button.dataset.adminPalette));
}
function header() {
  const count = state.unread;
  return `<header class="admin-header">
    <a href="/" class="admin-brand" aria-label="Graceful Gifts Manila home"><img src="/favicon.svg" alt="" width="48" height="48"><span><strong>GRACEFUL GIFTS MANILA</strong><small>Store Admin</small></span></a>
    <nav aria-label="Admin navigation"><a href="/admin/chat" class="admin-inbox-link" aria-label="Inbox, ${count} unread" ${state.page === 'chat' ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 5h18v13H3zM3 6l9 7 9-7"/></svg><b class="admin-unread-badge" ${count ? '' : 'hidden'}>${count > 9 ? '9+' : count}</b></a>${state.profile?.role === 'owner' ? `<a href="/admin/staff" ${state.page === 'staff' ? 'aria-current="page"' : ''}>Staff</a>` : ''}</nav>
    <div class="admin-header-actions"><button type="button" class="admin-push" data-push ${state.pushAvailable ? '' : 'disabled title="Web Push public key or browser support is unavailable"'}>${state.pushAvailable ? state.pushActive ? 'Disable background alerts' : 'Enable background alerts' : 'Background alerts need setup'}</button>${appearanceMarkup()}<button type="button" class="admin-sound" data-sound aria-pressed="${sound.enabled}" aria-label="${sound.label()}" title="${sound.label()}">${soundIcon(sound.enabled)}</button><span class="admin-user">${esc(state.profile?.displayName || state.user?.email || '')} <span>· ${esc(state.profile?.role || '')}</span></span><button type="button" class="admin-logout" data-logout>Sign out</button></div>
    <span class="admin-notice${state.noticeCentered ? ' is-centered' : ''}" role="status">${esc(state.notice)}</span>
  </header>`;
}
function updateHeader() { const link = root.querySelector('.admin-inbox-link'); if (link) { link.setAttribute('aria-label', `Inbox, ${state.unread} unread`); const badge = link.querySelector('b'); badge.hidden = !state.unread; badge.textContent = state.unread > 9 ? '9+' : String(state.unread); } const button = root.querySelector('[data-sound]'); if (button) { button.innerHTML = soundIcon(sound.enabled); button.setAttribute('aria-label', sound.label()); button.title = sound.label(); button.setAttribute('aria-pressed', String(sound.enabled)); } const push = root.querySelector('[data-push]'); if (push) { push.disabled = !state.pushAvailable; if (state.pushAvailable) push.removeAttribute('title'); push.textContent = state.pushAvailable ? state.pushActive ? 'Disable background alerts' : 'Enable background alerts' : 'Background alerts need setup'; } const notice = root.querySelector('.admin-notice'); if (notice) { notice.textContent = state.notice; notice.classList.toggle('is-centered', state.noticeCentered); } }
function showNotice(message, centered = false, duration = 5000) { clearTimeout(noticeTimer); state.notice = message; state.noticeCentered = centered; updateHeader(); noticeTimer = setTimeout(() => { state.notice = ''; state.noticeCentered = false; updateHeader(); }, duration); }
function renderLogin() { root.innerHTML = `<main class="admin-login"><div class="admin-login-appearance">${appearanceMarkup()}</div><form id="admin-login-form" class="admin-card"><p class="eyebrow">GRACEFUL GIFTS MANILA</p><h1>Staff sign in</h1><p>Use your individual staff account.</p><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="admin-primary" type="submit">Sign in</button>${state.error ? `<p class="admin-error" role="alert">${esc(state.error)}</p>` : ''}</form></main>`; root.querySelector('form').onsubmit = login; bindAppearance(); }
function inboxStatus(item) { const saved = state.inboxReceipts.get(item.id); return status({ id: item.lastMessageId }, saved?.messageId === item.lastMessageId ? saved.data : null); }
function reconcileInboxReceipts(db) {
  const current = new Map(state.rows.filter((item) => /^[A-Za-z0-9]{20}$/.test(item.lastMessageId || '')).map((item) => [item.id, item.lastMessageId]));
  for (const [id, listener] of state.inboxReceiptListeners) {
    if (current.get(id) === listener.messageId) continue;
    listener.unsubscribe(); state.inboxReceiptListeners.delete(id); state.inboxReceipts.delete(id);
  }
  for (const [id, messageId] of current) {
    if (state.inboxReceiptListeners.has(id)) continue;
    const unsubscribe = onSnapshot(doc(db, 'conversations', id, 'receipts', messageId), (snapshot) => {
      if (state.inboxReceiptListeners.get(id)?.messageId !== messageId) return;
      state.inboxReceipts.set(id, { messageId, data: snapshot.exists() ? snapshot.data() : null });
      const button = [...root.querySelectorAll('[data-select-chat]')].find((node) => node.dataset.selectChat === id);
      const indicator = button?.querySelector('.admin-row-receipt');
      if (indicator) { const label = inboxStatus({ id, lastMessageId: messageId }); indicator.textContent = label; indicator.setAttribute('aria-label', `Latest message: ${label}`); }
    }, (error) => console.warn('Inbox receipt unavailable:', error?.code || error?.message));
    state.inboxReceiptListeners.set(id, { messageId, unsubscribe });
  }
}
function row(item) { const unread = unreadConversation(item); const receipt = inboxStatus(item); return `<button type="button" class="admin-inbox-row ${unread ? 'unread' : ''} ${state.selected === item.id ? 'selected' : ''}" data-select-chat="${esc(item.id)}"><span class="admin-row-top">${customerLabel(item)}<span class="admin-row-receipt" aria-label="Latest message: ${receipt}">${receipt}</span></span><span class="admin-row-summary"><span class="admin-row-preview">${esc(displayMessage(item.lastMessage || ''))}</span>${unread ? '<b class="admin-row-unread" aria-label="Unread message"></b>' : ''}</span>${state.blocked && state.selected === item.id && state.deletingId !== item.id ? '<span class="admin-row-meta"><em>Blocked</em></span>' : ''}</button>`; }
function updateMediaForm() {
  const form = root.querySelector('#admin-reply'); if (!form) return;
  const attach = form.querySelector('.chat-attach'); attach.classList.toggle('is-disabled', !state.mediaAvailable || state.replySending || state.blocked); attach.title = state.mediaAvailable ? 'Attach photo or video' : 'Photo and video sharing needs store setup';
  // Leave the picker enabled while setup is pending so the label can show guidance.
  // selectAdminAttachment rejects files whenever media is disabled.
  form.querySelector('#admin-chat-file').disabled = state.replySending || state.blocked;
  const preview = form.querySelector('.chat-attachment-preview'); preview.hidden = !state.attachment;
  preview.innerHTML = state.attachment ? `<span>${esc(state.attachment.name)} · ${(state.attachment.size / 1_000_000).toFixed(1)} MB${state.replySending ? ` · ${state.uploadProgress}%` : ''}</span><button type="button" data-remove-attachment ${state.replySending ? 'disabled' : ''} aria-label="Remove attachment">×</button>` : '';
  preview.querySelector('[data-remove-attachment]')?.addEventListener('click', () => { state.attachment = null; updateMediaForm(); });
}
function setupMediaForm() {
  const form = root.querySelector('#admin-reply'); if (!form) return;
  form.querySelector('#admin-message').required = false;
  if (!form.querySelector('#admin-chat-file')) {
    const attach = document.createElement('label'); attach.className = 'chat-attach'; attach.innerHTML = '＋<span class="visually-hidden">Attach photo or video</span><input id="admin-chat-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden>';
    form.prepend(attach);
    const preview = document.createElement('div'); preview.className = 'chat-attachment-preview'; preview.hidden = true; form.prepend(preview);
  }
  form.querySelector('#admin-chat-file').onchange = (event) => { if (event.target.files[0]) selectAdminAttachment(event.target.files[0]); event.target.value = ''; };
  form.querySelector('.chat-attach').onclick = (event) => { if (state.mediaAvailable && !state.replySending && !state.blocked) return; event.preventDefault(); showNotice(state.mediaAvailable ? 'Attachments are unavailable for this chat.' : 'Photo and video sharing needs store setup.', true); };
  const thread = root.querySelector('.admin-thread');
  thread.ondragover = (event) => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); event.dataTransfer.dropEffect = state.mediaAvailable && !state.blocked ? 'copy' : 'none'; };
  thread.ondrop = (event) => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); selectAdminAttachment(event.dataTransfer.files[0]); };
  updateMediaForm();
}
function selectAdminAttachment(file) {
  try {
    if (!state.mediaAvailable) throw new Error('Photo and video sharing needs store setup.');
    if (state.blocked || state.replySending) throw new Error('Attachments are unavailable for this chat.');
    checkFile(file); state.attachment = file; state.error = '';
  } catch (error) { state.error = displayError(error); }
  updateMediaForm();
  if (state.error) showNotice(state.error, true);
}
function renderModerationMenu(selected) {
  const controls = root.querySelector('.admin-controls');
  if (!selected || !controls) return;
  if (state.blocked) { const badge = document.createElement('span'); badge.className = 'admin-blocked-pill'; badge.textContent = 'Blocked'; controls.append(badge); }
  if (!['owner', 'admin'].includes(state.profile?.role)) return;
  const menu = document.createElement('details'); menu.className = 'admin-chat-menu';
  menu.innerHTML = `<summary aria-label="Conversation options" title="Conversation options">⋮</summary><div role="menu"><button type="button" role="menuitem" data-block-user ${state.moderationBusy ? 'disabled' : ''}>${state.blocked ? 'Unblock user' : 'Block user'}</button>${state.profile.role === 'owner' ? `<button type="button" role="menuitem" class="danger" data-delete-chat ${state.moderationBusy ? 'disabled' : ''}>Delete chat</button>` : ''}</div>`;
  controls.append(menu);
  menu.querySelector('[data-block-user]').onclick = () => { menu.open = false; toggleBlock(); };
  menu.querySelector('[data-delete-chat]')?.addEventListener('click', () => { menu.open = false; deleteConversation(); });
  root.onpointerdown = (event) => { if (!event.target.closest('.admin-chat-menu')) menu.open = false; };
}
function renderChat() {
  const matches = state.rows.filter(matchesInbox);
  const selected = state.threadReady && state.rows.find((item) => item.id === state.selected);
  const oldReply = root.dataset.selected === state.selected ? root.querySelector('#admin-reply') : null;
  oldReply?.remove();
  root.innerHTML = header() + `<main class="admin-layout"><aside class="admin-inbox"><div class="admin-inbox-top"><h1>Conversations</h1><p>${state.unread} unread · ${state.rows.length} loaded</p><input id="admin-search" type="search" placeholder="Search loaded conversations" value="${esc(state.search)}"><select id="admin-filter" aria-label="Filter status">${['all','new','open','pending','resolved'].map((status) => `<option value="${status}" ${state.filter === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select></div><div class="admin-inbox-list">${matches.length ? matches.map(row).join('') : '<p class="admin-empty">No conversations found.</p>'}${state.more ? '<button type="button" class="admin-more" data-more>Load more</button>' : ''}</div></aside><section class="admin-thread">${selected ? `<div class="admin-thread-head"><div><h2>${customerLabel(selected)}</h2><small>${esc(selected.customerContact || 'Anonymous website visitor')} · ${stamp(selected.createdAt)}</small></div><div class="admin-controls"><label>Status<select id="admin-status">${['new','open','pending','resolved'].map((status) => `<option value="${status}" ${selected.status === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select></label>${state.profile?.role !== 'staff' ? `<label>Assigned<select id="admin-assignee"><option value="">Unassigned</option>${state.staff.filter((person) => person.active).map((person) => `<option value="${esc(person.id)}" ${selected.assignedStaffUid === person.id ? 'selected' : ''}>${esc(person.displayName)}</option>`).join('')}</select></label>` : `<span>Assigned: ${esc(profileName(selected.assignedStaffUid))}</span>`}</div></div><div class="admin-thread-body" id="admin-thread-body">${state.first ? '<button type="button" data-older>Load earlier messages</button>' : ''}${[...state.older, ...state.messages].map(adminMessage).join('')}</div>${selected.productReferences?.length ? `<aside class="admin-refs"><strong>Watches discussed</strong>${selected.productReferences.map(product).join('')}</aside>` : ''}<form id="admin-reply"><label class="visually-hidden" for="admin-message">Reply</label><textarea id="admin-message" maxlength="2000" rows="2" placeholder="Write a reply…" required>${esc(state.replyDraft)}</textarea><button class="admin-primary" type="submit">Send reply</button></form>` : '<div class="admin-empty-thread">Select a conversation to read and reply.</div>'}</section></main>${state.error ? `<div class="admin-toast" role="alert">${esc(state.error)}<button type="button" data-clear-error>×</button></div>` : ''}`;
  root.querySelector('#admin-filter')?.remove();
  root.querySelector('#admin-status')?.closest('label')?.remove();
  if (selected && state.deletingId === selected.id) root.querySelector('.admin-thread').innerHTML = '<div class="admin-delete-progress" role="status">Deleting chat…</div>';
  renderModerationMenu(selected);
  root.dataset.selected = state.selected || '';
  if (oldReply && selected) root.querySelector('#admin-reply')?.replaceWith(oldReply);
  setupMediaForm();
  root.querySelector('.admin-layout').classList.toggle('thread-open', !!state.mobileThread);
  decorateThread();
  root.querySelector('#admin-search').oninput = (event) => { state.search = event.target.value.toLowerCase(); renderInboxOnly(); };
  bindInboxRows();
  root.querySelector('[data-more]')?.addEventListener('click', loadMore);
  root.querySelector('[data-older]')?.addEventListener('click', loadOlder);
  root.querySelector('#admin-assignee')?.addEventListener('change', (event) => changeConversation({ assignedStaffUid: event.target.value || null }));
  const replyForm = root.querySelector('#admin-reply'); if (replyForm) {
    replyForm.onsubmit = reply;
    const sendButton = replyForm.querySelector('.admin-primary');
    sendButton.classList.add('admin-send');
    sendButton.setAttribute('aria-label', 'Send reply'); sendButton.title = 'Send reply';
    sendButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 3-8.5 18-2.2-7.3L3 11.5 21 3Z"/><path d="M10.3 13.7 21 3"/></svg>';
    sendButton.disabled = state.replySending || state.blocked;
  }
  const replyBox = root.querySelector('#admin-message'); if (replyBox) { replyBox.disabled = state.blocked; replyBox.placeholder = state.blocked ? 'This customer is blocked' : 'Write a reply…'; replyBox.oninput = (event) => { state.replyDraft = event.target.value; }; replyBox.onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); replyForm.requestSubmit(); } }; }
  root.querySelector('[data-clear-error]')?.addEventListener('click', () => { state.error = ''; render(); });
  bindHeader();
  const body = root.querySelector('#admin-thread-body'); if (body) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}
function matchesInbox(item) { return !state.search || [item.customerName, guestIdentity(item.id).reference, item.customerContact, item.lastMessage, ...(item.productReferences || []).map((p) => `${p.id} ${p.name}`)].join(' ').toLowerCase().includes(state.search); }
function bindInboxRows() { root.querySelectorAll('[data-select-chat]').forEach((button) => button.onclick = () => selectConversation(button.dataset.selectChat)); root.querySelector('[data-more]')?.addEventListener('click', loadMore); }
function renderInboxOnly() {
  const list = root.querySelector('.admin-inbox-list'); if (!list) { updateHeader(); return; }
  const matches = state.rows.filter(matchesInbox);
  list.innerHTML = `${matches.length ? matches.map(row).join('') : '<p class="admin-empty">No conversations found.</p>'}${state.more ? '<button type="button" class="admin-more" data-more>Load more</button>' : ''}`;
  const summary = root.querySelector('.admin-inbox-top p'); if (summary) summary.textContent = `${state.unread} unread · ${state.rows.length} loaded`;
  updateHeader(); bindInboxRows();
}
function decorateThread() {
  const body = root.querySelector('#admin-thread-body'); if (!body || !state.user) return;
  const records = [...state.older, ...state.messages];
  const lastSeen = [...records].reverse().find((item) => item.senderUid === state.user.uid && state.receipts.get(item.id)?.seenAt)?.id;
  body.querySelectorAll('.admin-message').forEach((bubble, index) => {
    const item = records[index]; if (!item) return;
    bubble.dataset.messageId = item.id;
    if (item.media && !bubble.querySelector('.chat-media')) bubble.querySelector('p')?.insertAdjacentHTML('afterend', mediaMarkup(item.media, state.selected, item.id));
    if (item.senderUid === state.user.uid) {
      const label = status(item, state.receipts.get(item.id));
      if (label !== 'Seen') { const receipt = document.createElement('span'); receipt.className = 'chat-receipt'; receipt.textContent = label; receipt.setAttribute('aria-label', `Message status: ${label}`); bubble.append(receipt); }
      if (item.id === lastSeen) { const avatar = document.createElement('span'); avatar.className = 'chat-seen-avatar'; avatar.setAttribute('aria-label', 'Seen by customer'); avatar.innerHTML = '<span aria-hidden="true">C</span>Seen'; bubble.append(avatar); }
    }
    bubble.querySelectorAll('.chat-watch-photo img').forEach((img) => img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'G' })); });
  });
  const pending = state.pendingReply;
  if (pending?.conversationId === state.selected && !records.some((item) => item.id === pending.id)) {
    const bubble = document.createElement('div'); bubble.className = 'admin-message staff'; bubble.dataset.messageId = pending.id;
    const message = document.createElement('p'); message.textContent = displayMessage(pending.message); bubble.append(message);
    const receipt = document.createElement('span'); receipt.className = 'chat-receipt'; receipt.textContent = status(pending); bubble.append(receipt);
    if (pending.failed) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.onclick = retryReply; receipt.append(' ', retry); }
    body.append(bubble);
  }
  body.onscroll = scheduleStaffSeen;
  if (body.querySelector('[data-media-path]')) firebase().then(({ app, config }) => hydrateMedia(body, app, config.emulator)).catch(() => {});
  const head = root.querySelector('.admin-thread-head');
  if (head && !head.querySelector('.admin-back')) { const back = document.createElement('button'); back.type = 'button'; back.className = 'admin-back'; back.textContent = '← Inbox'; back.onclick = () => { state.mobileThread = false; root.querySelector('.admin-layout')?.classList.remove('thread-open'); }; head.prepend(back); }
}
function renderThreadMessages() {
  const body = root.querySelector('#admin-thread-body'); if (!body) { renderChat(); return; }
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 72, oldHeight = body.scrollHeight, oldTop = body.scrollTop;
  body.innerHTML = `${state.first ? '<button type="button" data-older>Load earlier messages</button>' : ''}${[...state.older, ...state.messages].map(adminMessage).join('')}`;
  body.querySelector('[data-older]')?.addEventListener('click', loadOlder);
  decorateThread();
  requestAnimationFrame(() => { body.scrollTop = nearBottom ? body.scrollHeight : oldTop + body.scrollHeight - oldHeight; scheduleStaffSeen(); });
}
function renderStaff() {
  const oldStaffForm = root.querySelector('#staff-form');
  oldStaffForm?.remove();
  const activeCount = state.staff.filter((person) => person.active).length;
  const adminCount = state.staff.filter((person) => person.active && person.role === 'admin').length;
  root.innerHTML = header() + `<main class="admin-staff-page">
    <div class="admin-page-title">
      <a class="admin-staff-back" href="/admin/chat" aria-label="Back to inbox">← <span>Back to inbox</span></a>
      <div class="admin-staff-hero"><div><p class="eyebrow">OWNER ACCESS</p><h1>Staff management</h1><p>Manage who can help customers and keep your support team organized.</p></div><div class="admin-staff-stats"><span><strong>${activeCount}</strong> active accounts</span><span><strong>${adminCount}</strong> admins</span></div></div>
    </div>
    <div class="admin-staff-grid">
      <section class="admin-card admin-team-card"><div class="admin-section-heading"><div><p class="eyebrow">YOUR TEAM</p><h2>Team members</h2></div><span class="admin-team-count">${state.staff.length} total</span></div><div class="admin-staff-list">${state.staff.map((person) => `<div class="admin-staff-row"><span class="admin-staff-person"><span class="admin-staff-avatar" aria-hidden="true">${esc((person.displayName || person.email || '?').trim().slice(0, 1).toUpperCase())}</span><span><strong>${esc(person.displayName)}</strong><small>${esc(person.email)}</small><small class="admin-staff-uid" title="Firebase Auth UID">UID ${esc(person.id)}</small></span></span><span class="admin-role-pill">${esc(person.role)}</span><span class="admin-state-pill${person.active ? ' is-active' : ''}">${person.active ? 'Active' : 'Disabled'}</span><span class="admin-staff-actions">${person.role === 'owner' ? '<span class="admin-owner-note">Owner account</span>' : `<select data-role="${esc(person.id)}" aria-label="Role for ${esc(person.displayName)}"><option value="staff" ${person.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Admin</option></select><button type="button" data-toggle-staff="${esc(person.id)}">${person.active ? 'Disable' : 'Enable'}</button>`}</span></div>`).join('')}</div></section>
      <div class="admin-staff-side"><section class="admin-card admin-add-card"><div class="admin-section-heading"><div><p class="eyebrow">ACCESS</p><h2>Add staff</h2></div></div><p class="admin-card-intro">Create their email and password in Firebase Console first, then enter the account UID here.</p><form id="staff-form" class="admin-staff-form"><label>Firebase Auth UID<input name="uid" maxlength="128" required></label><label>Name<input name="name" maxlength="80" required></label><label>Email<input name="email" type="email" maxlength="254" required></label><label>Role<select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label><button class="admin-primary" type="submit">Grant access</button></form></section><div class="admin-settings-slot"></div></div>
    </div>
    <section class="admin-card admin-activity-card"><div class="admin-section-heading"><div><p class="eyebrow">OVERVIEW</p><h2>Recent activity</h2></div></div><div class="admin-activity">${state.activity.length ? state.activity.map((item) => `<p><strong>${esc(profileName(item.actorUid))}</strong> changed ${esc(item.action)} on conversation ${esc(item.conversationId)} · ${stamp(item.createdAt)}</p>`).join('') : '<p>No assignment or status changes yet.</p>'}</div></section>${state.error ? `<p class="admin-error" role="alert">${esc(state.error)}</p>` : ''}
  </main>`;
  if (oldStaffForm) root.querySelector('#staff-form')?.replaceWith(oldStaffForm);
  const settings = document.createElement('section'); settings.className = 'admin-card admin-settings-card';
  settings.innerHTML = `<h2>Chat settings</h2><p>Sound is enabled separately on each device using the button in the header.</p><label>Store avatar image path (optional)<input id="store-avatar" value="${esc(state.settings.storeAvatarUrl || '')}" placeholder="/images/store-avatar.webp"></label><button type="button" id="save-avatar" class="admin-primary">Save avatar</button>`;
  root.querySelector('.admin-settings-slot').replaceWith(settings);
  settings.querySelector('#save-avatar').onclick = async () => { const path = settings.querySelector('#store-avatar').value.trim(); if (path && !/^\/images\/[A-Za-z0-9._-]+$/.test(path)) { state.error = 'Use an image path under /images/.'; render(); return; } try { const { db } = await firebase(); await setDoc(doc(db, 'settings', 'chat'), { storeAvatarUrl: path, staffSoundEnabled: !!state.settings.staffSoundEnabled, updatedAt: serverTimestamp() }, { merge: true }); } catch (error) { state.error = displayError(error); render(); } };
  root.querySelector('#staff-form').onsubmit = addStaff;
  root.querySelector('#staff-form button').onclick = addStaff;
  root.querySelector('#staff-form button').disabled = state.staffCreating;
  root.querySelectorAll('[data-role]').forEach((field) => field.onchange = () => editStaff(field.dataset.role, { role: field.value }));
  root.querySelectorAll('[data-toggle-staff]').forEach((button) => button.onclick = () => { const person = state.staff.find((item) => item.id === button.dataset.toggleStaff); if (person) editStaff(person.id, { active: !person.active }); });
  bindHeader();
}
function bindHeader() {
  bindAppearance();
  root.querySelector('[data-logout]')?.addEventListener('click', async () => {
    const services = await firebase();
    try { await revokePush(services); } catch (error) { state.error = `Could not remove this device's push token: ${displayError(error)}`; render(); return; }
    await signOut(services.auth); location.assign('/admin/chat');
  });
  root.querySelector('[data-sound]')?.addEventListener('click', () => sound.toggle());
  root.querySelector('[data-push]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const services = await firebase();
      if (state.pushActive) { await revokePush(services); state.pushActive = false; showNotice('Background alerts disabled on this browser.'); }
      else { await enablePush(services); state.pushActive = true; showNotice('Browser registered. Automatic background delivery awaits trusted sender setup.'); }
      updateHeader();
    } catch (error) { state.error = displayError(error); render(); }
    finally { const button = root.querySelector('[data-push]'); if (button) button.disabled = false; }
  });
}
function render() { if (state.loading) { root.innerHTML = '<main class="admin-login"><p>Checking access…</p></main>'; return; } if (!state.user || !state.profile?.active) { renderLogin(); return; } if (state.page === 'staff' && state.profile.role === 'owner') renderStaff(); else renderChat(); }
async function login(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true; try { const { auth } = await firebase(); await signInWithEmailAndPassword(auth, form.elements.namedItem('email').value.trim(), form.elements.namedItem('password').value); } catch (error) { state.error = displayError(error); button.disabled = false; renderLogin(); } }
function subscribeStaff(db) { state.unsubStaff?.(); state.unsubActivity?.(); state.unsubStaff = onSnapshot(query(collection(db, 'staff'), limit(100)), (snapshot) => { state.staff = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }, (error) => { state.error = displayError(error); render(); }); if (state.profile.role === 'owner') state.unsubActivity = onSnapshot(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(50)), (snapshot) => { state.activity = snapshot.docs.map((item) => item.data()); render(); }, (error) => { state.error = displayError(error); render(); }); }
function subscribeSettings(db) { state.unsubSettings?.(); state.unsubSettings = onSnapshot(doc(db, 'settings', 'chat'), (snapshot) => { state.settings = snapshot.exists() ? snapshot.data() : { staffSoundEnabled: false, storeAvatarUrl: '' }; if (state.page === 'staff') render(); }, (error) => { state.error = displayError(error); render(); }); }
function acknowledgeInbox(db, items) {
  if (document.visibilityState !== 'visible' || state.page !== 'chat') return;
  for (const item of items) if (item.lastSenderRole === 'customer' && item.lastMessageId) {
    acknowledge(db, item.id, { id: item.lastMessageId, senderUid: item.lastSenderUid, senderRole: 'customer' }, state.user.uid).catch(() => {});
  }
}
function scheduleStaffSeen() {
  if (!state.threadSynced || !state.selected || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const body = root.querySelector('#admin-thread-body');
  for (const bubble of body?.querySelectorAll('.admin-message.customer') || []) {
    if (!bubbleVisible(bubble, body)) continue;
    const item = [...state.older, ...state.messages].find((message) => message.id === bubble.dataset.messageId);
    if (!item || state.receipts.get(item.id)?.seenAt) continue;
    const selected = state.selected;
    firebase().then(({ db }) => acknowledge(db, selected, item, state.user.uid, true).then(() => { if (selected === state.selected && state.rows.find((row) => row.id === selected)?.lastMessageId === item.id) advanceStaffRead(db, selected, item.id); })).catch(() => {});
  }
}
async function advanceStaffRead(db, id, messageId) {
  const current = state.rows.find((row) => row.id === id);
  if (state.readInFlight || current?.lastMessageId !== messageId || !unreadConversation(current)) return;
  state.readInFlight = true;
  try { await updateDoc(doc(db, 'conversations', id), { staffReadAt: serverTimestamp() }); }
  catch (error) { console.warn('Staff read marker failed:', error?.code || error?.message); }
  finally { state.readInFlight = false; }
}
function acknowledgeThread(db) { if (!state.threadSynced || document.visibilityState !== 'visible' || !state.selected) return; for (const item of state.messages) if (item.senderRole === 'customer' && !state.receipts.get(item.id)?.deliveredAt && !item.metadata?.hasPendingWrites) acknowledge(db, state.selected, item, state.user.uid).catch(() => {}); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') return; firebase().then(({ db }) => { acknowledgeInbox(db, state.rows); acknowledgeThread(db); scheduleStaffSeen(); }).catch(() => {}); });
window.addEventListener('focus', scheduleStaffSeen);
function subscribeInbox(db) {
  state.unsubInbox?.();
  for (const listener of state.inboxReceiptListeners.values()) listener.unsubscribe();
  state.inboxReceiptListeners.clear(); state.inboxReceipts.clear();
  state.inboxInitialized = false; state.knownInbox = new Map();
  const base = collection(db, 'conversations');
  const inbox = state.profile.role === 'staff' ? query(base, where('assignedStaffUid', '==', state.user.uid), orderBy('lastMessageAt', 'desc'), limit(50)) : query(base, orderBy('lastMessageAt', 'desc'), limit(50));
  state.unsubInbox = onSnapshot(inbox, { includeMetadataChanges: true }, (snapshot) => {
    const selectedRow = state.rows.find((item) => item.id === state.selected);
    const previousRows = new Map(state.rows.map((item) => [item.id, item]));
    state.rows = snapshot.docs.map((item) => keepNewerReadMarker({ id: item.id, ...item.data({ serverTimestamps: 'estimate' }) }, previousRows.get(item.id)));
    if (selectedRow && !state.rows.some((item) => item.id === selectedRow.id)) state.rows.push(selectedRow);
    state.cursor = snapshot.docs.at(-1) || null; state.more = snapshot.docs.length === 50;
    if (!snapshot.metadata.fromCache) {
      const fresh = state.rows.filter((item) => item.lastSenderRole === 'customer' && state.knownInbox.get(item.id) !== item.lastMessageId);
      if (state.inboxInitialized && fresh.length && document.visibilityState === 'visible') { showNotice(fresh.length === 1 ? 'New customer message' : `${fresh.length} new customer messages`); sound.notify(); }
      state.knownInbox = new Map(state.rows.map((item) => [item.id, item.lastMessageId]));
      state.inboxInitialized = true; acknowledgeInbox(db, state.rows);
      if (!deepLinkHandled && state.page === 'chat') {
        deepLinkHandled = true;
        const id = new URLSearchParams(location.search).get('conversation');
        if (id && /^[A-Za-z0-9_-]{20,128}$/.test(id)) {
          getDoc(doc(db, 'conversations', id)).then((record) => {
            if (!record.exists() || !state.profile?.active) return;
            if (!state.rows.some((item) => item.id === id)) state.rows.push({ id, ...record.data() });
            reconcileInboxReceipts(db);
            selectConversation(id);
          }).catch(() => showNotice('This conversation is unavailable to your account.'));
        }
      }
    }
    state.unread = state.rows.filter(unreadConversation).length;
    reconcileInboxReceipts(db);
    if (state.selected && !state.rows.some((item) => item.id === state.selected)) { clearSelected(); renderChat(); }
    else renderInboxOnly();
  }, (error) => { state.error = displayError(error); render(); });
}
async function loadMore() {
  if (!state.cursor) return;
  try { const { db } = await firebase(); const base = collection(db, 'conversations'); const q = state.profile.role === 'staff' ? query(base, where('assignedStaffUid', '==', state.user.uid), orderBy('lastMessageAt', 'desc'), startAfter(state.cursor), limit(50)) : query(base, orderBy('lastMessageAt', 'desc'), startAfter(state.cursor), limit(50)); const snapshot = await getDocs(q); state.rows = [...state.rows, ...snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))]; state.cursor = snapshot.docs.at(-1) || null; state.more = snapshot.docs.length === 50; reconcileInboxReceipts(db); render(); } catch (error) { state.error = displayError(error); render(); }
}
function clearSelected() {
  for (const key of ['unsubSelected', 'unsubMessages', 'unsubReceipts', 'unsubBlock']) { state[key]?.(); state[key] = null; }
  state.selected = null; state.mobileThread = false; state.threadReady = false; state.threadSynced = false; state.messages = []; state.older = []; state.receipts = new Map(); state.first = null; state.replyDraft = ''; state.attachment = null; state.blocked = false;
}
async function selectConversation(id) {
  const { db } = await firebase(); clearSelected(); state.selected = id; state.mobileThread = true;
  const ref = doc(db, 'conversations', id);
  state.unsubSelected = onSnapshot(ref, (snapshot) => { if (state.selected !== id) return; if (!snapshot.exists()) { clearSelected(); render(); } else { state.rows = state.rows.map((item) => item.id === id ? keepNewerReadMarker({ id, ...snapshot.data({ serverTimestamps: 'estimate' }) }, item) : item); reconcileInboxReceipts(db); renderInboxOnly(); } }, (error) => { if (state.selected !== id) return; state.error = displayError(error); render(); });
  state.unsubBlock = onSnapshot(doc(db, 'blockedCustomers', id), (snapshot) => { if (state.selected !== id) return; if (state.blocked !== snapshot.exists()) { state.blocked = snapshot.exists(); renderChat(); } }, (error) => { if (state.selected !== id) return; state.error = displayError(error); render(); });
  state.unsubReceipts = subscribeReceipts(db, id, (receipts) => { state.receipts = new Map([...state.receipts, ...receipts]); renderThreadMessages(); const latest = state.rows.find((row) => row.id === id); if (latest?.lastSenderRole === 'customer' && receipts.get(latest.lastMessageId)?.seenAt) advanceStaffRead(db, id, latest.lastMessageId); }, (error) => { state.error = displayError(error); render(); });
  state.unsubMessages = onSnapshot(query(collection(ref, 'messages'), orderBy('createdAt', 'desc'), limit(40)), { includeMetadataChanges: true }, (snapshot) => { state.threadSynced = !snapshot.metadata.fromCache; state.messages = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), metadata: item.metadata })).reverse(); if (state.pendingReply && state.messages.some((item) => item.id === state.pendingReply.id)) state.pendingReply = null; state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; if (!state.threadReady) { state.threadReady = true; renderChat(); } else renderThreadMessages(); acknowledgeThread(db); }, (error) => { state.error = displayError(error); render(); });
  render();
}
async function loadOlder() { if (!state.first || !state.selected) return; try { const { db } = await firebase(); const selected = state.selected; const snapshot = await getDocs(query(collection(db, 'conversations', selected, 'messages'), orderBy('createdAt', 'desc'), startAfter(state.first), limit(40))); if (selected !== state.selected) return; const page = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); state.older = [...page.reverse(), ...state.older]; state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; renderThreadMessages(); const receipts = await olderReceipts(db, selected, page); if (selected !== state.selected) return; state.receipts = new Map([...state.receipts, ...receipts]); renderThreadMessages(); } catch (error) { state.error = displayError(error); render(); } }
async function retryReply() {
  const pending = state.pendingReply; if (!pending || state.replySending || state.blocked) return;
  state.replySending = true; pending.pending = true; pending.failed = false; state.error = ''; renderThreadMessages();
  const button = root.querySelector('#admin-reply .admin-primary'); if (button) button.disabled = true;
  try { const { db, app, config } = await firebase(); if (pending.id.startsWith('local-')) pending.id = newMessageId(db, pending.conversationId); if (pending.file && !pending.media) pending.media = await uploadMedia(app, config.emulator, pending.conversationId, pending.id, state.user.uid, pending.file, (value) => { state.uploadProgress = value; updateMediaForm(); }); await sendMessage(db, pending.conversationId, state.user.uid, state.profile.role, pending.message, [], {}, pending.id, pending.media); pending.pending = false; if (state.selected === pending.conversationId && state.attachment === pending.file) state.attachment = null; }
  catch (error) { pending.pending = false; pending.failed = true; state.error = displayError(error); }
  finally { state.replySending = false; if (button) button.disabled = false; updateMediaForm(); renderThreadMessages(); }
}
function reply(event) { event.preventDefault(); const text = state.replyDraft.trim(); if ((!text && !state.attachment) || !state.selected || state.replySending || state.blocked) return; if (state.pendingReply?.failed) { state.error = 'Retry the failed reply first.'; render(); return; } state.pendingReply = { id: `local-${Date.now()}`, conversationId: state.selected, senderUid: state.user.uid, senderRole: state.profile.role, message: text || (state.attachment?.type.startsWith('image/') ? 'Photo' : 'Video'), text, file: state.attachment, pending: true }; state.replyDraft = ''; const input = root.querySelector('#admin-message'); if (input) input.value = ''; retryReply(); }
async function toggleBlock() {
  if (!state.selected || !['owner', 'admin'].includes(state.profile?.role) || state.moderationBusy) return;
  const id = state.selected, block = !state.blocked;
  if (block && !window.confirm('Block this visitor from reading or sending messages in this browser session?')) return;
  state.moderationBusy = true; state.error = ''; renderChat();
  try {
    const { db } = await firebase(); const target = doc(db, 'blockedCustomers', id); const current = await getDoc(target);
    if (current.exists() === block) throw new Error('The block state changed. Please reopen this chat.');
    const audit = doc(collection(db, 'auditLogs')); const batch = writeBatch(db);
    if (block) batch.set(target, { blockedAt: serverTimestamp(), blockedBy: state.user.uid }); else batch.delete(target);
    batch.set(audit, { action: block ? 'block' : 'unblock', conversationId: id, actorUid: state.user.uid, createdAt: serverTimestamp() });
    await batch.commit(); showNotice(block ? 'Visitor blocked.' : 'Visitor unblocked.');
  } catch (error) { state.error = displayError(error); }
  finally { state.moderationBusy = false; render(); }
}
async function deleteConversation() {
  if (!state.selected || state.profile?.role !== 'owner' || state.moderationBusy || state.replySending) return;
  const id = state.selected;
  if (!window.confirm('Permanently delete this chat and all its messages? This cannot be undone. A blocked visitor will remain blocked.')) return;
  state.moderationBusy = true; state.deletingId = id; state.error = ''; renderChat();
  try {
    const { db, app, config } = await firebase();
    const blockRef = doc(db, 'blockedCustomers', id);
    const temporaryBlock = !(await getDoc(blockRef)).exists();
    if (temporaryBlock) await setDoc(blockRef, { blockedAt: serverTimestamp(), blockedBy: state.user.uid });
    for (const name of ['messages', 'receipts']) {
      let page;
      do {
        page = await getDocs(query(collection(db, 'conversations', id, name), limit(100)));
        if (!page.empty) {
          if (name === 'messages') for (const item of page.docs) if (item.data().media) await deleteChatMedia(app, config.emulator, id, item.id, item.data().media);
          const batch = writeBatch(db); page.docs.forEach((item) => batch.delete(item.ref)); await batch.commit();
        }
      } while (page.size === 100);
    }
    const audit = doc(collection(db, 'auditLogs')); const batch = writeBatch(db);
    batch.delete(doc(db, 'conversations', id));
    if (temporaryBlock) batch.delete(blockRef);
    batch.set(audit, { action: 'delete', conversationId: id, actorUid: state.user.uid, createdAt: serverTimestamp() });
    await batch.commit();
    if (state.selected === id) clearSelected();
    state.rows = state.rows.filter((item) => item.id !== id); showNotice('Chat deleted.', true, 3500);
  } catch (error) { state.error = `Delete stopped: ${displayError(error)}. The visitor remains blocked until you retry or unblock them.`; }
  finally { state.moderationBusy = false; state.deletingId = null; render(); }
}
async function changeConversation(change) { if (!state.selected) return; try { const { db } = await firebase(); const ref = doc(db, 'conversations', state.selected); const audit = doc(collection(db, 'auditLogs')); const action = 'status' in change ? 'status' : 'assignment'; const field = action === 'status' ? 'status' : 'assignedStaffUid'; const expected = state.rows.find((item) => item.id === state.selected)?.[field]; await runTransaction(db, async (tx) => { const snapshot = await tx.get(ref); if (!snapshot.exists()) throw new Error('Conversation no longer exists.'); if (snapshot.data()[field] !== expected) throw new Error('This conversation changed. Please review it again.'); const now = serverTimestamp(); tx.update(ref, { ...change, updatedAt: now, lastAuditId: audit.id }); tx.set(audit, { action, conversationId: state.selected, actorUid: state.user.uid, oldValue: snapshot.data()[field], newValue: change[field], createdAt: now }); }); } catch (error) { state.error = displayError(error); render(); } }
async function addStaff(event) { event.preventDefault(); if (state.staffCreating) return; const form = event.currentTarget.closest('form'); if (!form.reportValidity()) return; const field = (name) => form.elements.namedItem(name).value; const uid = field('uid').trim(); if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) { state.error = 'Enter a valid Firebase Auth UID.'; render(); return; } const profile = { displayName: field('name').trim(), email: field('email').trim().toLowerCase(), role: field('role'), active: true, createdAt: serverTimestamp(), createdBy: state.user.uid }; state.staffCreating = true; const button = form.querySelector('button'); button.disabled = true; try { const { db } = await firebase(); const ref = doc(db, 'staff', uid); await runTransaction(db, async (tx) => { if ((await tx.get(ref)).exists()) throw new Error('This UID already has a staff profile.'); tx.set(ref, profile); }); form.reset(); } catch (error) { state.error = displayError(error); } finally { state.staffCreating = false; render(); } }
async function editStaff(uid, change) { try { const { db } = await firebase(); await updateDoc(doc(db, 'staff', uid), change); } catch (error) { state.error = displayError(error); render(); } }
async function start() {
  state.page = location.pathname.endsWith('/staff') ? 'staff' : 'chat';
  try {
    const services = await firebase(); const { auth, db } = services;
    onAuthStateChanged(auth, (user) => {
      cleanup(); deepLinkHandled = false;
      state.user = user && !user.isAnonymous ? user : null;
      state.profile = null; state.rows = []; state.staff = []; state.selected = null;
      state.pushActive = false; state.pushAvailable = false; state.loading = !!state.user; state.error = ''; render();
      if (!state.user) return;
      state.unsubProfile = onSnapshot(doc(db, 'staff', state.user.uid), (snapshot) => {
        const profile = snapshot.exists() ? snapshot.data() : null;
        if (!profile?.active) { cleanup(); revokePush(services).catch(() => {}); state.profile = null; state.loading = false; state.error = 'This account has no active staff access.'; render(); return; }
        const changed = state.profile?.role !== profile.role;
        state.profile = profile; state.loading = false;
        if (state.page === 'staff' && profile.role !== 'owner') state.page = 'chat';
        if (changed) {
          subscribeStaff(db); subscribeSettings(db); subscribeInbox(db);
          pushAvailable().then((available) => { if (state.user?.uid === user.uid) { state.pushAvailable = available; updateHeader(); } });
          if (pushEnabled(state.user.uid)) refreshPush(services).then((active) => { state.pushActive = active; updateHeader(); });
        }
        render();
      }, (error) => { state.loading = false; state.error = displayError(error); render(); });
    });
  } catch (error) { state.loading = false; state.error = displayError(error); render(); }
}
start();
function sizeAdmin() { if (!window.visualViewport) return; document.documentElement.style.setProperty('--ggm-viewport-height', `${window.visualViewport.height}px`); }
window.visualViewport?.addEventListener('resize', sizeAdmin);
sizeAdmin();
mediaEnabled().then((enabled) => { state.mediaAvailable = enabled; updateMediaForm(); });
