import { customerSession, firebase, doc, collection, query, orderBy, limit, startAfter, getDocs, onSnapshot, updateDoc, serverTimestamp, sendMessage, newMessageId, displayError, safeProduct } from './firebase.js';
import { acknowledge, subscribeReceipts, olderReceipts, status, bubbleVisible } from './receipts.js';
import { createNotifier } from './notify.js';
import { mediaEnabled, checkFile, uploadMedia, mediaMarkup, hydrateMedia } from './media.js';

const state = { open: false, products: [], messages: [], older: [], receipts: new Map(), avatarUrl: '', first: null, loading: false, synced: false, messagesReady: false, draft: '', name: '', contact: '', error: '', conversation: null, pending: null, sending: false, attachment: null, uploadProgress: 0, mediaAvailable: false, unsubConversation: null, unsubMessages: null, unsubReceipts: null, unsubSettings: null, knownIncoming: new Set(), readInFlight: false };
const sound = createNotifier('customer', () => renderChrome());
let connectionPromise, db, uid;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = (value) => value?.toDate ? value.toDate().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Now';
const productCard = (watch) => {
  if (!/^[A-Z0-9-]{2,20}$/.test(watch.id || '')) return '';
  const image = /^\/images\/[A-Za-z0-9._-]+$/.test(watch.image || '') ? watch.image : '';
  const details = [watch.brand, `ID ${watch.id}`, watch.price == null ? 'Price on request' : `₱${Number(watch.price).toLocaleString('en-PH')}`, watch.size || ''].filter(Boolean).join(' · ');
  return `<a class="chat-product" href="/watch/${encodeURIComponent(watch.id)}" target="_blank" rel="noopener"><span class="chat-watch-photo">${image ? `<img src="${esc(image)}" alt="${esc(watch.name || watch.id)}" loading="lazy">` : '<span aria-hidden="true">G</span>'}</span><span><strong>${esc(watch.name || watch.id)}</strong><small>${esc(details)}</small></span></a>`;
};
const allMessages = () => { const all = [...state.older, ...state.messages]; if (state.pending && !all.some((item) => item.id === state.pending.id)) all.push(state.pending); return all; };

