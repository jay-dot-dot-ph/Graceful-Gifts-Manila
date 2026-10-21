import { customerSession, doc, collection, query, orderBy, limit, startAfter, getDocs, onSnapshot, sendMessage, newMessageId, acknowledgeMessage, displayError, safeProduct } from './firebase.js';
import { escapeHtml as esc, watchCard, receiptLabel, isVisibleInThread, bindBrokenImages } from './presentation.js';

const state = { open: false, products: [], messages: [], older: [], first: null, unsubConversation: null, unsubMessages: null, loading: false, synced: false, messagesSynced: false, sending: false, draft: '', name: '', contact: '', error: '', conversation: null, pending: null };
let connectionPromise;
const time = (value) => value?.toDate ? value.toDate().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Now';
const day = (value) => value?.toDate ? value.toDate().toLocaleDateString('en-PH', { dateStyle: 'medium' }) : 'Today';

function allMessages() {
  const items = [...state.older, ...state.messages];
  if (state.pending && !items.some((item) => item.id === state.pending.id)) items.push(state.pending);
  return items;
}

function render() {
  let root = document.getElementById('ggm-chat');
  if (!root) { root = document.createElement('aside'); root.id = 'ggm-chat'; document.body.append(root); }
  const previous = root.querySelector('#ggm-chat-body');
  const nearBottom = !previous || previous.scrollHeight - previous.scrollTop - previous.clientHeight < 80;
  const oldHeight = previous?.scrollHeight || 0, oldTop = previous?.scrollTop || 0;
  const focused = document.activeElement?.id === 'ggm-chat-message';
  const caret = focused ? document.activeElement.selectionStart : null;
  root.className = `ggm-chat ${state.open ? 'is-open' : ''}`;
  root.setAttribute('aria-label', 'Graceful Gifts Manila customer support');
  const messages = allMessages();
  let lastDay = '';
  root.innerHTML = `<div class="ggm-chat-head"><span class="chat-avatar" aria-hidden="true">G</span><div><strong>Graceful Gifts Manila</strong><span>Customer Support · ${state.loading ? 'Connecting…' : state.synced ? 'Connected' : 'Waiting for connection'}</span></div><button type="button" data-chat-close aria-label="Minimize chat">×</button></div><div class="ggm-chat-body" id="ggm-chat-body" role="log" aria-label="Conversation messages" aria-live="polite">${state.loading ? '<p class="ggm-chat-hint">Loading conversation…</p>' : ''}${!messages.length && !state.loading ? '<p class="ggm-chat-hint">Hello! Ask us about a watch and we will reply here.</p>' : ''}${state.first ? '<button type="button" class="ggm-chat-more" data-chat-more>Load earlier messages</button>' : ''}${messages.map((item) => { const date = day(item.createdAt); const separator = date !== lastDay ? `<div class="chat-day">${esc(date)}</div>` : ''; lastDay = date; const outgoing = item.senderRole === 'customer'; return `${separator}<div class="ggm-chat-bubble ${outgoing ? 'outgoing' : 'incoming'}" data-message-id="${esc(item.id)}"><p>${esc(item.message)}</p>${(item.productReferences || []).map((product) => watchCard(product)).join('')}<small>${time(item.createdAt)}</small>${outgoing ? `<span class="chat-receipt" aria-label="Message status: ${receiptLabel(item)}">${receiptLabel(item)}${item.failed ? ` <button type="button" data-retry="${esc(item.id)}">Retry</button>` : ''}</span>` : ''}</div>`; }).join('')}</div>${state.products.length ? `<div class="ggm-chat-products"><div><strong>Selected watches</strong><button type="button" data-chat-clear>Clear</button></div><div class="chat-watch-list">${state.products.map((product) => watchCard(product)).join('')}</div></div>` : ''}${!state.conversation ? `<div class="ggm-chat-identity"><label>Your name (optional)<input name="name" maxlength="80" value="${esc(state.name)}" autocomplete="name"></label><label>Email or phone (optional)<input name="contact" maxlength="120" value="${esc(state.contact)}" autocomplete="email"></label></div>` : ''}<form id="ggm-chat-form" class="ggm-chat-form"><label for="ggm-chat-message" class="visually-hidden">Your message</label><textarea id="ggm-chat-message" maxlength="2000" rows="2" placeholder="Write your message…" required ${state.sending || state.loading ? 'disabled' : ''}>${esc(state.draft)}</textarea><button type="submit" aria-label="Send message" ${state.sending || state.loading ? 'disabled' : ''}>➤</button></form>${state.error ? `<p class="ggm-chat-error" role="alert">${esc(state.error)}</p>` : ''}`;
  root.querySelector('[data-chat-close]').onclick = () => { state.open = false; render(); };
  root.querySelector('[data-chat-clear]')?.addEventListener('click', () => { state.products = []; render(); });
  root.querySelector('[data-chat-more]')?.addEventListener('click', loadOlder);
  root.querySelectorAll('[data-retry]').forEach((button) => button.onclick = () => sendPending());
  root.querySelector('[name=name]')?.addEventListener('input', (event) => { state.name = event.target.value; });
  root.querySelector('[name=contact]')?.addEventListener('input', (event) => { state.contact = event.target.value; });
  root.querySelector('form').onsubmit = submit;
  const textarea = root.querySelector('textarea');
  textarea.oninput = (event) => { state.draft = event.target.value; };
  textarea.onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); root.querySelector('form').requestSubmit(); } };
  if (focused && state.open && !textarea.disabled) { textarea.focus({ preventScroll: true }); textarea.setSelectionRange(caret, caret); }
  bindBrokenImages(root);
  const body = root.querySelector('#ggm-chat-body');
  body.onscroll = scheduleSeen;
  if (state.open) requestAnimationFrame(() => { body.scrollTop = nearBottom ? body.scrollHeight : oldTop + body.scrollHeight - oldHeight; scheduleSeen(); });
  const badge = document.querySelector('[data-chat-badge]');
  if (badge) { const last = state.conversation; const unread = last?.lastSenderRole !== 'customer' && last?.lastMessageAt && (!last.customerReadAt || last.lastMessageAt.toMillis() > last.customerReadAt.toMillis()); badge.hidden = !unread; badge.textContent = unread ? '1' : ''; }
}

