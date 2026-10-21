import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from './firebase.js';

const storageKey = (uid) => `ggm-push-token-${uid}`;

async function tokenId(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function config() {
  const response = await fetch('/push-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Background notifications are not configured.');
  const { vapidKey } = await response.json();
  if (!/^[A-Za-z0-9_-]{60,160}$/.test(vapidKey || '')) throw new Error('Background notifications need a Web Push public key.');
  return vapidKey;
}

export async function pushAvailable() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !await isSupported()) return false;
  try { await config(); return true; } catch { return false; }
}

async function register(services) {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !await isSupported()) throw new Error('This browser does not support web push notifications.');
  const vapidKey = await config();
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  const messaging = getMessaging(services.app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('The browser did not provide a push token.');
  const id = await tokenId(token);
  const key = storageKey(services.auth.currentUser.uid);
  const previous = localStorage.getItem(key);
  const ref = doc(services.db, 'staff', services.auth.currentUser.uid, 'pushTokens', id);
  if (!(await getDoc(ref)).exists()) await setDoc(ref, { token, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  if (previous && previous !== id) await deleteDoc(doc(services.db, 'staff', services.auth.currentUser.uid, 'pushTokens', previous)).catch(() => {});
  localStorage.setItem(key, id);
  // Firestore drives visible inbox alerts; the worker suppresses notifications for visible tabs.
  return true;
}

export async function enablePush(services) {
  if (!('Notification' in window)) throw new Error('This browser does not support notifications.');
  if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Allow this site in browser settings.');
  await config(); // Check setup before showing the browser permission prompt.
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted.');
  return register(services);
}

export async function refreshPush(services) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    if (services.auth.currentUser && pushEnabled(services.auth.currentUser.uid)) await revokePush(services).catch(() => {});
    return false;
  }
  try { return await register(services); } catch { return false; }
}

export async function revokePush(services) {
  const uid = services.auth.currentUser?.uid;
  if (!uid) return;
  const id = localStorage.getItem(storageKey(uid));
  if (!id) return;
  const results = await Promise.allSettled([
    deleteDoc(doc(services.db, 'staff', uid, 'pushTokens', id)),
    isSupported().then((supported) => supported ? deleteToken(getMessaging(services.app)) : false)
  ]);
  if (results.every((result) => result.status === 'rejected')) throw results[0].reason;
  localStorage.removeItem(storageKey(uid));
}

export function pushEnabled(uid) { try { return !!localStorage.getItem(storageKey(uid)); } catch { return false; } }
