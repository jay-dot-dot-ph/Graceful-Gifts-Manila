import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';

const projectId = 'demo-graceful-gifts-manila';
const base = 'http://127.0.0.1:4173';
mkdirSync('.sites-runtime', { recursive: true });
const environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const errors = [];
async function authUser(email) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'TestPassword123!', returnSecureToken: true }) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result.localId;
}
async function login(page, email) {
  await page.goto(base + '/admin/chat');
  await page.locator('#admin-login-form').waitFor();
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill('TestPassword123!');
  await page.locator('#admin-login-form button').click();
  await page.locator('.admin-inbox').waitFor();
}
try {
  await environment.clearFirestore();
  const ownerEmail = `owner-${Date.now()}@example.com`;
  const ownerUid = await authUser(ownerEmail);
  const staffEmail = `staff-${Date.now()}@example.com`;
  const staffUid = await authUser(staffEmail);
  const adminEmail = `admin-${Date.now()}@example.com`;
  const adminUid = await authUser(adminEmail);
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'staff', ownerUid), { displayName: 'Store owner', email: ownerEmail, role: 'owner', active: true, createdAt: new Date(), createdBy: 'setup' });
  });
  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage(); customer.on('pageerror', (error) => errors.push(error.message));
  await customer.goto(base + '/watch/AP-001');
  await customer.locator('.inquiry-button').click();
  await customer.locator('.ggm-chat.is-open').waitFor();
  await customer.locator('.ggm-chat-products .chat-product').waitFor();
  assert.match(await customer.locator('.ggm-chat-products').innerText(), /AP-001/);
  assert.match(await customer.locator('.ggm-chat-products').innerText(), /42mm/);
  assert.match(await customer.locator('.ggm-chat-products').innerText(), /20 available/);
  assert.match(await customer.locator('.ggm-chat-products .chat-product img').getAttribute('src'), /^\/images\/AP-001-/);
  await customer.screenshot({ path: '.sites-runtime/chat-customer-desktop.png' });
  await customer.locator('.ggm-chat-products .chat-product img').evaluate((image) => { image.src = '/images/missing-watch.jpg'; });
  await customer.locator('.ggm-chat-products .chat-watch-photo span').waitFor();
  await customer.locator('.ggm-chat-identity [name=name]').fill('Test customer');
  await customer.locator('.ggm-chat-identity [name=contact]').fill('customer@example.com');
  await customer.locator('#ggm-chat-message').fill('Draft line');
  await customer.locator('#ggm-chat-message').press('Shift+Enter');
  assert.equal(await customer.locator('#ggm-chat-message').inputValue(), 'Draft line\n', 'Shift+Enter adds a newline');
  await customer.locator('#ggm-chat-message').fill('Is AP-001 available?');
  await customer.locator('#ggm-chat-message').press('Enter');
  await customer.locator('#ggm-chat-body').getByText('Is AP-001 available?').waitFor();
  await customer.locator('.ggm-chat-form button:not([disabled])').waitFor();
  let persisted = false;
  for (let attempt = 0; attempt < 30 && !persisted; attempt++) {
    await environment.withSecurityRulesDisabled(async (context) => { persisted = (await getDocs(collection(context.firestore(), 'conversations'))).docs.some((item) => item.data().customerName === 'Test customer' && item.data().lastMessage === 'Is AP-001 available?'); });
    if (!persisted) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(persisted, true, 'The first inquiry must be committed before refresh');
  await customer.reload();
  await customer.locator('[data-open-chat]').click();
  await customer.locator('#ggm-chat-body').getByText('Is AP-001 available?').waitFor();
  await customer.setViewportSize({ width: 390, height: 844 });
  const mobileChat = await customer.locator('.ggm-chat.is-open').boundingBox();
  assert.ok(mobileChat.width <= 390 && mobileChat.x >= 0 && mobileChat.y >= 0, 'Chat fits the mobile viewport');
  await customer.screenshot({ path: '.sites-runtime/chat-customer-mobile.png' });
  await customer.evaluate(() => localStorage.setItem('ggm-favorites', JSON.stringify(['AP-001', 'AP-002'])));
  await customer.goto(base + '/favorites');
  await customer.locator('[data-select-all]').click();
  await customer.locator('[data-inquire-selected]').click();
  await customer.locator('.ggm-chat-products .chat-product').first().waitFor();
  assert.equal(await customer.locator('.ggm-chat-products .chat-product').count(), 2);
  await customer.waitForTimeout(3100);
  await customer.locator('#ggm-chat-message').fill('Are these favorites available?');
  await customer.locator('.ggm-chat-form button').click();
  await customer.locator('#ggm-chat-body').getByText('Are these favorites available?').waitFor();
  await customer.waitForFunction(() => [...document.querySelectorAll('.ggm-chat-bubble.outgoing .chat-receipt')].at(-1)?.textContent.trim() === 'Sent');

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage(); owner.on('pageerror', (error) => errors.push(error.message));
  await login(owner, ownerEmail);
  await owner.getByText('Test customer').first().waitFor();
  await owner.getByText('Are these favorites available?').first().waitFor();
  await customer.waitForFunction(() => [...document.querySelectorAll('.ggm-chat-bubble.outgoing .chat-receipt')].at(-1)?.textContent.trim() === 'Delivered');
  await environment.withSecurityRulesDisabled(async (context) => {
    const conversation = (await getDocs(collection(context.firestore(), 'conversations'))).docs[0];
    const messages = (await getDocs(collection(context.firestore(), 'conversations', conversation.id, 'messages'))).docs;
    const latest = messages.find((item) => item.data().message === 'Are these favorites available?').data();
    assert.ok(latest.deliveredAt && !latest.seenAt, 'Inbox preview can deliver but cannot mark Seen');
  });
  await owner.locator('.admin-inbox-row').first().click();
  await customer.waitForFunction(() => [...document.querySelectorAll('.ggm-chat-bubble.outgoing .chat-receipt')].at(-1)?.textContent.trim() === 'Seen');
  await owner.screenshot({ path: '.sites-runtime/chat-admin-desktop.png' });
  await owner.setViewportSize({ width: 390, height: 844 });
  const mobileInbox = await owner.locator('.admin-thread').boundingBox();
  assert.ok(mobileInbox && mobileInbox.width <= 390 && mobileInbox.x >= 0, 'Admin thread fits a mobile screen');
  await owner.screenshot({ path: '.sites-runtime/chat-admin-mobile.png' });
  await owner.locator('.admin-back').click();
  await owner.locator('.admin-inbox-row').first().waitFor();
  await owner.locator('.admin-inbox-row').first().click();
  await owner.setViewportSize({ width: 1280, height: 720 });
  await owner.locator('#admin-message').fill('Yes, AP-001 is available.');
  await owner.locator('#admin-reply button').click();
  try { await owner.locator('#admin-thread-body').getByText('Yes, AP-001 is available.').waitFor({ timeout: 5000 }); }
  catch (error) { let saved = []; await environment.withSecurityRulesDisabled(async (context) => { const conversation = (await getDocs(collection(context.firestore(), 'conversations'))).docs[0]; if (conversation) saved = (await getDocs(collection(context.firestore(), 'conversations', conversation.id, 'messages'))).docs.map((item) => item.data().message); }); console.error('Owner reply diagnosis:', await owner.locator('.admin-thread').innerText(), await owner.locator('.admin-toast').allInnerTexts(), 'draft:', await owner.locator('#admin-message').inputValue(), 'disabled:', await owner.locator('#admin-reply button').isDisabled(), 'saved:', saved); throw error; }
  await customer.locator('#ggm-chat-body').getByText('Yes, AP-001 is available.').waitFor();
  await owner.waitForFunction(() => [...document.querySelectorAll('.admin-message.staff .chat-receipt')].at(-1)?.textContent.trim() === 'Seen');
  await customer.locator('[data-chat-close]').click();
  await customer.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await owner.locator('#admin-message').fill('We can also show similar watches.');
  await owner.locator('#admin-reply button').click();
  await owner.locator('#admin-thread-body').getByText('We can also show similar watches.').waitFor();
  await owner.waitForFunction(() => [...document.querySelectorAll('.admin-message.staff .chat-receipt')].at(-1)?.textContent.trim() === 'Sent');
  await customer.reload();
  await customer.locator('[data-chat-badge]:not([hidden])').waitFor();
  await customer.locator('[data-open-chat]').click();
  await customer.locator('#ggm-chat-body').getByText('We can also show similar watches.').waitFor();
  await customer.waitForFunction(() => document.querySelector('[data-chat-badge]')?.hidden === true);
  await owner.goto(base + '/admin/staff');
  await owner.locator('#staff-form').waitFor();
  await owner.locator('#staff-sound').check();
  await owner.locator('#staff-form input[name=uid]').fill(staffUid);
  await owner.locator('#staff-form input[name=name]').fill('Sales staff');
  await owner.locator('#staff-form input[name=email]').fill(staffEmail);
  await owner.locator('#staff-form button').click();
  try { await owner.getByText('Sales staff').first().waitFor({ timeout: 5000 }); }
  catch (error) { console.error('Staff creation diagnosis:', await owner.locator('.admin-staff-page').innerText(), await owner.locator('#staff-form input[name=uid]').inputValue(), await owner.locator('#staff-form button').isDisabled()); throw error; }
  await owner.locator('#staff-form input[name=uid]').fill(adminUid);
  await owner.locator('#staff-form input[name=name]').fill('Operations admin');
  await owner.locator('#staff-form input[name=email]').fill(adminEmail);
  await owner.locator('#staff-form select[name=role]').selectOption('admin');
  await owner.locator('#staff-form button').click();
  await owner.getByText('Operations admin').first().waitFor();
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage(); admin.on('pageerror', (error) => errors.push(error.message));
  await login(admin, adminEmail);
  await admin.locator('.admin-inbox-row').first().click();
  await admin.locator('#admin-status').selectOption('pending');
  await admin.waitForFunction(() => document.querySelector('#admin-status')?.value === 'pending');
  await admin.goto(base + '/admin/staff');
  await admin.locator('.admin-inbox').waitFor();
  assert.equal(await admin.locator('#staff-form').count(), 0);
  await owner.goto(base + '/admin/chat');
  await owner.locator('.admin-inbox-row').first().click();
  await owner.locator('#admin-assignee').selectOption(staffUid);
  await owner.waitForFunction((uid) => document.querySelector('#admin-assignee')?.value === uid, staffUid);
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage(); staff.on('pageerror', (error) => errors.push(error.message));
  await login(staff, staffEmail);
  await staff.locator('.admin-inbox-row').first().click();
  assert.equal(await staff.locator('#admin-assignee').count(), 0);
  await staff.locator('#admin-message').fill('I can help with this watch.');
  await staff.locator('#admin-reply button').click();
  try { await customer.locator('#ggm-chat-body').getByText('I can help with this watch.').waitFor({ timeout: 5000 }); }
  catch (error) { console.error('Staff reply diagnosis:', await staff.locator('.admin-thread').innerText(), await staff.locator('.admin-toast').allInnerTexts()); throw error; }
  await staff.waitForFunction(() => [...document.querySelectorAll('.admin-message.staff .chat-receipt')].at(-1)?.textContent.trim() === 'Seen');
  await owner.goto(base + '/admin/staff');
  await owner.locator(`[data-toggle-staff="${staffUid}"]`).click();
  await owner.waitForFunction((uid) => document.querySelector(`[data-toggle-staff="${uid}"]`)?.textContent === 'Enable', staffUid);
  await staff.reload();
  await staff.getByText(/no active staff access|Access denied/i).waitFor();
  await customerContext.setOffline(true);
  await customer.locator('#ggm-chat-message').fill('Offline retry check');
  await customer.locator('.ggm-chat-form button').click();
  await customer.locator('.ggm-chat-bubble.outgoing').last().locator('.chat-receipt').getByText(/Failed/).waitFor({ timeout: 10000 });
  await customerContext.setOffline(false);
  await customer.locator('.ggm-chat-bubble.outgoing').last().locator('[data-retry]').click();
  await customer.waitForFunction(() => [...document.querySelectorAll('.ggm-chat-bubble.outgoing .chat-receipt')].at(-1)?.textContent.trim() === 'Sent');
  assert.deepEqual(errors, []);
  console.log('Chat browser QA passed: product cards, Sent/Delivered/Seen receipts, background tab, retry, mobile chat/inbox, history, staff roles, assignment, and revocation.');
} finally { await browser.close(); await environment.cleanup(); }