function scheduleSeen() {
  if (!state.open || !state.messagesSynced || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const body = document.getElementById('ggm-chat-body');
  for (const element of body?.querySelectorAll('.ggm-chat-bubble.incoming') || []) {
    if (isVisibleInThread(element, body)) customerSession().then(({ db, user }) => acknowledgeMessage(db, user.uid, element.dataset.messageId, user.uid, true)).catch(() => {});
  }
}

function acknowledgeLoadedReplies(db, uid) {
  if (!state.messagesSynced || document.visibilityState !== 'visible') return;
  for (const item of [...state.older, ...state.messages]) {
    if (item.senderRole !== 'customer' && item.senderUid !== uid && !item.deliveredAt && !item.metadata?.hasPendingWrites) {
      acknowledgeMessage(db, uid, item.id, uid).catch(() => {});
    }
  }
}

async function connect() {
  const { db, user } = await customerSession();
  const ref = doc(db, 'conversations', user.uid);
  state.unsubConversation?.(); state.unsubMessages?.();
  state.unsubConversation = onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
    state.synced = !snapshot.metadata.fromCache;
    state.conversation = snapshot.exists() ? snapshot.data() : null;
    if (snapshot.exists() && !state.unsubMessages) state.unsubMessages = onSnapshot(query(collection(ref, 'messages'), orderBy('createdAt', 'desc'), limit(40)), { includeMetadataChanges: true }, (messages) => {
      state.messagesSynced = !messages.metadata.fromCache;
      state.first = messages.docs.length === 40 ? messages.docs.at(-1) : null;
      state.messages = messages.docs.map((item) => ({ id: item.id, ...item.data(), metadata: item.metadata })).reverse();
      if (state.pending && state.messages.some((item) => item.id === state.pending.id)) state.pending = null;
      state.loading = false; render(); acknowledgeLoadedReplies(db, user.uid);
    }, (error) => { state.loading = false; state.error = displayError(error); render(); });
    if (snapshot.exists() && !snapshot.metadata.fromCache && document.visibilityState === 'visible' && snapshot.data().lastSenderRole !== 'customer') acknowledgeMessage(db, user.uid, snapshot.data().lastMessageId, user.uid).catch(() => {});
    if (!snapshot.exists()) state.loading = false;
    render();
  }, (error) => { state.loading = false; state.error = displayError(error); render(); });
}

