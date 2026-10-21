import { firebase, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, collection, query, where, orderBy, limit, startAfter, getDoc, getDocs, onSnapshot, runTransaction, updateDoc, setDoc, serverTimestamp, sendMessage, newMessageId, displayError } from './firebase.js';
import { acknowledge, subscribeReceipts, olderReceipts, status, bubbleVisible } from './receipts.js';
import { createNotifier } from './notify.js';
import { guestIdentity } from './guest.js';
import { enablePush, refreshPush, revokePush, pushEnabled, pushAvailable } from './push.js';

const root = document.getElementById('admin-app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stamp = (value) => value?.toDate ? value.toDate().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now';
const state = { user: null, profile: null, staff: [], activity: [], settings: { staffSoundEnabled: false, storeAvatarUrl: '' }, rows: [], selected: null, threadReady: false, threadSynced: false, messages: [], older: [], receipts: new Map(), first: null, page: 'chat', filter: 'all', search: '', cursor: null, more: false, error: '', notice: '', loading: true, unread: 0, inboxInitialized: false, knownInbox: new Map(), pushActive: false, pushAvailable: false, replyDraft: '', replySending: false, pendingReply: null, staffCreating: false, readInFlight: false, unsubInbox: null, unsubSelected: null, unsubMessages: null, unsubReceipts: null, unsubProfile: null, unsubStaff: null, unsubActivity: null, unsubSettings: null };
const sound = createNotifier('staff', () => updateHeader());
let noticeTimer, deepLinkHandled = false;
function cleanup() { if (previewDialog?.open) previewDialog.close(); for (const key of ['unsubInbox', 'unsubSelected', 'unsubMessages', 'unsubReceipts', 'unsubProfile', 'unsubStaff', 'unsubActivity', 'unsubSettings']) { state[key]?.(); state[key] = null; } }
function profileName(uid) { return state.staff.find((person) => person.id === uid)?.displayName || (uid ? 'Staff member' : 'Unassigned'); }
function product(watch) { if (!/^[A-Z0-9-]{2,20}$/.test(watch.id || '')) return ''; const image = /^\/images\/[A-Za-z0-9._-]+$/.test(watch.image || '') ? watch.image : ''; const detail = [watch.id, watch.brand, watch.price == null ? 'Price on request' : `₱${Number(watch.price).toLocaleString('en-PH')}`, watch.size || ''].filter(Boolean).join(' · '); return `<button type="button" class="admin-product" data-preview-product="${esc(watch.id)}" aria-label="Preview ${esc(watch.name || watch.id)}"><span class="chat-watch-photo">${image ? `<img src="${esc(image)}" alt="${esc(watch.name || watch.id)}" loading="lazy">` : '<span aria-hidden="true">G</span>'}</span><span><strong>${esc(watch.name || watch.id)}</strong><small>${esc(detail)}</small></span></button>`; }
function avatar(identity) { return `<span class="guest-avatar guest-shape-${identity.shape}" style="--guest-color:${identity.color}" aria-hidden="true">${identity.mark}</span>`; }
function customerLabel(item) { const identity = guestIdentity(item.id, item.customerName); return `<span class="guest-identity">${avatar(identity)}<span class="guest-names"><strong>${esc(identity.label)}</strong>${identity.label !== identity.reference ? `<small>${esc(identity.reference)}</small>` : ''}</span></span>`; }
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
  const facts = [['Brand', watch.brand], ['Watch ID', watch.id], ['Price', watch.price == null ? 'Price on request' : `₱${Number(watch.price).toLocaleString('en-PH')}`], ['Size', watch.size], ['Stock', Number.isInteger(watch.stock) ? String(watch.stock) : '']].filter(([, value]) => value);
  previewDialog.dataset.watchId = id;
  previewDialog.innerHTML = `<div class="admin-preview-panel"><button type="button" class="admin-preview-close" aria-label="Close watch preview">×</button><div class="admin-preview-image">${image ? `<img src="${esc(image)}" alt="${esc(watch.name || watch.id)}">` : '<span aria-hidden="true">GGM</span>'}</div><div><p class="eyebrow">WATCH INQUIRY</p><h2>${esc(watch.name || watch.id)}</h2><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><section class="admin-catalog-details" data-catalog-details hidden></section></div></div>`;
  previewDialog.querySelector('.admin-preview-close').onclick = () => previewDialog.close();
  previewDialog.querySelector('img')?.addEventListener('error', (event) => { event.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Image unavailable' })); });
  previewDialog.addEventListener('close', () => { if (opener.isConnected) opener.focus(); }, { once: true });
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
root.addEventListener('error', (event) => { if (event.target.matches?.('.admin-product img')) event.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'G' })); }, true);
function header() { const count = state.unread; return `<header class="admin-header"><a href="/" class="admin-brand">GRACEFUL GIFTS <span>MANILA</span></a><nav><a href="/admin/chat" class="admin-inbox-link" aria-label="Inbox, ${count} unread" ${state.page === 'chat' ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 5h18v13H3zM3 6l9 7 9-7"/></svg><b class="admin-unread-badge" ${count ? '' : 'hidden'}>${count > 9 ? '9+' : count}</b></a>${state.profile?.role === 'owner' ? `<a href="/admin/staff" ${state.page === 'staff' ? 'aria-current="page"' : ''}>Staff</a>` : ''}</nav><button type="button" class="admin-push" data-push ${state.pushAvailable ? '' : 'disabled title="Web Push public key or browser support is unavailable"'}>${state.pushAvailable ? state.pushActive ? 'Disable background alerts' : 'Enable background alerts' : 'Background alerts need setup'}</button><button type="button" class="admin-sound" data-sound aria-pressed="${sound.enabled}">${sound.label()}</button><span class="admin-user">${esc(state.profile?.displayName || state.user?.email || '')} · ${esc(state.profile?.role || '')}</span><button type="button" data-logout>Sign out</button><span class="admin-notice" role="status">${esc(state.notice)}</span></header>`; }
function updateHeader() { const link = root.querySelector('.admin-inbox-link'); if (link) { link.setAttribute('aria-label', `Inbox, ${state.unread} unread`); const badge = link.querySelector('b'); badge.hidden = !state.unread; badge.textContent = state.unread > 9 ? '9+' : String(state.unread); } const button = root.querySelector('[data-sound]'); if (button) { button.textContent = sound.label(); button.setAttribute('aria-pressed', String(sound.enabled)); } const push = root.querySelector('[data-push]'); if (push) { push.disabled = !state.pushAvailable; if (state.pushAvailable) push.removeAttribute('title'); push.textContent = state.pushAvailable ? state.pushActive ? 'Disable background alerts' : 'Enable background alerts' : 'Background alerts need setup'; } const notice = root.querySelector('.admin-notice'); if (notice) notice.textContent = state.notice; }
function renderLogin() { root.innerHTML = `<main class="admin-login"><form id="admin-login-form" class="admin-card"><p class="eyebrow">GRACEFUL GIFTS MANILA</p><h1>Staff sign in</h1><p>Use your individual staff account.</p><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="admin-primary" type="submit">Sign in</button>${state.error ? `<p class="admin-error" role="alert">${esc(state.error)}</p>` : ''}</form></main>`; root.querySelector('form').onsubmit = login; }
function row(item) { const unread = item.lastSenderRole === 'customer' && (!item.staffReadAt || item.lastMessageAt?.toMillis() > item.staffReadAt?.toMillis()); return `<button type="button" class="admin-inbox-row ${unread ? 'unread' : ''} ${state.selected === item.id ? 'selected' : ''}" data-select-chat="${esc(item.id)}"><span class="admin-row-top">${customerLabel(item)}<time>${stamp(item.lastMessageAt)}</time></span><small>${esc(item.lastMessage || '')}</small><span class="admin-row-meta"><em>${esc(item.status)}</em><span>${esc(profileName(item.assignedStaffUid))}</span>${unread ? '<b aria-label="Unread">●</b>' : ''}</span></button>`; }
function renderChat() {
  const matches = state.rows.filter(matchesInbox);
  const selected = state.threadReady && state.rows.find((item) => item.id === state.selected);
  const oldReply = root.dataset.selected === state.selected ? root.querySelector('#admin-reply') : null;
  oldReply?.remove();
  root.innerHTML = header() + `<main class="admin-layout"><aside class="admin-inbox"><div class="admin-inbox-top"><h1>Conversations</h1><p>${state.unread} unread · ${state.rows.length} loaded</p><input id="admin-search" type="search" placeholder="Search loaded conversations" value="${esc(state.search)}"><select id="admin-filter" aria-label="Filter status">${['all','new','open','pending','resolved'].map((status) => `<option value="${status}" ${state.filter === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select></div><div class="admin-inbox-list">${matches.length ? matches.map(row).join('') : '<p class="admin-empty">No conversations found.</p>'}${state.more ? '<button type="button" class="admin-more" data-more>Load more</button>' : ''}</div></aside><section class="admin-thread">${selected ? `<div class="admin-thread-head"><div><h2>${customerLabel(selected)}</h2><small>${esc(selected.customerContact || 'Anonymous website visitor')} · ${stamp(selected.createdAt)}</small></div><div class="admin-controls"><label>Status<select id="admin-status">${['new','open','pending','resolved'].map((status) => `<option value="${status}" ${selected.status === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select></label>${state.profile?.role !== 'staff' ? `<label>Assigned<select id="admin-assignee"><option value="">Unassigned</option>${state.staff.filter((person) => person.active).map((person) => `<option value="${esc(person.id)}" ${selected.assignedStaffUid === person.id ? 'selected' : ''}>${esc(person.displayName)}</option>`).join('')}</select></label>` : `<span>Assigned: ${esc(profileName(selected.assignedStaffUid))}</span>`}</div></div><div class="admin-thread-body" id="admin-thread-body">${state.first ? '<button type="button" data-older>Load earlier messages</button>' : ''}${[...state.older, ...state.messages].map((message) => `<div class="admin-message ${message.senderRole === 'customer' ? 'customer' : 'staff'}"><small>${message.senderRole === 'customer' ? 'Customer' : esc(profileName(message.senderUid))} · ${stamp(message.createdAt)}</small><p>${esc(message.message)}</p>${(message.productReferences || []).map(product).join('')}</div>`).join('')}</div>${selected.productReferences?.length ? `<aside class="admin-refs"><strong>Watches discussed</strong>${selected.productReferences.map(product).join('')}</aside>` : ''}<form id="admin-reply"><label class="visually-hidden" for="admin-message">Reply</label><textarea id="admin-message" maxlength="2000" rows="2" placeholder="Write a reply…" required>${esc(state.replyDraft)}</textarea><button class="admin-primary" type="submit">Send reply</button></form>` : '<div class="admin-empty-thread">Select a conversation to read and reply.</div>'}</section></main>${state.error ? `<div class="admin-toast" role="alert">${esc(state.error)}<button type="button" data-clear-error>×</button></div>` : ''}`;
  root.dataset.selected = state.selected || '';
  if (oldReply && selected) root.querySelector('#admin-reply')?.replaceWith(oldReply);
  root.querySelector('.admin-layout').classList.toggle('thread-open', !!state.mobileThread);
  decorateThread();
  root.querySelector('#admin-search').oninput = (event) => { state.search = event.target.value.toLowerCase(); renderInboxOnly(); };
  root.querySelector('#admin-filter').onchange = (event) => { state.filter = event.target.value; renderInboxOnly(); };
  bindInboxRows();
  root.querySelector('[data-more]')?.addEventListener('click', loadMore);
  root.querySelector('[data-older]')?.addEventListener('click', loadOlder);
  root.querySelector('#admin-status')?.addEventListener('change', (event) => changeConversation({ status: event.target.value }));
  root.querySelector('#admin-assignee')?.addEventListener('change', (event) => changeConversation({ assignedStaffUid: event.target.value || null }));
  const replyForm = root.querySelector('#admin-reply'); if (replyForm) { replyForm.onsubmit = reply; replyForm.querySelector('button').disabled = state.replySending; }
  const replyBox = root.querySelector('#admin-message'); if (replyBox) { replyBox.oninput = (event) => { state.replyDraft = event.target.value; }; replyBox.onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); replyForm.requestSubmit(); } }; }
  root.querySelector('[data-clear-error]')?.addEventListener('click', () => { state.error = ''; render(); });
  bindHeader();
  const body = root.querySelector('#admin-thread-body'); if (body) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}
