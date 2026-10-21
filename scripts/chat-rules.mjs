import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs, runTransaction, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { sendMessage } from '../chat/firebase.js';

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
  await assertSucceeds(sendMessage(customer, 'customer-uid', 'customer-uid', 'customer', 'Is this watch available?', [{ id: 'AP-001', name: 'Royal Oak', brand: 'Audemars Piguet', price: 5950, image: '/images/AP-001-test.jpg', url: 'https://graceful-gifts-manila.web.app/watch/AP-001' }], { name: 'Test customer', contact: 'customer@example.com' }));
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
  await assertSucceeds(sendMessage(staff, 'customer-uid', 'staff-uid', 'staff', 'It is available.'));
  assert.equal((await assertSucceeds(getDoc(doc(customer, 'conversations', 'customer-uid')))).data().lastMessage, 'It is available.');
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'conversations', 'customer-uid'), { productReferences: [{ id: 'AP-001', name: 'Royal Oak', brand: 'Audemars Piguet', price: 5950, image: '/images/AP-001-test.jpg', url: 'https://graceful-gifts-manila.web.app/watch/AP-001', size: '42mm', stock: 20 }] });
  });
  await new Promise((resolve) => setTimeout(resolve, 3100));
  await assertSucceeds(sendMessage(customer, 'customer-uid', 'customer-uid', 'customer', 'Can I ask about this watch again?'));
  await assertSucceeds(updateDoc(doc(owner, 'staff', 'staff-uid'), { active: false }));
  await assertFails(sendMessage(staff, 'customer-uid', 'staff-uid', 'staff', 'I should be disabled.'));
  await assertFails(updateDoc(doc(owner, 'staff', 'owner-uid'), { active: false }));
  await assertFails(updateDoc(doc(admin, 'staff', 'other-staff-uid'), { role: 'admin' }));
  await assertSucceeds(setDoc(doc(owner, 'settings', 'chat'), { staffSoundEnabled: true, updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(admin, 'settings', 'chat')));
  await assertFails(updateDoc(doc(staff, 'settings', 'chat'), { staffSoundEnabled: false }));
  console.log('Firestore rules passed: customer isolation, inquiry, assignment, staff scope, role protection, rate limit, and revocation.');
} finally { await environment.cleanup(); }
