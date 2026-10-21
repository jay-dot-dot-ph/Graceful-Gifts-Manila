import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const listeners = new Map(), shown = [], opened = [], navigated = [], focused = [];
let visible = false;
const client = {
  url: 'https://graceful-gifts-manila.web.app/admin/chat',
  get visibilityState() { return visible ? 'visible' : 'hidden'; },
  async navigate(url) { navigated.push(url); return this; },
  async focus() { focused.push(true); }
};
const self = {
  location: { origin: 'https://graceful-gifts-manila.web.app' },
  addEventListener(name, handler) { listeners.set(name, handler); },
  clients: { async matchAll() { return [client]; }, async openWindow(url) { opened.push(url); } },
  registration: { async showNotification(title, options) { shown.push({ title, options }); } }
};
runInNewContext(readFileSync('chat/messaging-sw.js', 'utf8'), { self, URL, encodeURIComponent });
async function dispatch(kind, event) {
  let pending;
  listeners.get(kind)({ ...event, waitUntil(task) { pending = task; } });
  await pending;
}
const id = 'a'.repeat(28), messageId = 'b'.repeat(20);
await dispatch('push', { data: { json: () => ({ data: { kind: 'customer-message', conversationId: id, messageId, senderLabel: 'Guest #ABC1234', preview: 'Is this available?', previewAllowed: 'true' } }) } });
assert.equal(shown.length, 1);
assert.equal(shown[0].options.body, 'Is this available?');
assert.equal(shown[0].options.tag, `chat-${id}-${messageId}`);
visible = true;
await dispatch('push', { data: { json: () => ({ data: { kind: 'customer-message', conversationId: id, messageId } }) } });
assert.equal(shown.length, 1, 'A visible dashboard uses its Firestore alert instead');
visible = false;
await dispatch('push', { data: { json: () => ({ data: { kind: 'customer-message', conversationId: 'bad', messageId } }) } });
assert.equal(shown.length, 1, 'Malformed conversation links are ignored');
let closed = false;
await dispatch('notificationclick', { notification: { data: shown[0].options.data, close() { closed = true; } } });
assert.equal(closed, true);
assert.equal(navigated[0], `https://graceful-gifts-manila.web.app/admin/chat?conversation=${id}`);
assert.equal(focused.length, 1);
assert.equal(opened.length, 0);
console.log('Push worker QA passed: hidden notification, visible-tab suppression, link validation, and click focus.');
