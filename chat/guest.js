// A stable visual reference derived from the conversation ID, without exposing it.
const colors = ['#234f70', '#693e77', '#805123', '#2e6657', '#6d3f53', '#4c5d22', '#704b37', '#345f7d'];

export function guestIdentity(conversationId, suppliedName = '') {
  const id = String(conversationId || 'guest');
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const code = (hash >>> 0).toString(36).toUpperCase().padStart(7, '0');
  const reference = `Guest #${code}`;
  return {
    label: String(suppliedName || '').trim() || reference,
    reference,
    mark: code.slice(0, 2),
    color: colors[(hash >>> 0) % colors.length],
    shape: (hash >>> 4) % 4
  };
}