function matchesInbox(item) { return (state.filter === 'all' || item.status === state.filter) && (!state.search || [item.customerName, guestIdentity(item.id).reference, item.customerContact, item.lastMessage, ...(item.productReferences || []).map((p) => `${p.id} ${p.name}`)].join(' ').toLowerCase().includes(state.search)); }
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
    if (item.senderUid === state.user.uid) {
      const label = status(item, state.receipts.get(item.id));
      const receipt = document.createElement('span'); receipt.className = 'chat-receipt'; receipt.textContent = label; receipt.setAttribute('aria-label', `Message status: ${label}`); bubble.append(receipt);
      if (item.id === lastSeen) { const avatar = document.createElement('span'); avatar.className = 'chat-seen-avatar'; avatar.setAttribute('aria-label', 'Seen by customer'); avatar.innerHTML = '<span aria-hidden="true">C</span>Seen by customer'; bubble.append(avatar); }
    }
    bubble.querySelectorAll('.chat-watch-photo img').forEach((img) => img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'G' })); });
  });
  const pending = state.pendingReply;
  if (pending?.conversationId === state.selected && !records.some((item) => item.id === pending.id)) {
    const bubble = document.createElement('div'); bubble.className = 'admin-message staff'; bubble.dataset.messageId = pending.id;
    const message = document.createElement('p'); message.textContent = pending.message; bubble.append(message);
    const receipt = document.createElement('span'); receipt.className = 'chat-receipt'; receipt.textContent = status(pending); bubble.append(receipt);
    if (pending.failed) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.onclick = retryReply; receipt.append(' ', retry); }
    body.append(bubble);
  }
  body.onscroll = scheduleStaffSeen;
  const head = root.querySelector('.admin-thread-head');
  if (head && !head.querySelector('.admin-back')) { const back = document.createElement('button'); back.type = 'button'; back.className = 'admin-back'; back.textContent = '← Inbox'; back.onclick = () => { state.mobileThread = false; root.querySelector('.admin-layout')?.classList.remove('thread-open'); }; head.prepend(back); }
}
function renderThreadMessages() {
  const body = root.querySelector('#admin-thread-body'); if (!body) { renderChat(); return; }
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 72, oldHeight = body.scrollHeight, oldTop = body.scrollTop;
  body.innerHTML = `${state.first ? '<button type="button" data-older>Load earlier messages</button>' : ''}${[...state.older, ...state.messages].map((message) => `<div class="admin-message ${message.senderRole === 'customer' ? 'customer' : 'staff'}"><small>${message.senderRole === 'customer' ? 'Customer' : esc(profileName(message.senderUid))} · ${stamp(message.createdAt)}</small><p>${esc(message.message)}</p>${(message.productReferences || []).map(product).join('')}</div>`).join('')}`;
  body.querySelector('[data-older]')?.addEventListener('click', loadOlder);
  decorateThread();
  requestAnimationFrame(() => { body.scrollTop = nearBottom ? body.scrollHeight : oldTop + body.scrollHeight - oldHeight; scheduleStaffSeen(); });
}
function renderStaff() {
  const oldStaffForm = root.querySelector('#staff-form');
  oldStaffForm?.remove();
  root.innerHTML = header() + `<main class="admin-staff-page"><div class="admin-page-title"><p class="eyebrow">OWNER ACCESS</p><h1>Staff management</h1><p>Create the email/password user in Firebase Console, then add its UID here. Role changes take effect on the next protected request.</p></div><section class="admin-card"><h2>Add staff</h2><form id="staff-form" class="admin-staff-form"><label>Firebase Auth UID<input name="uid" maxlength="128" required></label><label>Name<input name="name" maxlength="80" required></label><label>Email<input name="email" type="email" maxlength="254" required></label><label>Role<select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label><button class="admin-primary" type="submit">Grant access</button></form></section><section class="admin-card"><h2>Team</h2><div class="admin-staff-list">${state.staff.map((person) => `<div><span><strong>${esc(person.displayName)}</strong><small>${esc(person.email)} · ${esc(person.id)}</small></span><span>${esc(person.role)}</span><span>${person.active ? 'Active' : 'Disabled'}</span>${person.role === 'owner' ? '<span>Owner account</span>' : `<select data-role="${esc(person.id)}" aria-label="Role for ${esc(person.displayName)}"><option value="staff" ${person.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Admin</option></select><button type="button" data-toggle-staff="${esc(person.id)}">${person.active ? 'Disable' : 'Enable'}</button>`}</div>`).join('')}</div></section><section class="admin-card"><h2>Recent activity</h2><div class="admin-activity">${state.activity.length ? state.activity.map((item) => `<p><strong>${esc(profileName(item.actorUid))}</strong> changed ${esc(item.action)} on conversation ${esc(item.conversationId)} · ${stamp(item.createdAt)}</p>`).join('') : '<p>No assignment or status changes yet.</p>'}</div></section>${state.error ? `<p class="admin-error" role="alert">${esc(state.error)}</p>` : ''}</main>`;
  if (oldStaffForm) root.querySelector('#staff-form')?.replaceWith(oldStaffForm);
  const settings = document.createElement('section'); settings.className = 'admin-card';
  settings.innerHTML = `<h2>Chat settings</h2><p>Sound is enabled separately on each device using the button in the header.</p><label>Store avatar image path (optional)<input id="store-avatar" value="${esc(state.settings.storeAvatarUrl || '')}" placeholder="/images/store-avatar.webp"></label><button type="button" id="save-avatar" class="admin-primary">Save avatar</button>`;
  root.querySelector('.admin-activity').closest('.admin-card').before(settings);
  settings.querySelector('#save-avatar').onclick = async () => { const path = settings.querySelector('#store-avatar').value.trim(); if (path && !/^\/images\/[A-Za-z0-9._-]+$/.test(path)) { state.error = 'Use an image path under /images/.'; render(); return; } try { const { db } = await firebase(); await setDoc(doc(db, 'settings', 'chat'), { storeAvatarUrl: path, staffSoundEnabled: !!state.settings.staffSoundEnabled, updatedAt: serverTimestamp() }, { merge: true }); } catch (error) { state.error = displayError(error); render(); } };
  root.querySelector('#staff-form').onsubmit = addStaff;
  root.querySelector('#staff-form button').onclick = addStaff;
  root.querySelector('#staff-form button').disabled = state.staffCreating;
  root.querySelectorAll('[data-role]').forEach((field) => field.onchange = () => editStaff(field.dataset.role, { role: field.value }));
  root.querySelectorAll('[data-toggle-staff]').forEach((button) => button.onclick = () => { const person = state.staff.find((item) => item.id === button.dataset.toggleStaff); if (person) editStaff(person.id, { active: !person.active }); });
  bindHeader();
}
function bindHeader() {
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
      if (state.pushActive) { await revokePush(services); state.pushActive = false; state.notice = 'Background alerts disabled on this browser.'; }
      else { await enablePush(services); state.pushActive = true; state.notice = 'Browser registered. Automatic background delivery awaits trusted sender setup.'; }
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
  if (state.readInFlight || state.rows.find((row) => row.id === id)?.lastMessageId !== messageId) return;
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
  state.inboxInitialized = false; state.knownInbox = new Map();
  const base = collection(db, 'conversations');
  const inbox = state.profile.role === 'staff' ? query(base, where('assignedStaffUid', '==', state.user.uid), orderBy('lastMessageAt', 'desc'), limit(50)) : query(base, orderBy('lastMessageAt', 'desc'), limit(50));
  state.unsubInbox = onSnapshot(inbox, { includeMetadataChanges: true }, (snapshot) => {
    const selectedRow = state.rows.find((item) => item.id === state.selected);
    state.rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (selectedRow && !state.rows.some((item) => item.id === selectedRow.id)) state.rows.push(selectedRow);
    state.cursor = snapshot.docs.at(-1) || null; state.more = snapshot.docs.length === 50;
    if (!snapshot.metadata.fromCache) {
      const fresh = state.rows.filter((item) => item.lastSenderRole === 'customer' && state.knownInbox.get(item.id) !== item.lastMessageId);
      if (state.inboxInitialized && fresh.length && document.visibilityState === 'visible') { state.notice = fresh.length === 1 ? 'New customer message' : `${fresh.length} new customer messages`; sound.notify(); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { state.notice = ''; updateHeader(); }, 5000); }
      state.knownInbox = new Map(state.rows.map((item) => [item.id, item.lastMessageId]));
      state.inboxInitialized = true; acknowledgeInbox(db, state.rows);
      if (!deepLinkHandled && state.page === 'chat') {
        deepLinkHandled = true;
        const id = new URLSearchParams(location.search).get('conversation');
        if (id && /^[A-Za-z0-9_-]{20,128}$/.test(id)) {
          getDoc(doc(db, 'conversations', id)).then((record) => {
            if (!record.exists() || !state.profile?.active) return;
            if (!state.rows.some((item) => item.id === id)) state.rows.push({ id, ...record.data() });
            selectConversation(id);
          }).catch(() => { state.notice = 'This conversation is unavailable to your account.'; updateHeader(); });
        }
      }
    }
    state.unread = state.rows.filter((item) => item.lastSenderRole === 'customer' && (!item.staffReadAt || item.lastMessageAt?.toMillis() > item.staffReadAt?.toMillis())).length;
    if (state.selected && !state.rows.some((item) => item.id === state.selected)) { state.selected = null; state.unsubSelected?.(); state.unsubMessages?.(); state.unsubReceipts?.(); renderChat(); }
    else renderInboxOnly();
  }, (error) => { state.error = displayError(error); render(); });
}
async function loadMore() {
  if (!state.cursor) return;
  try { const { db } = await firebase(); const base = collection(db, 'conversations'); const q = state.profile.role === 'staff' ? query(base, where('assignedStaffUid', '==', state.user.uid), orderBy('lastMessageAt', 'desc'), startAfter(state.cursor), limit(50)) : query(base, orderBy('lastMessageAt', 'desc'), startAfter(state.cursor), limit(50)); const snapshot = await getDocs(q); state.rows = [...state.rows, ...snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))]; state.cursor = snapshot.docs.at(-1) || null; state.more = snapshot.docs.length === 50; render(); } catch (error) { state.error = displayError(error); render(); }
}
async function selectConversation(id) {
  const { db } = await firebase(); state.selected = id; state.mobileThread = true; state.threadReady = false; state.threadSynced = false; state.messages = []; state.older = []; state.receipts = new Map(); state.first = null; state.replyDraft = ''; state.unsubSelected?.(); state.unsubMessages?.(); state.unsubReceipts?.();
  const ref = doc(db, 'conversations', id);
  state.unsubSelected = onSnapshot(ref, (snapshot) => { if (!snapshot.exists()) { state.selected = null; render(); } else { state.rows = state.rows.map((item) => item.id === id ? { id, ...snapshot.data() } : item); renderInboxOnly(); } }, (error) => { state.error = displayError(error); render(); });
  state.unsubReceipts = subscribeReceipts(db, id, (receipts) => { state.receipts = new Map([...state.receipts, ...receipts]); renderThreadMessages(); const latest = state.rows.find((row) => row.id === id); if (latest?.lastSenderRole === 'customer' && receipts.get(latest.lastMessageId)?.seenAt) advanceStaffRead(db, id, latest.lastMessageId); }, (error) => { state.error = displayError(error); render(); });
  state.unsubMessages = onSnapshot(query(collection(ref, 'messages'), orderBy('createdAt', 'desc'), limit(40)), { includeMetadataChanges: true }, (snapshot) => { state.threadSynced = !snapshot.metadata.fromCache; state.messages = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), metadata: item.metadata })).reverse(); if (state.pendingReply && state.messages.some((item) => item.id === state.pendingReply.id)) state.pendingReply = null; state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; if (!state.threadReady) { state.threadReady = true; renderChat(); } else renderThreadMessages(); acknowledgeThread(db); }, (error) => { state.error = displayError(error); render(); });
  render();
}
async function loadOlder() { if (!state.first || !state.selected) return; try { const { db } = await firebase(); const selected = state.selected; const snapshot = await getDocs(query(collection(db, 'conversations', selected, 'messages'), orderBy('createdAt', 'desc'), startAfter(state.first), limit(40))); if (selected !== state.selected) return; const page = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); state.older = [...page.reverse(), ...state.older]; state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; renderThreadMessages(); const receipts = await olderReceipts(db, selected, page); if (selected !== state.selected) return; state.receipts = new Map([...state.receipts, ...receipts]); renderThreadMessages(); } catch (error) { state.error = displayError(error); render(); } }
async function retryReply() {
  const pending = state.pendingReply; if (!pending || state.replySending) return;
  state.replySending = true; pending.pending = true; pending.failed = false; state.error = ''; renderThreadMessages();
  const button = root.querySelector('#admin-reply button'); if (button) button.disabled = true;
  try { const { db } = await firebase(); if (pending.id.startsWith('local-')) pending.id = newMessageId(db, pending.conversationId); await sendMessage(db, pending.conversationId, state.user.uid, state.profile.role, pending.message, [], {}, pending.id); pending.pending = false; if (state.selected === pending.conversationId && state.replyDraft.trim() === pending.message) { state.replyDraft = ''; const input = root.querySelector('#admin-message'); if (input) input.value = ''; } }
  catch (error) { pending.pending = false; pending.failed = true; state.error = displayError(error); }
  finally { state.replySending = false; if (button) button.disabled = false; renderThreadMessages(); }
}
function reply(event) { event.preventDefault(); const text = state.replyDraft.trim(); if (!text || !state.selected || state.replySending) return; if (state.pendingReply?.failed) { state.error = 'Retry the failed reply first.'; render(); return; } state.pendingReply = { id: `local-${Date.now()}`, conversationId: state.selected, senderUid: state.user.uid, senderRole: state.profile.role, message: text, pending: true }; retryReply(); }
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