function ensureRoot() {
  let root = document.getElementById('ggm-chat'); if (root) return root;
  root = document.createElement('aside'); root.id = 'ggm-chat'; root.className = 'ggm-chat'; root.setAttribute('aria-label', 'Graceful Gifts Manila customer support');
  root.innerHTML = `<div class="ggm-chat-head"><span class="chat-store-avatar" aria-hidden="true">G</span><div class="chat-store-label"><strong>Graceful Gifts Manila</strong><span>Customer Support</span></div><button type="button" class="chat-sound" data-sound aria-label="Mute sounds"></button><button type="button" class="chat-close" data-chat-close aria-label="Close chat">×</button></div><div class="ggm-chat-body" id="ggm-chat-body" role="log" aria-label="Conversation messages"></div><div class="ggm-chat-products"></div><div class="ggm-chat-identity"><label>Your name (optional)<input name="name" maxlength="80" autocomplete="name"></label><label>Email or phone (optional)<input name="contact" maxlength="120" autocomplete="email"></label></div><div class="chat-attachment-preview" id="ggm-attachment-preview" hidden></div><form id="ggm-chat-form" class="ggm-chat-form"><label class="chat-attach" id="ggm-attach-label" hidden title="Send a message first to start the conversation">＋<span class="visually-hidden">Attach photo or video</span><input id="ggm-chat-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden></label><label for="ggm-chat-message" class="visually-hidden">Your message</label><textarea id="ggm-chat-message" maxlength="2000" rows="2" placeholder="Write your message…"></textarea><button type="submit">Send</button></form><p class="ggm-chat-error" role="alert" hidden></p>`;
  document.body.append(root);
  root.querySelector('[data-chat-close]').onclick = () => { state.open = false; render(); };
  root.querySelector('[data-sound]').onclick = () => sound.toggle();
  root.querySelector('form').onsubmit = submit;
  root.querySelector('textarea').oninput = (event) => { state.draft = event.target.value; };
  root.querySelector('#ggm-chat-file').onchange = (event) => { try { const file = event.target.files[0]; if (file) { checkFile(file); state.attachment = file; state.error = ''; } } catch (error) { state.error = displayError(error); } event.target.value = ''; renderChrome(); };
  root.querySelector('textarea').onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); root.querySelector('form').requestSubmit(); } };
  root.querySelector('[name=name]').oninput = (event) => { state.name = event.target.value; };
  root.querySelector('[name=contact]').oninput = (event) => { state.contact = event.target.value; };
  root.querySelector('#ggm-chat-body').onscroll = scheduleSeen;
  return root;
}
function renderChrome() {
  const root = ensureRoot(); root.classList.toggle('is-open', state.open);
  const soundButton = root.querySelector('[data-sound]'); soundButton.textContent = sound.label(); soundButton.setAttribute('aria-label', sound.label()); soundButton.setAttribute('aria-pressed', String(sound.enabled));
  root.querySelector('.ggm-chat-identity').hidden = !!state.conversation;
  const products = root.querySelector('.ggm-chat-products'); products.hidden = !state.products.length;
  products.innerHTML = state.products.length ? `<div><strong>Selected watches</strong><button type="button" data-chat-clear>Clear</button></div>${state.products.map(productCard).join('')}` : '';
  products.querySelector('[data-chat-clear]')?.addEventListener('click', () => { state.products = []; renderChrome(); });
  const composer = root.querySelector('textarea'); if (composer.value !== state.draft) composer.value = state.draft;
  composer.disabled = state.sending || state.loading;
  const attach = root.querySelector('#ggm-attach-label'); attach.hidden = !state.mediaAvailable; attach.classList.toggle('is-disabled', state.sending || !state.conversation); attach.title = state.conversation ? 'Attach photo or video' : 'Send a message first to start the conversation';
  root.querySelector('#ggm-chat-file').disabled = state.sending || !state.conversation;
  const preview = root.querySelector('#ggm-attachment-preview'); preview.hidden = !state.attachment; preview.innerHTML = state.attachment ? `<span>${esc(state.attachment.name)} · ${(state.attachment.size / 1_000_000).toFixed(1)} MB${state.sending ? ` · ${state.uploadProgress}%` : ''}</span><button type="button" data-remove-attachment ${state.sending ? 'disabled' : ''} aria-label="Remove attachment">×</button>` : '';
  preview.querySelector('[data-remove-attachment]')?.addEventListener('click', () => { state.attachment = null; renderChrome(); });
  const send = root.querySelector('form button'); send.disabled = composer.disabled; send.textContent = state.sending ? 'Sending…' : 'Send';
  const error = root.querySelector('.ggm-chat-error'); error.hidden = !state.error; error.textContent = state.error;
  const badge = document.querySelector('[data-chat-badge]');
  if (badge) { const c = state.conversation; const unread = c?.lastSenderRole !== 'customer' && c?.lastMessageAt && (!c.customerReadAt || c.lastMessageAt.toMillis() > c.customerReadAt.toMillis()); badge.hidden = !unread; badge.textContent = unread ? '1' : ''; }
}
function renderMessages() {
  const body = ensureRoot().querySelector('#ggm-chat-body');
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 72, before = body.scrollHeight, top = body.scrollTop;
  const all = allMessages(); let latestSeen = null;
  for (const item of all) if (item.senderUid === uid && state.receipts.get(item.id)?.seenAt) latestSeen = item.id;
  body.innerHTML = `${state.loading ? '<p class="ggm-chat-hint">Loading conversation…</p>' : ''}${!all.length && !state.loading ? '<p class="ggm-chat-hint">Hello! Ask us about a watch and we will reply here.</p>' : ''}${state.first ? '<button type="button" class="ggm-chat-more" data-chat-more>Load earlier messages</button>' : ''}${all.map((item) => {
    const outgoing = item.senderUid === uid || item.senderRole === 'customer' && !uid;
    const label = status(item, state.receipts.get(item.id));
    return `<div class="ggm-chat-bubble ${outgoing ? 'outgoing' : 'incoming'}" data-message-id="${esc(item.id)}"><p>${esc(item.message)}</p>${item.media ? mediaMarkup(item.media, uid, item.id) : ''}${(item.productReferences || []).map(productCard).join('')}<small>${time(item.createdAt)}</small>${outgoing ? `<span class="chat-receipt" aria-label="Message status: ${label}">${label}${item.failed ? ' <button type="button" data-retry>Retry</button>' : ''}</span>${item.id === latestSeen ? `<span class="chat-seen-avatar" aria-label="Seen by store"><span aria-hidden="true">${state.avatarUrl ? `<img src="${esc(state.avatarUrl)}" alt="">` : 'G'}</span>Seen by store</span>` : ''}` : ''}</div>`;
  }).join('')}`;
  body.querySelector('[data-chat-more]')?.addEventListener('click', loadOlder);
  body.querySelector('[data-retry]')?.addEventListener('click', sendPending);
  body.querySelectorAll('.chat-watch-photo img').forEach((img) => img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'G' })); });
  body.querySelectorAll('.chat-seen-avatar img').forEach((img) => img.onerror = () => { img.replaceWith(document.createTextNode('G')); });
  if (body.querySelector('[data-media-path]')) firebase().then(({ app, config }) => hydrateMedia(body, app, config.emulator)).catch(() => {});
  if (state.open) requestAnimationFrame(() => { body.scrollTop = nearBottom ? body.scrollHeight : top + body.scrollHeight - before; scheduleSeen(); });
}
function render() { renderChrome(); renderMessages(); }
function showNotice() {
  let notice = document.getElementById('ggm-chat-notice');
  if (!notice) { notice = document.createElement('div'); notice.id = 'ggm-chat-notice'; notice.setAttribute('role', 'status'); document.body.append(notice); }
  notice.textContent = 'New reply from Graceful Gifts Manila'; notice.hidden = state.open;
  clearTimeout(showNotice.timer); showNotice.timer = setTimeout(() => { notice.hidden = true; }, 5000);
}
function scheduleSeen() {
  if (!state.open || !state.synced || document.visibilityState !== 'visible' || !document.hasFocus() || !db || !uid) return;
  const body = document.getElementById('ggm-chat-body');
  for (const bubble of body?.querySelectorAll('.ggm-chat-bubble.incoming') || []) {
    if (!bubbleVisible(bubble, body)) continue;
    const item = [...state.older, ...state.messages].find((message) => message.id === bubble.dataset.messageId);
    if (!item || state.receipts.get(item.id)?.seenAt) continue;
    acknowledge(db, uid, item, uid, true).then(() => { if (state.conversation?.lastMessageId === item.id) advanceRead(item.id); }).catch(() => {});
  }
}
async function advanceRead(messageId) {
  if (state.readInFlight || state.conversation?.lastMessageId !== messageId || state.conversation.lastSenderRole === 'customer') return;
  state.readInFlight = true;
  try { await updateDoc(doc(db, 'conversations', uid), { customerReadAt: serverTimestamp() }); }
  catch (error) { console.warn('Customer read marker failed:', error?.code || error?.message); }
  finally { state.readInFlight = false; }
}
function acknowledgeLoaded() {
  if (!state.synced || document.visibilityState !== 'visible' || !db || !uid) return;
  for (const item of state.messages) if (item.senderRole !== 'customer' && !state.receipts.get(item.id)?.deliveredAt && !item.metadata?.hasPendingWrites) acknowledge(db, uid, item, uid).catch(() => {});
}
async function connect() {
  const session = await customerSession(); db = session.db; uid = session.user.uid;
  const ref = doc(db, 'conversations', uid);
  state.unsubConversation?.(); state.unsubMessages?.(); state.unsubReceipts?.(); state.unsubSettings?.();
  state.unsubSettings = onSnapshot(doc(db, 'settings', 'chat'), (snapshot) => { const path = snapshot.data()?.storeAvatarUrl || ''; state.avatarUrl = /^\/images\/[A-Za-z0-9._-]+$/.test(path) ? path : ''; renderMessages(); }, () => {});
  state.unsubConversation = onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
    state.conversation = snapshot.exists() ? snapshot.data() : null;
    if (snapshot.exists() && !state.unsubMessages) {
      state.unsubReceipts = subscribeReceipts(db, uid, (receipts) => { state.receipts = new Map([...state.receipts, ...receipts]); renderMessages(); if (receipts.get(state.conversation?.lastMessageId)?.seenAt) advanceRead(state.conversation.lastMessageId); }, (error) => { state.error = displayError(error); renderChrome(); });
      state.unsubMessages = onSnapshot(query(collection(ref, 'messages'), orderBy('createdAt', 'desc'), limit(40)), { includeMetadataChanges: true }, (messages) => {
        const incoming = messages.docs.filter((item) => item.data().senderRole !== 'customer' && !item.metadata.hasPendingWrites);
        if (state.messagesReady && !messages.metadata.fromCache && incoming.some((item) => !state.knownIncoming.has(item.id)) && document.visibilityState === 'visible') { sound.notify(); showNotice(); }
        if (!messages.metadata.fromCache) { state.messagesReady = true; for (const item of incoming) state.knownIncoming.add(item.id); }
        state.synced = !messages.metadata.fromCache;
        state.first = messages.docs.length === 40 ? messages.docs.at(-1) : null;
        state.messages = messages.docs.map((item) => ({ id: item.id, ...item.data(), metadata: item.metadata })).reverse();
        if (state.pending && state.messages.some((item) => item.id === state.pending.id)) state.pending = null;
        state.loading = false; render(); acknowledgeLoaded();
      }, (error) => { state.loading = false; state.error = displayError(error); render(); });
    }
    if (!snapshot.exists()) { state.loading = false; render(); }
    else renderChrome();
  }, (error) => { state.loading = false; state.error = displayError(error); render(); });
}
function ensureConnected() { if (state.unsubConversation) return Promise.resolve(); if (!connectionPromise) connectionPromise = connect().catch((error) => { connectionPromise = null; throw error; }); return connectionPromise; }
async function loadOlder() {
  if (!state.first) return;
  try { const snapshot = await getDocs(query(collection(db, 'conversations', uid, 'messages'), orderBy('createdAt', 'desc'), startAfter(state.first), limit(40))); const page = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; state.older = [...page.reverse(), ...state.older]; renderMessages(); const receipts = await olderReceipts(db, uid, page); state.receipts = new Map([...state.receipts, ...receipts]); renderMessages(); }
  catch (error) { state.error = displayError(error); renderChrome(); }
}
async function sendPending() {
  if (!state.pending || state.sending) return;
  state.sending = true; state.pending.failed = false; state.pending.pending = true; state.error = ''; render();
  try {
    await ensureConnected(); if (state.pending.id.startsWith('local-')) state.pending.id = newMessageId(db, uid);
    const pending = state.pending;
    if (pending.file && !pending.media) { const { app, config } = await firebase(); pending.media = await uploadMedia(app, config.emulator, uid, pending.id, uid, pending.file, (value) => { state.uploadProgress = value; renderChrome(); }); }
    await sendMessage(db, uid, uid, 'customer', pending.message, pending.productReferences, { name: state.name, contact: state.contact }, pending.id, pending.media);
    try { localStorage.setItem('ggm-chat-started', '1'); } catch {}
    pending.pending = false; state.products = []; if (state.draft.trim() === pending.text) state.draft = ''; if (state.attachment === pending.file) state.attachment = null;
  } catch (error) { if (state.pending) { state.pending.pending = false; state.pending.failed = true; } state.error = displayError(error); }
  state.sending = false; render();
}
function submit(event) {
  event.preventDefault(); const text = state.draft.trim(); if ((!text && !state.attachment) || state.sending) return;
  if (state.attachment && !state.conversation) { state.error = 'Send a message first to start the conversation, then attach a photo or video.'; renderChrome(); return; }
  if (state.pending?.failed) { state.error = 'Retry the failed message first.'; renderChrome(); return; }
  state.pending = { id: `local-${Date.now()}`, senderUid: uid, senderRole: 'customer', message: text || (state.attachment?.type.startsWith('image/') ? 'Photo' : 'Video'), text, file: state.attachment, productReferences: [...state.products], pending: true }; sendPending();
}
export async function openChat(watches = []) {
  state.products = [...new Map([...state.products, ...watches.map(safeProduct)].map((watch) => [watch.id, watch])).values()].slice(0, 8);
  state.open = true; state.error = '';
  if (!state.unsubConversation) { state.loading = true; render(); try { await ensureConnected(); } catch (error) { state.loading = false; state.error = displayError(error); render(); } } else render();
}
export async function watchChat() { if (state.unsubConversation) return; try { await ensureConnected(); } catch (error) { state.error = displayError(error); render(); } }
document.addEventListener('ggm:route', renderChrome);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { acknowledgeLoaded(); scheduleSeen(); } });
window.addEventListener('focus', scheduleSeen);
function sizeChat() { if (!window.visualViewport) return; document.documentElement.style.setProperty('--ggm-viewport-height', `${window.visualViewport.height}px`); document.documentElement.style.setProperty('--ggm-viewport-top', `${window.visualViewport.offsetTop}px`); }
window.visualViewport?.addEventListener('resize', sizeChat);
window.visualViewport?.addEventListener('scroll', sizeChat);
sizeChat();
mediaEnabled().then((enabled) => { state.mediaAvailable = enabled; if (document.getElementById('ggm-chat')) renderChrome(); });
