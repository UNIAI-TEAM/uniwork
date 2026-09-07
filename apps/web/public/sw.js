/* global self, URL */
// Web Push service worker (F-07 §4.3). Two events and nothing else: no
// offline cache, no fetch interception. The payload is what the server
// encrypted: {title, url, tag}; the tag lets the browser replace an earlier
// banner from the same notification group instead of stacking them.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "UniWork" };
  }
  const title = data.title || "UniWork";
  event.waitUntil(
    self.registration.showNotification(title, {
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      renotify: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const target = new URL(url, self.location.origin).href;
      for (const client of clients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of clients) {
        if ("navigate" in client && "focus" in client) return client.navigate(target).then((c) => c && c.focus());
      }
      return self.clients.openWindow(target);
    }),
  );
});