function ensureConnected() {
  if (state.unsubConversation) return Promise.resolve();
  if (!connectionPromise) connectionPromise = connect().catch((error) => { connectionPromise = null; throw error; });
  return connectionPromise;
}

async function loadOlder() {
  if (!state.first) return;
  try { const { db, user } = await customerSession(); const snapshot = await getDocs(query(collection(db, 'conversations', user.uid, 'messages'), orderBy('createdAt', 'desc'), startAfter(state.first), limit(40))); state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null; state.older = [...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse(), ...state.older]; render(); acknowledgeLoadedReplies(db, user.uid); }
  catch (error) { state.error = displayError(error); render(); }
}

async function sendPending() {
  if (!state.pending || state.sending) return;
  state.sending = true; state.pending.failed = false; state.pending.pending = true; state.error = ''; render();
  try {
    const { db, user } = await customerSession();
    if (state.pending.id.startsWith('local-')) state.pending.id = newMessageId(db, user.uid);
    const sending = state.pending;
    await sendMessage(db, user.uid, user.uid, 'customer', sending.message, sending.productReferences, { name: state.name, contact: state.contact }, sending.id);
    try { localStorage.setItem('ggm-chat-started', '1'); } catch {}
    sending.pending = false;
    if (state.draft.trim() === sending.message) state.draft = '';
    state.products = [];
  } catch (error) { if (state.pending) { state.pending.pending = false; state.pending.failed = true; } state.error = displayError(error); }
  state.sending = false; render();
}

function submit(event) {
  event.preventDefault();
  const text = state.draft.trim();
  if (!text || state.sending) return;
  if (state.pending?.failed) { state.error = 'Retry the failed message before sending another.'; render(); return; }
  state.pending = { id: `local-${Date.now()}`, senderRole: 'customer', message: text, productReferences: [...state.products], pending: true };
  sendPending();
}

export async function openChat(watches = []) {
  state.products = [...new Map([...state.products, ...watches.map(safeProduct)].map((watch) => [watch.id, watch])).values()].slice(0, 8);
  state.open = true; state.error = '';
  if (!state.unsubConversation) { state.loading = true; render(); try { await ensureConnected(); } catch (error) { state.loading = false; state.error = displayError(error); render(); } }
  else render();
  document.getElementById('ggm-chat-message')?.focus();
}
export async function watchChat() { if (state.unsubConversation) return; try { await ensureConnected(); } catch (error) { state.error = displayError(error); render(); } }
document.addEventListener('ggm:route', render);
document.addEventListener('visibilitychange', () => {
  scheduleSeen();
  const last = state.conversation;
  if (document.visibilityState === 'visible' && state.synced && last?.lastSenderRole !== 'customer' && last?.lastMessageId) customerSession().then(({ db, user }) => { acknowledgeMessage(db, user.uid, last.lastMessageId, user.uid).catch(() => {}); acknowledgeLoadedReplies(db, user.uid); }).catch(() => {});
});
window.addEventListener('focus', scheduleSeen);
