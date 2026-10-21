import { customerSession, doc, collection, query, orderBy, limit, startAfter, getDocs, onSnapshot, updateDoc, serverTimestamp, sendMessage, displayError, safeProduct } from './firebase.js';

let state = { open: false, products: [], messages: [], older: [], first: null, unsubConversation: null, unsubMessages: null, loading: false, sending: false, draft: '', name: '', contact: '', error: '', conversation: null, readAckedId: null };
let connectionPromise;
let conversationRef;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = (value) => value?.toDate ? value.toDate().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sending…';
function productCard(product) {
  return `<a class="chat-product" href="${escape(product.url)}" target="_blank" rel="noopener">${product.image ? `<img src="${escape(product.image)}" alt="">` : ''}<span><strong>${escape(product.name)}</strong><small>${escape(product.brand)} · ${escape(product.id)} · ${product.price == null ? 'Price on request' : '₱' + Number(product.price).toLocaleString('en-PH')}</small></span></a>`;
}
function render() {
  let root = document.getElementById('ggm-chat');
  if (!root) { root = document.createElement('aside'); root.id = 'ggm-chat'; document.body.append(root); }
  root.className = `ggm-chat ${state.open ? 'is-open' : ''}`;
  root.setAttribute('aria-label', 'Graceful Gifts Manila customer support');
  const all = [...state.older, ...state.messages];
  root.innerHTML = `<div class="ggm-chat-head"><div><strong>Graceful Gifts Manila</strong><span>Customer Support</span></div><button type="button" data-chat-close aria-label="Close chat">×</button></div><div class="ggm-chat-body" id="ggm-chat-body">${state.loading ? '<p class="ggm-chat-hint">Loading conversation…</p>' : ''}${!all.length && !state.loading ? '<p class="ggm-chat-hint">Hello! Ask us about a watch and we will reply here.</p>' : ''}${state.first ? '<button type="button" class="ggm-chat-more" data-chat-more>Load earlier messages</button>' : ''}${all.map((item) => `<div class="ggm-chat-bubble ${item.senderRole === 'customer' ? 'outgoing' : 'incoming'}"><p>${escape(item.message)}</p>${(item.productReferences || []).map(productCard).join('')}<small>${time(item.createdAt)}${item.createdAt?.toDate ? '' : ' · sending'}</small></div>`).join('')}</div>${state.products.length ? `<div class="ggm-chat-products"><div><strong>Selected watches</strong><button type="button" data-chat-clear>Clear</button></div>${state.products.map(productCard).join('')}</div>` : ''}<form id="ggm-chat-form" class="ggm-chat-form"><label for="ggm-chat-message" class="visually-hidden">Your message</label><textarea id="ggm-chat-message" maxlength="2000" rows="2" placeholder="Write your message…" required ${state.sending || state.loading ? 'disabled' : ''}>${escape(state.draft)}</textarea><button type="submit" ${state.sending || state.loading ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Send'}</button></form>${state.error ? `<p class="ggm-chat-error" role="alert">${escape(state.error)}</p>` : ''}`;
  root.querySelector('[data-chat-close]').onclick = () => { state.open = false; render(); };
  root.querySelector('[data-chat-clear]')?.addEventListener('click', () => { state.products = []; render(); });
  root.querySelector('[data-chat-more]')?.addEventListener('click', loadOlder);
  if (!state.conversation) {
    const identity = document.createElement('div'); identity.className = 'ggm-chat-identity';
    identity.innerHTML = `<label>Your name (optional)<input name="name" maxlength="80" value="${escape(state.name)}" autocomplete="name"></label><label>Email or phone (optional)<input name="contact" maxlength="120" value="${escape(state.contact)}" autocomplete="email"></label>`;
    root.querySelector('form').before(identity);
    identity.querySelector('[name=name]').oninput = (event) => { state.name = event.target.value; };
    identity.querySelector('[name=contact]').oninput = (event) => { state.contact = event.target.value; };
  }
  root.querySelector('form').onsubmit = submit;
  root.querySelector('textarea').oninput = (event) => { state.draft = event.target.value; };
  if (state.open) requestAnimationFrame(() => { const body = document.getElementById('ggm-chat-body'); if (body) body.scrollTop = body.scrollHeight; });
  const badge = document.querySelector('[data-chat-badge]');
  if (badge) { const unread = state.conversation?.lastSenderRole !== 'customer' && state.conversation?.lastMessageAt && (!state.conversation.customerReadAt || state.conversation.lastMessageAt.toMillis() > state.conversation.customerReadAt.toMillis()); badge.hidden = !unread; badge.textContent = unread ? '1' : ''; }
}
async function connect() {
  const { db, user } = await customerSession();
  const ref = doc(db, 'conversations', user.uid);
  conversationRef = ref;
  state.unsubConversation?.(); state.unsubMessages?.();
  state.unsubConversation = onSnapshot(ref, async (snapshot) => {
    state.conversation = snapshot.exists() ? snapshot.data() : null;
    if (snapshot.exists() && !state.unsubMessages) state.unsubMessages = onSnapshot(query(collection(ref, 'messages'), orderBy('createdAt', 'desc'), limit(40)), (messages) => {
      state.first = messages.docs.length === 40 ? messages.docs.at(-1) : null;
      state.messages = messages.docs.map((item) => ({ id: item.id, ...item.data() })).reverse();
      state.loading = false; render();
    }, (error) => { state.loading = false; state.error = displayError(error); render(); });
    if (!snapshot.exists()) state.loading = false;
    await markRead();
    render();
  }, (error) => { state.loading = false; state.error = displayError(error); render(); });
}
async function markRead() {
  const conversation = state.conversation;
  if (!state.open || !conversationRef || !conversation || conversation.lastSenderRole === 'customer' || conversation.lastMessageAt?.toMillis() <= (conversation.customerReadAt?.toMillis() || 0) || state.readAckedId === conversation.lastMessageId) return;
  state.readAckedId = conversation.lastMessageId;
  try { await updateDoc(conversationRef, { customerReadAt: serverTimestamp() }); }
  catch { state.readAckedId = null; }
}
function ensureConnected() {
  if (state.unsubConversation) return Promise.resolve();
  if (!connectionPromise) connectionPromise = connect().catch((error) => { connectionPromise = null; throw error; });
  return connectionPromise;
}
async function loadOlder() {
  if (!state.first) return;
  try {
    const { db, user } = await customerSession();
    const snapshot = await getDocs(query(collection(db, 'conversations', user.uid, 'messages'), orderBy('createdAt', 'desc'), startAfter(state.first), limit(40)));
    state.first = snapshot.docs.length === 40 ? snapshot.docs.at(-1) : null;
    state.older = [...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse(), ...state.older]; render();
  } catch (error) { state.error = displayError(error); render(); }
}
async function submit(event) {
  event.preventDefault();
  const text = state.draft.trim();
  if (!text || state.sending) return;
  state.sending = true; state.error = ''; render();
  try {
    const { db, user } = await customerSession();
    await sendMessage(db, user.uid, user.uid, 'customer', text, state.products, { name: state.name, contact: state.contact });
    try { localStorage.setItem('ggm-chat-started', '1'); } catch {}
    state.products = [];
    state.draft = '';
  } catch (error) { state.error = displayError(error); }
  state.sending = false; render();
}
export async function openChat(watches = []) {
  state.products = [...new Map([...state.products, ...watches.map(safeProduct)].map((watch) => [watch.id, watch])).values()].slice(0, 8);
  state.open = true; state.error = '';
  if (!state.unsubConversation) { state.loading = true; render(); try { await ensureConnected(); } catch (error) { state.loading = false; state.error = displayError(error); render(); } }
  else render();
  await markRead();
  document.getElementById('ggm-chat-message')?.focus();
}
export async function watchChat() {
  if (state.unsubConversation) return;
  try { await ensureConnected(); } catch (error) { state.error = displayError(error); render(); }
}
document.addEventListener('ggm:route', render);
