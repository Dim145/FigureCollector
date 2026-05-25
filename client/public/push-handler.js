// Web Push handler — injected into the workbox-generated service worker
// via the `importScripts` config in vite.config.js.
//
// Handles two events:
//   - `push` : decrypt + display a system notification when the backend
//              dispatches a web-push delivery.
//   - `notificationclick` : focus an existing tab or open one at the
//              deep-link the payload provides.
//
// Payload shape (matches the server-side renderer in
// `notify_channel::send_browser_push`):
//   { event_type, title, body, payload: { figure_id?, code?, ... } }

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "FigureCollector", body: event.data?.text() ?? "" };
  }

  const title = data.title || "FigureCollector";
  const body = data.body || "";
  const payload = data.payload || {};
  const eventType = data.event_type || "";

  // Resolve a deep link based on the event_type — same mapping as the
  // bell popover. The clicked notification will land the user on the
  // right page.
  let url = "/notifications";
  if (eventType === "achievement_unlocked") {
    url = "/achievements";
  } else if (
    eventType === "preorder_release_today" ||
    eventType === "preorder_release_j7"
  ) {
    url = payload.figure_id
      ? `/figures/${payload.figure_id}`
      : "/preorders";
  }

  const opts = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: eventType || "fc-notification",
    renotify: true,
    data: { url, event_type: eventType, payload },
  };

  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/notifications";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        // If we already have a tab open, focus + navigate it. The
        // previous version returned synchronously without awaiting the
        // focus/navigate promises, so cross-origin clients could
        // short-circuit before `openWindow` ever ran — the click looked
        // dead. Await each candidate and only fall through to
        // openWindow if none of them accept focus.
        for (const client of clients) {
          try {
            if (typeof client.focus === "function") {
              await client.focus();
              if (typeof client.navigate === "function") {
                await client.navigate(targetUrl);
              }
              return; // success — bail out of the loop AND skip openWindow
            }
          } catch {
            /* cross-origin focus may fail — try the next client */
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
