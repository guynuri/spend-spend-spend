/* Web Push handlers, pulled into the generated service worker via workbox importScripts (vite.config.ts). */
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    /* not JSON */
  }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Maazan', {
      body: d.body || '',
      tag: d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // in-app paths only
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        if ('navigate' in win) return win.navigate(url);
        return;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
