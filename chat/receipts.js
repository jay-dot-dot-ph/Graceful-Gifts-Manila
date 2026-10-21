import { collection, doc, query, orderBy, limit, onSnapshot, runTransaction, serverTimestamp, getDoc } from 'firebase/firestore';

const inFlight = new Set();
const committed = new Set();
export function receiptRef(db, conversationId, messageId) { return doc(db, 'conversations', conversationId, 'receipts', messageId); }
export function subscribeReceipts(db, conversationId, next, error) {
  return onSnapshot(query(collection(db, 'conversations', conversationId, 'receipts'), orderBy('deliveredAt', 'desc'), limit(100)),
    (snapshot) => next(new Map(snapshot.docs.map((item) => [item.id, item.data()]))), error);
}
export async function olderReceipts(db, conversationId, messages) {
  const found = await Promise.all(messages.map(async (message) => {
    const snapshot = await getDoc(receiptRef(db, conversationId, message.id));
    return snapshot.exists() ? [message.id, snapshot.data()] : null;
  }));
  return new Map(found.filter(Boolean));
}
export async function acknowledge(db, conversationId, message, uid, seen = false) {
  if (!message?.id || !/^[A-Za-z0-9]{20}$/.test(message.id) || message.senderUid === uid) return false;
  const key = `${conversationId}/${message.id}/${uid}/${seen ? 'seen' : 'delivered'}`;
  if (inFlight.has(key) || committed.has(key)) return false;
  inFlight.add(key);
  try {
    await runTransaction(db, async (tx) => {
      const ref = receiptRef(db, conversationId, message.id);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) tx.set(ref, { recipientUid: uid, deliveredAt: serverTimestamp(), ...(seen ? { seenAt: serverTimestamp(), seenByUid: uid } : {}) });
      else if (seen && !snapshot.data().seenAt) tx.update(ref, { seenAt: serverTimestamp(), seenByUid: uid });
    });
    committed.add(key);
    return true;
  } catch (error) {
    console.warn('Chat acknowledgment failed:', error?.code || error?.message || 'unknown error');
    throw error;
  } finally { inFlight.delete(key); }
}
export function status(message, receipt) {
  if (message.failed) return 'Failed';
  if (message.pending || message.metadata?.hasPendingWrites) return 'Sending';
  if (receipt?.seenAt) return 'Seen';
  if (receipt?.deliveredAt) return 'Delivered';
  return 'Sent';
}
export function bubbleVisible(bubble, body) {
  if (!bubble || !body || document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  const style = getComputedStyle(body);
  if (style.display === 'none' || style.visibility === 'hidden' || !body.getClientRects().length) return false;
  const a = bubble.getBoundingClientRect(), b = body.getBoundingClientRect();
  return a.height > 0 && a.top < b.bottom - 8 && a.bottom > b.top + 8;
}
