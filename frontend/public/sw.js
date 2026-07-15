/**
 * Founder Calendar service worker - web push only.
 *
 * Deliberately a plain file in public/ rather than something the bundler
 * touches: nitro copies public/ through verbatim, so this lands at /sw.js with
 * scope "/" and needs no build step, no plugin, and no cache-busting hash (a
 * hashed service worker URL would orphan the previous registration).
 *
 * It does NOT cache anything or intercept fetches - the app is not offline-
 * capable, and a service worker that quietly serves stale assets is a far worse
 * bug than no push.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    // A push we can't parse is still a push; show something rather than nothing.
    payload = { title: "Founder Calendar", body: event.data.text() };
  }

  const title = payload.title || "Founder Calendar";
  const options = {
    body: payload.body || "You have a new notification",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    // Collapse repeats: a second push replaces the first rather than stacking.
    tag: "founder-calendar",
    renotify: true,
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  if (!target) return;

  event.waitUntil(
    // Reuse an open tab if there is one - a click shouldn't pile up windows.
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if ("focus" in tab) {
          if ("navigate" in tab) tab.navigate(target).catch(() => {});
          return tab.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// Take over immediately on update rather than waiting for every tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
