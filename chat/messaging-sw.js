// FCM uses this registration to receive data-only Web Push messages.
// A trusted sender must supply data.kind, conversationId, and messageId.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json()?.data || {}; } catch { return; }
    if (data.kind !== 'customer-message' || !/^[A-Za-z0-9_-]{20,128}$/.test(data.conversationId || '') || !/^[A-Za-z0-9]{20}$/.test(data.messageId || '')) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((client) => { const url = new URL(client.url); return url.origin === self.location.origin && url.pathname.startsWith('/admin/') && client.visibilityState === 'visible'; })) return;
    const label = String(data.senderLabel || 'Customer').slice(0, 80);
    const body = data.previewAllowed === 'true' ? String(data.preview || 'New customer message').slice(0, 120) : 'New customer message';
    await self.registration.showNotification(`Graceful Gifts Manila · ${label}`, {
      body, icon: '/favicon.svg', badge: '/favicon.svg',
      tag: `chat-${data.conversationId}-${data.messageId}`,
      renotify: false,
      data: { url: `/admin/chat?conversation=${encodeURIComponent(data.conversationId)}` }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data?.url;
  event.notification.close();
  if (!url || !url.startsWith('/admin/chat?conversation=')) return;
  event.waitUntil((async () => {
    const destination = new URL(url, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/admin/chat');
    if (existing) { await existing.navigate(destination); await existing.focus(); }
    else await self.clients.openWindow(destination);
  })());
});
