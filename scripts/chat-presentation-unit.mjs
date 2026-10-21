import assert from 'node:assert/strict';
import { watchCard, receiptLabel } from '../chat/presentation.js';
import { safeProduct } from '../chat/firebase.js';

const watch = safeProduct({ id: 'AP-001', name: 'Royal Oak', brand: 'Audemars Piguet', price: 5950, image: '/images/AP-001-test.jpg', url: 'https://graceful-gifts-manila.web.app/watch/AP-001', size: '42mm', stock: 2 });
const card = watchCard(watch);
for (const part of ['AP-001', 'Royal Oak', '42mm', '2 available', '₱5,950', '/images/AP-001-test.jpg', '/watch/AP-001']) assert.ok(card.includes(part), part);
const missingSize = safeProduct({ id: 'CAR-001', name: 'Ballon Bleu-style', brand: 'Cartier', price: 9500, image: '/images/CAR-001-test.jpg', url: 'https://graceful-gifts-manila.web.app/watch/CAR-001', size: '', stock: 0 });
assert.equal(Object.hasOwn(missingSize, 'size'), false, 'Missing size stays absent');
assert.match(watchCard(missingSize), /Sold out/);
assert.doesNotMatch(watchCard(missingSize), /mm/);
assert.doesNotMatch(watchCard({ ...watch, id: 'AP-002', image: 'javascript:alert(1)' }), /javascript:/);
assert.equal(watchCard({ ...watch, id: '<script>' }), '', 'Malformed IDs are not linked');
assert.equal(receiptLabel({ pending: true }), 'Sending…');
assert.equal(receiptLabel({}), 'Sent');
assert.equal(receiptLabel({ deliveredAt: {} }), 'Delivered');
assert.equal(receiptLabel({ deliveredAt: {}, seenAt: {} }), 'Seen');
assert.equal(receiptLabel({ failed: true }), 'Failed · Retry');
console.log('Chat presentation unit checks passed: receipt precedence, safe watch cards, optional size and stock.');
