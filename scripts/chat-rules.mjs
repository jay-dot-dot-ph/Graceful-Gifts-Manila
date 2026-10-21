import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs, runTransaction, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { sendMessage, acknowledgeMessage } from '../chat/firebase.js';

const projectId = 'demo-graceful-gifts-manila';
const environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
const as = (uid, provider = 'password') => environment.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
const owner = as('owner-uid'), admin = as('admin-uid'), staff = as('staff-uid'), otherStaff = as('other-staff-uid');
const customer = as('customer-uid', 'anonymous'), otherCustomer = as('other-customer-uid', 'anonymous');
try {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    for (const [uid, role] of [['owner-uid','owner'], ['admin-uid','admin'], ['staff-uid','staff'], ['other-staff-uid','staff']]) {
      await setDoc(doc(context.firestore(), 'staff', uid), { displayName: uid, email: `${uid}@example.com`, role, active: true, createdAt: new Date(), createdBy: 'setup' });
    }
  });
  const firstId = await assertSucceeds(sendMessage(customer, 'customer-uid', 'customer-uid', 'customer', 'Is this watch available?', [{ id: 'AP-001', name: 'Royal Oak', brand: 'Audemars Piguet', price: 5950, image: '/images/AP-001-test.jpg', url: 'https://graceful-gifts-manila.web.app/watch/AP-001', size: '41mm', stock: 2 }], { name: 'Test customer', contact: 'customer@example.com' }));
  assert.equal((await assertSucceeds(getDoc(doc(customer, 'conversations', 'customer-uid')))).data().status, 'new');
  assert.equal((await getDoc(doc(customer, 'conversations', 'customer-uid'))).data().customerName, 'Test customer');
  await assertFails(getDoc(doc(otherCustomer, 'conversations', 'customer-uid')));
  await assertFails(getDoc(doc(staff, 'conversations', 'customer-uid')));
  await assertSucceeds(getDoc(doc(admin, 'conversations', 'customer-uid')));
  await assertFails(updateDoc(doc(customer, 'conversations', 'customer-uid'), { status: 'resolved' }));
  await assertFails(setDoc(doc(customer, 'staff', 'customer-uid'), { role: 'owner', active: true }));
  await assertFails(sendMessage(customer, 'customer-uid', 'customer-uid', 'customer', 'Second message too fast'));
  const conversation = doc(admin, 'conversations', 'customer-uid');
  const audit = doc(collection(admin, 'auditLogs'));
  await assertSucceeds(runTransaction(admin, async (tx) => {
    const previous = await tx.get(conversation);
    tx.update(conversation, { assignedStaffUid: 'staff-uid', updatedAt: serverTimestamp(), lastAuditId: audit.id });
    tx.set(audit, { action: 'assignment', conversationId: 'customer-uid', actorUid: 'admin-uid', oldValue: previous.data().assignedStaffUid, newValue: 'staff-uid', createdAt: serverTimestamp() });
  }));
  await assertSucceeds(getDoc(doc(staff, 'conversations', 'customer-uid')));
  await assertFails(getDoc(doc(otherStaff, 'conversations', 'customer-uid')));
  await assertSucceeds(getDocs(query(collection(staff, 'conversations'), where('assignedStaffUid', '==', 'staff-uid'), orderBy('lastMessageAt', 'desc'), limit(50))));
  await assertFails(getDocs(query(collection(staff, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(50))));
  await assertFails(updateDoc(doc(staff, 'conversations', 'customer-uid'), { assignedStaffUid: 'other-staff-uid' }));
  const firstMessage = doc(staff, 'conversations', 'customer-uid', 'messages', firstId);
  await assertFails(updateDoc(firstMessage, { deliveredAt: serverTimestamp(), deliveredByUid: 'staff-uid', seenByUid: 'other-staff-uid' }));
  await assertFails(updateDoc(doc(customer, 'conversations', 'customer-uid', 'messages', firstId), { deliveredAt: serverTimestamp(), deliveredByUid: 'customer-uid' }));
  await assertFails(updateDoc(doc(otherStaff, 'conversations', 'customer-uid', 'messages', firstId), { deliveredAt: serverTimestamp(), deliveredByUid: 'other-staff-uid' }));
  await assertFails(updateDoc(doc(staff, 'conversations', 'customer-uid'), { staffReadAt: serverTimestamp() }));
  await assertSucceeds(acknowledgeMessage(staff, 'customer-uid', firstId, 'staff-uid'));
  assert.ok((await getDoc(firstMessage)).data().deliveredAt, 'Delivery needs a recipient receipt');
  assert.equal((await getDoc(firstMessage)).data().seenAt, undefined, 'Inbox delivery must not mark Seen');
  await assertSucceeds(acknowledgeMessage(staff, 'customer-uid', firstId, 'staff-uid', true));
  assert.ok((await getDoc(firstMessage)).data().seenAt, 'Visible staff thread can mark Seen');
  assert.ok((await getDoc(doc(staff, 'conversations', 'customer-uid'))).data().staffReadAt, 'Seen advances the unread watermark');
  await assertFails(updateDoc(firstMessage, { seenAt: serverTimestamp(), seenByUid: 'staff-uid' }));
  assert.equal(await assertSucceeds(sendMessage(customer, 'customer-uid', 'customer-uid', 'customer', 'Is this watch available?', [], {}, firstId)), firstId, 'Retry must reuse committed message');
  const assigned = doc(staff, 'conversations', 'customer-uid');
  const statusAudit = doc(collection(staff, 'auditLogs'));
  await assertSucceeds(runTransaction(staff, async (tx) => {
    const previous = await tx.get(assigned);
    tx.update(assigned, { status: 'open', updatedAt: serverTimestamp(), lastAuditId: statusAudit.id });
    tx.set(statusAudit, { action: 'status', conversationId: 'customer-uid', actorUid: 'staff-uid', oldValue: previous.data().status, newValue: 'open', createdAt: serverTimestamp() });
  }));
  assert.equal((await assertSucceeds(getDoc(doc(owner, 'conversations', 'customer-uid')))).data().status, 'open');
  await assertFails(getDocs(query(collection(staff, 'auditLogs'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDocs(query(collection(owner, 'auditLogs'), orderBy('createdAt', 'desc'))));
  const replyId = await assertSucceeds(sendMessage(staff, 'customer-uid', 'staff-uid', 'staff', 'It is available.'));
  const replyMessage = doc(customer, 'conversations', 'customer-uid', 'messages', replyId);
  assert.equal((await getDoc(replyMessage)).data().deliveredAt, undefined, 'Offline customer must remain Sent');
  await assertFails(updateDoc(doc(staff, 'conversations', 'customer-uid', 'messages', replyId), { deliveredAt: serverTimestamp(), deliveredByUid: 'staff-uid' }));
  await assertSucceeds(acknowledgeMessage(customer, 'customer-uid', replyId, 'customer-uid'));
  assert.ok((await getDoc(replyMessage)).data().deliveredAt);
  assert.equal((await getDoc(replyMessage)).data().seenAt, undefined);
  await assertSucceeds(acknowledgeMessage(customer, 'customer-uid', replyId, 'customer-uid', true));
  assert.ok((await getDoc(replyMessage)).data().seenAt);
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const reassignedId = await assertSucceeds(sendMessage(customer, 'customer-uid', 'customer-uid', 'customer', 'A new question for the next staff member.'));
  assert.equal((await getDoc(doc(customer, 'conversations', 'customer-uid', 'messages', reassignedId))).data().deliveredAt, undefined);
  const reassignAudit = doc(collection(admin, 'auditLogs'));
  await assertSucceeds(runTransaction(admin, async (tx) => {
    const previous = await tx.get(conversation);
    tx.update(conversation, { assignedStaffUid: 'other-staff-uid', updatedAt: serverTimestamp(), lastAuditId: reassignAudit.id });
    tx.set(reassignAudit, { action: 'assignment', conversationId: 'customer-uid', actorUid: 'admin-uid', oldValue: previous.data().assignedStaffUid, newValue: 'other-staff-uid', createdAt: serverTimestamp() });
  }));
  await assertFails(getDoc(doc(staff, 'conversations', 'customer-uid')));
  await assertFails(updateDoc(doc(staff, 'conversations', 'customer-uid', 'messages', reassignedId), { deliveredAt: serverTimestamp(), deliveredByUid: 'staff-uid' }));
  await assertFails(updateDoc(doc(otherStaff, 'conversations', 'customer-uid', 'messages', reassignedId), { deliveredAt: serverTimestamp(), deliveredByUid: 'staff-uid' }));
  await assertSucceeds(acknowledgeMessage(otherStaff, 'customer-uid', reassignedId, 'other-staff-uid', true));
  assert.equal((await getDoc(doc(otherStaff, 'conversations', 'customer-uid', 'messages', reassignedId))).data().seenByUid, 'other-staff-uid');
  const assignBackAudit = doc(collection(admin, 'auditLogs'));
  await assertSucceeds(runTransaction(admin, async (tx) => {
    const previous = await tx.get(conversation);
    tx.update(conversation, { assignedStaffUid: 'staff-uid', updatedAt: serverTimestamp(), lastAuditId: assignBackAudit.id });
    tx.set(assignBackAudit, { action: 'assignment', conversationId: 'customer-uid', actorUid: 'admin-uid', oldValue: previous.data().assignedStaffUid, newValue: 'staff-uid', createdAt: serverTimestamp() });
  }));
  assert.equal((await assertSucceeds(getDoc(doc(customer, 'conversations', 'customer-uid')))).data().lastMessage, 'A new question for the next staff member.');
  await assertSucceeds(updateDoc(doc(owner, 'staff', 'staff-uid'), { active: false }));
  await assertFails(sendMessage(staff, 'customer-uid', 'staff-uid', 'staff', 'I should be disabled.'));
  await assertFails(updateDoc(doc(owner, 'staff', 'owner-uid'), { active: false }));
  await assertFails(updateDoc(doc(admin, 'staff', 'other-staff-uid'), { role: 'admin' }));
  await assertSucceeds(setDoc(doc(owner, 'settings', 'chat'), { staffSoundEnabled: true, updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(admin, 'settings', 'chat')));
  await assertFails(updateDoc(doc(staff, 'settings', 'chat'), { staffSoundEnabled: false }));
  console.log('Firestore rules passed: customer isolation, inquiry, assignment, staff scope, role protection, rate limit, and revocation.');
} finally { await environment.cleanup(); }
