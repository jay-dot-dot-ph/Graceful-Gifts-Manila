import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, collection, query, where, orderBy, limit, startAfter, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, updateDoc, setDoc } from 'firebase/firestore';

let services;
export async function firebase() {
  if (services) return services;
  let config;
  try {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (response.ok) config = await response.json();
  } catch {}
  if (!config?.apiKey || !config?.projectId || !config?.appId) {
    const response = await fetch('/firebase-config.json', { cache: 'no-store' });
    if (response.ok) config = await response.json();
  }
  if (!config?.apiKey || !config?.projectId || !config?.appId) throw new Error('Chat is awaiting Firebase web app configuration.');
  const app = getApps()[0] || initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (config.emulator === true && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  await setPersistence(auth, browserLocalPersistence);
  services = { auth, db };
  return services;
}

export async function customerSession() {
  const services = await firebase();
  if (!services.auth.currentUser) await services.auth.authStateReady();
  if (!services.auth.currentUser) await signInAnonymously(services.auth);
  if (!services.auth.currentUser.isAnonymous) throw new Error('A staff session is active. Sign out of the dashboard before opening customer chat.');
  return { ...services, user: services.auth.currentUser };
}

export { signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, collection, query, where, orderBy, limit, startAfter, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, updateDoc, setDoc };

export function displayError(error) {
  const code = error?.code || '';
  if (code === 'permission-denied') return 'Access denied. Please refresh or ask the owner to check your access.';
  if (code === 'auth/invalid-credential') return 'Email or password is incorrect.';
  if (code === 'auth/too-many-requests') return 'Too many sign-in attempts. Please try later.';
  if (code === 'unavailable') return 'Connection lost. Please try again.';
  return error?.message || 'Something went wrong. Please try again.';
}

export const messageText = (value) => String(value || '').trim().slice(0, 2000);
export const safeProduct = (watch) => ({
  id: String(watch.id || '').slice(0, 20),
  name: String(watch.name || '').slice(0, 120),
  brand: String(watch.brand || '').slice(0, 80),
  price: watch.price == null ? null : Number(watch.price),
  image: String(watch.image || '').slice(0, 300),
  url: String(watch.url || '').slice(0, 300),
  ...(typeof watch.size === 'string' && watch.size.trim() ? { size: watch.size.trim().slice(0, 40) } : {})
});

export function newMessageId(db, conversationId) { return doc(collection(db, 'conversations', conversationId, 'messages')).id; }

export async function sendMessage(db, conversationId, uid, role, text, products = [], identity = {}, messageId = newMessageId(db, conversationId)) {
  const body = messageText(text);
  if (!body) throw new Error('Write a message first.');
  const conversation = doc(db, 'conversations', conversationId);
  if (!/^[A-Za-z0-9]{20}$/.test(messageId)) throw new Error('Invalid message ID.');
  const message = doc(collection(conversation, 'messages'), messageId);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(conversation);
    if (snapshot.exists()) {
      const previous = await tx.get(message);
      if (previous.exists()) {
        if (previous.data().senderUid !== uid || previous.data().message !== body) throw new Error('Message ID already used.');
        return;
      }
    }
    const now = serverTimestamp();
    const base = {
      lastMessage: body, lastMessageAt: now, lastMessageId: message.id,
      lastSenderUid: uid, lastSenderRole: role, updatedAt: now
    };
    if (!snapshot.exists()) {
      if (role !== 'customer' || conversationId !== uid) throw new Error('Conversation unavailable.');
      tx.set(conversation, {
        customerUid: uid, customerName: String(identity.name || '').trim().slice(0, 80), customerContact: String(identity.contact || '').trim().slice(0, 120), assignedStaffUid: null,
        status: 'new', createdAt: now, customerReadAt: now, staffReadAt: null,
        productReferences: products.slice(0, 8).map(safeProduct), ...base
      });
    } else {
      const data = snapshot.data();
      if (role === 'customer' && data.customerUid !== uid) throw new Error('Conversation unavailable.');
      const merged = products.length ? [...data.productReferences, ...products.map(safeProduct)] : data.productReferences;
      const unique = [...new Map(merged.map((product) => [product.id, product])).values()].slice(0, 8);
      tx.update(conversation, {
        ...base,
        ...(role === 'customer' ? { productReferences: unique, customerReadAt: now } : { staffReadAt: now })
      });
    }
    tx.set(message, { senderUid: uid, senderRole: role, message: body, createdAt: now, productReferences: products.slice(0, 8).map(safeProduct) });
  });
  return message.id;
}
