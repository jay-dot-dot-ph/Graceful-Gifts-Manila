import { firebase, signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, collection, query, where, orderBy, limit, startAfter, getDoc, getDocs, onSnapshot, runTransaction, updateDoc, setDoc, serverTimestamp, sendMessage, newMessageId, acknowledgeMessage, displayError } from './firebase.js';
import { watchCard, receiptLabel, isVisibleInThread, bindBrokenImages } from './presentation.js';

const root = document.getElementById('admin-app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stamp = (value) => value?.toDate ? value.toDate().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now';
const state = { user: null, profile: null, staff: [], activity: [], settings: { staffSoundEnabled: false }, rows: [], selected: null, threadReady: false, messages: [], older: [], first: null, page: 'chat', filter: 'all', search: '', cursor: null, more: false, error: '', loading: true, unread: 0, inboxInitialized: false, inboxSynced: false, replyDraft: '', replySending: false, pendingReply: null, mobileThread: false, staffCreating: false, unsubInbox: null, unsubSelected: null, unsubMessages: null, unsubProfile: null, unsubStaff: null, unsubActivity: null, unsubSettings: null };
const deliveredAttempts = new Set();
function cleanup() { for (const key of ['unsubInbox', 'unsubSelected', 'unsubMessages', 'unsubProfile', 'unsubStaff', 'unsubActivity', 'unsubSettings']) { state[key]?.(); state[key] = null; } }
function playAlert() { try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 740; gain.gain.value = 0.025; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.12); oscillator.onended = () => context.close(); } catch {} }
function profileName(uid) { return state.staff.find((person) => person.id === uid)?.displayName || (uid ? 'Staff member' : 'Unassigned'); }
function product(product) { return watchCard(product, 'admin-product'); }
function header() { return `<header class="admin-header"><a href="/" class="admin-brand">GRACEFUL GIFTS <span>MANILA</span></a><nav><a href="/admin/chat" ${state.page === 'chat' ? 'aria-current="page"' : ''}>Inbox <span>${state.unread || ''}</span></a>${state.profile?.role === 'owner' ? `<a href="/admin/staff" ${state.page === 'staff' ? 'aria-current="page"' : ''}>Staff</a>` : ''}</nav><span class="admin-user">${esc(state.profile?.displayName || state.user?.email || '')} · ${esc(state.profile?.role || '')}</span><button type="button" data-logout>Sign out</button></header>`; }
function renderLogin() { root.innerHTML = `<main class="admin-login"><form id="admin-login-form" class="admin-card"><p class="eyebrow">GRACEFUL GIFTS MANILA</p><h1>Staff sign in</h1><p>Use your individual staff account.</p><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="admin-primary" type="submit">Sign in</button>${state.error ? `<p class="admin-error" role="alert">${esc(state.error)}</p>` : ''}</form></main>`; root.querySelector('form').onsubmit = login; }
function row(item) { const unread = item.lastSenderRole === 'customer' && (!item.staffReadAt || item.lastMessageAt?.toMillis() > item.staffReadAt?.toMillis()); const name = item.customerName || 'Guest customer'; return `<button type="button" class="admin-inbox-row ${unread ? 'unread' : ''} ${state.selected === item.id ? 'selected' : ''}" data-select-chat="${esc(item.id)}"><span class="chat-avatar" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span><span class="admin-inbox-copy"><span><strong>${esc(name)}</strong><time>${stamp(item.lastMessageAt)}</time></span><small>${esc(item.lastMessage || '')}</small><span class="admin-row-meta"><em>${esc(item.status)}</em><span>${esc(profileName(item.assignedStaffUid))}</span>${unread ? '<b aria-label="Unread">1</b>' : ''}</span></span></button>`; }
function renderChat() {
  const matches = state.rows.filter((item) => (state.filter === 'all' || item.status === state.filter) && (!state.search || [item.customerName, item.customerContact, item.lastMessage, ...(item.productReferences || []).map((p) => `${p.id} ${p.name}`)].join(' ').toLowerCase().includes(state.search)));
  const selected = state.threadReady && state.rows.find((item) => item.id === state.selected);
  const oldBody = root.querySelector('#admin-thread-body');
  const nearBottom = !oldBody || oldBody.scrollHeight - oldBody.scrollTop - oldBody.clientHeight < 80;
  const oldTop = oldBody?.scrollTop || 0, oldHeight = oldBody?.scrollHeight || 0;
  const oldReply = root.dataset.selected === state.selected ? root.querySelector('#admin-reply') : null;
  oldReply?.remove();
  root.innerHTML = header() + `<main class="admin-layout"><aside class="admin-inbox"><div class="admin-inbox-top"><h1>Conversations</h1><p>${state.unread} unread · ${state.rows.length} loaded</p><input id="admin-search" type="search" placeholder="Search loaded conversations" value="${esc(state.search)}"><select id="admin-filter" aria-label="Filter status">${['all','new','open','pending','resolved'].map((status) => `<option value="${status}" ${state.filter === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select></div><div class="admin-inbox-list">${matches.length ? matches.map(row).join('') : '<p class="admin-empty">No conversations found.</p>'}${state.more ? '<button type="button" class="admin-more" data-more>Load more</button>' : ''}</div></aside><section class="admin-thread">${selected ? `<div class="admin-thread-head"><div><h2>${esc(selected.customerName || 'Guest customer')}</h2><small>${esc(selected.customerContact || 'Anonymous website visitor')} · ${stamp(selected.createdAt)}</small></div><div class="admin-controls"><label>Status<select id="admin-status">${['new','open','pending','resolved'].map((status) => `<option value="${status}" ${selected.status === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select></label>${state.profile?.role !== 'staff' ? `<label>Assigned<select id="admin-assignee"><option value="">Unassigned</option>${state.staff.filter((person) => person.active).map((person) => `<option value="${esc(person.id)}" ${selected.assignedStaffUid === person.id ? 'selected' : ''}>${esc(person.displayName)}</option>`).join('')}</select></label>` : `<span>Assigned: ${esc(profileName(selected.assignedStaffUid))}</span>`}</div></div><div class="admin-thread-body" id="admin-thread-body">${state.first ? '<button type="button" data-older>Load earlier messages</button>' : ''}${[...state.older, ...state.messages].map((message) => `<div class="admin-message ${message.senderRole === 'customer' ? 'customer' : 'staff'}"><small>${message.senderRole === 'customer' ? 'Customer' : esc(profileName(message.senderUid))} · ${stamp(message.createdAt)}</small><p>${esc(message.message)}</p>${(message.productReferences || []).map(product).join('')}</div>`).join('')}</div>${selected.productReferences?.length ? `<aside class="admin-refs"><strong>Watches discussed</strong>${selected.productReferences.map(product).join('')}</aside>` : ''}<form id="admin-reply"><label class="visually-hidden" for="admin-message">Reply</label><textarea id="admin-message" maxlength="2000" rows="2" placeholder="Write a reply…" required>${esc(state.replyDraft)}</textarea><button class="admin-primary" type="submit">Send reply</button></form>` : '<div class="admin-empty-thread">Select a conversation to read and reply.</div>'}</section></main>${state.error ? `<div class="admin-toast" role="alert">${esc(state.error)}<button type="button" data-clear-error>×</button></div>` : ''}`;
  root.dataset.selected = state.selected || '';
  if (oldReply && selected) root.querySelector('#admin-reply')?.replaceWith(oldReply);
  decorateChat(selected);
  root.querySelector('#admin-search').oninput = (event) => { state.search = event.target.value.toLowerCase(); renderChat(); root.querySelector('#admin-search')?.focus(); };
  root.querySelector('#admin-filter').onchange = (event) => { state.filter = event.target.value; renderChat(); };
  root.querySelectorAll('[data-select-chat]').forEach((button) => button.onclick = () => selectConversation(button.dataset.selectChat));
  root.querySelector('[data-more]')?.addEventListener('click', loadMore);
  root.querySelector('[data-older]')?.addEventListener('click', loadOlder);
  root.querySelector('#admin-status')?.addEventListener('change', (event) => changeConversation({ status: event.target.value }));
  root.querySelector('#admin-assignee')?.addEventListener('change', (event) => changeConversation({ assignedStaffUid: event.target.value || null }));
  const replyForm = root.querySelector('#admin-reply'); if (replyForm) { replyForm.onsubmit = reply; replyForm.querySelector('button').disabled = state.replySending; }
  const replyBox = root.querySelector('#admin-message'); if (replyBox) { replyBox.oninput = (event) => { state.replyDraft = event.target.value; }; replyBox.onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); replyForm.requestSubmit(); } }; }
  root.querySelector('[data-clear-error]')?.addEventListener('click', () => { state.error = ''; render(); });
  bindHeader();
  const body = root.querySelector('#admin-thread-body'); if (body) requestAnimationFrame(() => { body.scrollTop = nearBottom ? body.scrollHeight : oldTop + body.scrollHeight - oldHeight; scheduleStaffSeen(); });
}
function decorateChat(selected) {
  const layout = root.querySelector('.admin-layout');
  layout.classList.toggle('thread-open', state.mobileThread);
  if (!selected) return;
  const head = root.querySelector('.admin-thread-head');
  const name = selected.customerName || 'Guest customer';
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'admin-back'; back.textContent = '← Inbox'; back.setAttribute('aria-label', 'Back to conversations');
  back.onclick = () => { state.mobileThread = false; renderChat(); };
  head.prepend(back);
  const avatar = document.createElement('span'); avatar.className = 'chat-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = name.slice(0, 1).toUpperCase();
  head.insertBefore(avatar, head.children[1]);
  const body = root.querySelector('#admin-thread-body');
  const records = [...state.older, ...state.messages];
  let previousDay = '';
  body.querySelectorAll('.admin-message').forEach((element, index) => {
    const item = records[index];
    if (!item) return;
    element.dataset.messageId = item.id;
    const date = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('en-PH', { dateStyle: 'medium' }) : 'Today';
    if (date !== previousDay) { const separator = document.createElement('div'); separator.className = 'chat-day'; separator.textContent = date; element.before(separator); previousDay = date; }
    if (item.senderUid === state.user.uid) {
      const receipt = document.createElement('span'); receipt.className = 'chat-receipt'; receipt.textContent = receiptLabel(item); receipt.setAttribute('aria-label', 'Message status: ' + receiptLabel(item)); element.append(receipt);
    }
  });
  const pending = state.pendingReply;
  if (pending?.conversationId === selected.id && !records.some((item) => item.id === pending.id)) {
    const bubble = document.createElement('div'); bubble.className = 'admin-message staff'; bubble.dataset.messageId = pending.id;
    const message = document.createElement('p'); message.textContent = pending.message; bubble.append(message);
    const receipt = document.createElement('span'); receipt.className = 'chat-receipt'; receipt.textContent = receiptLabel(pending); bubble.append(receipt);
    if (pending.failed) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.onclick = retryReply; receipt.append(' ', retry); }
    body.append(bubble);
  }
  body.onscroll = scheduleStaffSeen;
  const details = document.createElement('aside'); details.className = 'admin-details';
  details.innerHTML = `<h3>Conversation details</h3><p><strong>Customer</strong><br>${esc(name)}</p><p><strong>Contact</strong><br>${esc(selected.customerContact || 'Not provided')}</p><p><strong>Assigned to</strong><br>${esc(profileName(selected.assignedStaffUid))}</p><p><strong>Status</strong><br>${esc(selected.status)}</p>`;
  const refs = root.querySelector('.admin-refs'); if (refs) details.append(refs);
  layout.append(details);
  bindBrokenImages(layout);
}
function scheduleStaffSeen() {
  if (!state.selected || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const body = root.querySelector('#admin-thread-body');
  for (const element of body?.querySelectorAll('.admin-message.customer') || []) {
    if (isVisibleInThread(element, body)) firebase().then(({ db }) => acknowledgeMessage(db, state.selected, element.dataset.messageId, state.user.uid, true)).catch(() => {});
  }
}
document.addEventListener('visibilitychange', () => { scheduleStaffSeen(); if (document.visibilityState === 'visible' && state.inboxSynced && state.page === 'chat') firebase().then(({ db }) => acknowledgeInboxRows(db, state.rows)).catch(() => {}); });
window.addEventListener('focus', scheduleStaffSeen);

function renderStaff() {
  const oldStaffForm = root.querySelector('#staff-form');
  oldStaffForm?.remove();
  root.innerHTML = header() + `<main class="admin-staff-page"><div class="admin-page-title"><p class="eyebrow">OWNER ACCESS</p><h1>Staff management</h1><p>Create the email/password user in Firebase Console, then add its UID here. Role changes take effect on the next protected request.</p></div><section class="admin-card"><h2>Add staff</h2><form id="staff-form" class="admin-staff-form"><label>Firebase Auth UID<input name="uid" maxlength="128" required></label><label>Name<input name="name" maxlength="80" required></label><label>Email<input name="email" type="email" maxlength="254" required></label><label>Role<select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label><button class="admin-primary" type="submit">Grant access</button></form></section><section class="admin-card"><h2>Team</h2><div class="admin-staff-list">${state.staff.map((person) => `<div><span><strong>${esc(person.displayName)}</strong><small>${esc(person.email)} · ${esc(person.id)}</small></span><span>${esc(person.role)}</span><span>${person.active ? 'Active' : 'Disabled'}</span>${person.role === 'owner' ? '<span>Owner account</span>' : `<select data-role="${esc(person.id)}" aria-label="Role for ${esc(person.displayName)}"><option value="staff" ${person.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Admin</option></select><button type="button" data-toggle-staff="${esc(person.id)}">${person.active ? 'Disable' : 'Enable'}</button>`}</div>`).join('')}</div></section><section class="admin-card"><h2>Recent activity</h2><div class="admin-activity">${state.activity.length ? state.activity.map((item) => `<p><strong>${esc(profileName(item.actorUid))}</strong> changed ${esc(item.action)} on conversation ${esc(item.conversationId)} · ${stamp(item.createdAt)}</p>`).join('') : '<p>No assignment or status changes yet.</p>'}</div></section>${state.error ? `<p class="admin-error" role="alert">${esc(state.error)}</p>` : ''}</main>`;
  if (oldStaffForm) root.querySelector('#staff-form')?.replaceWith(oldStaffForm);
  const settings = document.createElement('section'); settings.className = 'admin-card';
  settings.innerHTML = `<h2>Chat settings</h2><label class="admin-check"><input id="staff-sound" type="checkbox" ${state.settings.staffSoundEnabled ? 'checked' : ''}> Play a sound when a new customer message arrives</label>`;
  root.querySelector('.admin-activity').closest('.admin-card').before(settings);
  settings.querySelector('input').onchange = async (event) => { try { const { db } = await firebase(); await setDoc(doc(db, 'settings', 'chat'), { staffSoundEnabled: event.target.checked, updatedAt: serverTimestamp() }); } catch (error) { state.error = displayError(error); render(); } };
  root.querySelector('#staff-form').onsubmit = addStaff;
  root.querySelector('#staff-form button').onclick = addStaff;
  root.querySelector('#staff-form button').disabled = state.staffCreating;
  root.querySelectorAll('[data-role]').forEach((field) => field.onchange = () => editStaff(field.dataset.role, { role: field.value }));
  root.querySelectorAll('[data-toggle-staff]').forEach((button) => button.onclick = () => { const person = state.staff.find((item) => item.id === button.dataset.toggleStaff); if (person) editStaff(person.id, { active: !person.active }); });
  bindHeader();
}
function bindHeader() { root.querySelector('[data-logout]')?.addEventListener('click', async () => { const { auth } = await firebase(); await signOut(auth); location.assign('/admin/chat'); }); }
function render() { if (state.loading) { root.innerHTML = '<main class="admin-login"><p>Checking access…</p></main>'; return; } if (!state.user || !state.profile?.active) { renderLogin(); return; } if (state.page === 'staff' && state.profile.role === 'owner') renderStaff(); else renderChat(); }
async function login(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true; try { const { auth } = await firebase(); await signInWithEmailAndPassword(auth, form.elements.namedItem('email').value.trim(), form.elements.namedItem('password').value); } catch (error) { state.error = displayError(error); button.disabled = false; renderLogin(); } }
function subscribeStaff(db) { state.unsubStaff?.(); state.unsubActivity?.(); state.unsubStaff = onSnapshot(query(collection(db, 'staff'), limit(100)), (snapshot) => { state.staff = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }, (error) => { state.error = displayError(error); render(); }); if (state.profile.role === 'owner') state.unsubActivity = onSnapshot(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(50)), (snapshot) => { state.activity = snapshot.docs.map((item) => item.data()); render(); }, (error) => { state.error = displayError(error); render(); }); }
function subscribeSettings(db) { state.unsubSettings?.(); state.unsubSettings = onSnapshot(doc(db, 'settings', 'chat'), (snapshot) => { state.settings = snapshot.exists() ? snapshot.data() : { staffSoundEnabled: false }; render(); }, (error) => { state.error = displayError(error); render(); }); }
function acknowledgeInboxRows(db, rows) {
  if (document.visibilityState !== 'visible' || state.page !== 'chat') return;
  for (const item of rows) {
    const key = `${item.id}/${item.lastMessageId}`;
    if (item.lastSenderRole === 'customer' && (!item.staffReadAt || item.lastMessageAt?.toMillis() > item.staffReadAt?.toMillis()) && !deliveredAttempts.has(key)) {
      deliveredAttempts.add(key);
      acknowledgeMessage(db, item.id, item.lastMessageId, state.user.uid).catch(() => deliveredAttempts.delete(key));
    }
  }
}
function subscribeInbox(db) {
  state.unsubInbox?.();
  state.inboxInitialized = false;
  const base = collection(db, 'conversations');
  const inbox = state.profile.role === 'staff' ? query(base, where('assignedStaffUid', '==', state.user.uid), orderBy('lastMessageAt', 'desc'), limit(50)) : query(base, orderBy('lastMessageAt', 'desc'), limit(50));
  state.unsubInbox = onSnapshot(inbox, (snapshot) => {
    state.rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); state.cursor = snapshot.docs.at(-1) || null; state.more = snapshot.docs.length === 50;
    state.inboxSynced = !snapshot.metadata.fromCache;
    if (state.inboxSynced) acknowledgeInboxRows(db, snapshot.docChanges().map((change) => ({ id: change.doc.id, ...change.doc.data() })));
    const previousUnread = state.unread;
    state.unread = state.rows.filter((item) => item.lastSenderRole === 'customer' && (!item.staffReadAt || item.lastMessageAt?.toMillis() > item.staffReadAt?.toMillis())).length;
    if (state.inboxInitialized && state.unread > previousUnread && state.settings.staffSoundEnabled) playAlert();
    state.inboxInitialized = true;
    if (state.selected && !state.rows.some((item) => item.id === state.selected)) { state.selected = null; state.unsubSelected?.(); state.unsubMessages?.(); }
    render();
  }, (error) => { state.error = displayError(error); render(); });
}
async function loadMore() {
  if (!state.cursor) return;
  try { const { db } = await firebase(); const base = collection(db, 'conversations'); const q = state.profile.role === 'staff' ? query(base, where('assignedStaffUid', '==', state.user.uid), orderBy('lastMessageAt', 'desc'), startAfter(state.cursor), limit(50)) : query(base, orderBy('lastMessageAt', 'desc'), startAfter(state.cursor), limit(50)); const snapshot = await getDocs(q); state.rows = [...state.rows, ...snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))]; state.cursor = snapshot.docs.at(-1) || null; state.more = snapshot.docs.length === 50; render(); } catch (error) { state.error = displayError(error); render(); }
}
async function selectConversation(id) {
  const { db } = await firebase(); state.selected = id; state.mobileThread = true; state.threadReady = false; state.messages = []; state.older = []; state.first = null; state.replyDraft = ''; state.unsubSelected?.(); state.unsubMessages?.();
  const ref = doc(db, 'conversations', id);
  state.unsubSelected = onSnapshot(ref, (snapshot) => { if (!snapshot.exists()) { state.selected = null; } else { const data = snapshot.data(); state.rows = state.rows.map((item) => item.id === id ? { id, ...data } : item); } render(); }, (error) => { state.error = displayError(error); render(); });
  state.unsubMessages = onSnapshot(query(collection(ref, 'messages'), orderBy('createdAt', 'desc'), limit(40)), (snapshot) => { state.messages = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), metadata: item.metadata })).reverse(); if (state.pendingReply && state.messages.some((item) => item.id === state.pendingReply.id)) state.pendingReply = null; state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; state.threadReady = true; render(); }, (error) => { state.error = displayError(error); render(); });
  render();
}
async function loadOlder() { if (!state.first || !state.selected) return; try { const { db } = await firebase(); const snapshot = await getDocs(query(collection(db, 'conversations', state.selected, 'messages'), orderBy('createdAt', 'desc'), startAfter(state.first), limit(40))); state.older = [...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse(), ...state.older]; state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; render(); } catch (error) { state.error = displayError(error); render(); } }
async function retryReply() {
  if (!state.pendingReply || state.replySending) return;
  state.replySending = true; state.pendingReply.failed = false; state.pendingReply.pending = true; state.error = ''; render();
  const pending = state.pendingReply;
  try {
    const { db } = await firebase();
    if (pending.id.startsWith('local-')) pending.id = newMessageId(db, pending.conversationId);
    await sendMessage(db, pending.conversationId, state.user.uid, state.profile.role, pending.message, [], {}, pending.id);
    pending.pending = false;
    if (state.replyDraft.trim() === pending.message) { state.replyDraft = ''; const current = root.querySelector('#admin-message'); if (current) current.value = ''; }
  } catch (error) { pending.pending = false; pending.failed = true; state.error = displayError(error); }
  state.replySending = false; render();
}
function reply(event) {
  event.preventDefault();
  const text = state.replyDraft.trim(), conversationId = state.selected;
  if (!text || !conversationId || state.replySending) return;
  if (state.pendingReply?.failed) { state.error = 'Retry the failed reply before sending another.'; render(); return; }
  state.pendingReply = { id: `local-${Date.now()}`, conversationId, senderRole: state.profile.role, message: text, pending: true };
  retryReply();
}
async function changeConversation(change) { if (!state.selected) return; try { const { db } = await firebase(); const ref = doc(db, 'conversations', state.selected); const audit = doc(collection(db, 'auditLogs')); const action = 'status' in change ? 'status' : 'assignment'; const field = action === 'status' ? 'status' : 'assignedStaffUid'; const expected = state.rows.find((item) => item.id === state.selected)?.[field]; await runTransaction(db, async (tx) => { const snapshot = await tx.get(ref); if (!snapshot.exists()) throw new Error('Conversation no longer exists.'); if (snapshot.data()[field] !== expected) throw new Error('This conversation changed. Please review it again.'); const now = serverTimestamp(); tx.update(ref, { ...change, updatedAt: now, lastAuditId: audit.id }); tx.set(audit, { action, conversationId: state.selected, actorUid: state.user.uid, oldValue: snapshot.data()[field], newValue: change[field], createdAt: now }); }); } catch (error) { state.error = displayError(error); render(); } }
async function addStaff(event) { event.preventDefault(); if (state.staffCreating) return; const form = event.currentTarget.closest('form'); if (!form.reportValidity()) return; const field = (name) => form.elements.namedItem(name).value; const uid = field('uid').trim(); if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) { state.error = 'Enter a valid Firebase Auth UID.'; render(); return; } const profile = { displayName: field('name').trim(), email: field('email').trim().toLowerCase(), role: field('role'), active: true, createdAt: serverTimestamp(), createdBy: state.user.uid }; state.staffCreating = true; const button = form.querySelector('button'); button.disabled = true; try { const { db } = await firebase(); const ref = doc(db, 'staff', uid); await runTransaction(db, async (tx) => { if ((await tx.get(ref)).exists()) throw new Error('This UID already has a staff profile.'); tx.set(ref, profile); }); form.reset(); } catch (error) { state.error = displayError(error); } finally { state.staffCreating = false; render(); } }
async function editStaff(uid, change) { try { const { db } = await firebase(); await updateDoc(doc(db, 'staff', uid), change); } catch (error) { state.error = displayError(error); render(); } }
async function start() { state.page = location.pathname.endsWith('/staff') ? 'staff' : 'chat'; try { const { auth, db } = await firebase(); onAuthStateChanged(auth, (user) => { cleanup(); state.user = user && !user.isAnonymous ? user : null; state.profile = null; state.rows = []; state.staff = []; state.selected = null; state.loading = !!state.user; state.error = ''; render(); if (!state.user) return; state.unsubProfile = onSnapshot(doc(db, 'staff', state.user.uid), (snapshot) => { const profile = snapshot.exists() ? snapshot.data() : null; if (!profile?.active) { cleanup(); state.profile = null; state.loading = false; state.error = 'This account has no active staff access.'; render(); return; } const changed = state.profile?.role !== profile.role; state.profile = profile; state.loading = false; if (state.page === 'staff' && profile.role !== 'owner') state.page = 'chat'; if (changed) { subscribeStaff(db); subscribeSettings(db); if (state.page === 'chat') subscribeInbox(db); } render(); }, (error) => { state.loading = false; state.error = displayError(error); render(); }); }); } catch (error) { state.loading = false; state.error = displayError(error); render(); } }
start();
