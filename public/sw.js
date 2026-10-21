const CACHE = "swathline-shell-v4";
const SHELL = ["/", "/privacy", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isShellPath(pathname) {
  return pathname === "/" || pathname === "/privacy" || pathname === "/manifest.webmanifest" || pathname.startsWith("/icons/") || pathname.startsWith("/brand/");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  // Storm, radar, and history responses stay on the network. They are not stored here,
  // so an offline phone never shows hail without an Updated time.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/data/")) return;
  if (event.request.mode === "navigate" && !isShellPath(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  if (!isShellPath(url.pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});

function readPush(event) {
  const fallback = {
    title: "Swathline",
    body: "Hail alert",
    url: "/",
    tag: "",
  };
  if (!event.data) return fallback;
  try {
    const payload = event.data.json();
    return {
      title: typeof payload.title === "string" && payload.title ? payload.title : fallback.title,
      body: typeof payload.body === "string" ? payload.body : fallback.body,
      url: typeof payload.url === "string" && payload.url ? payload.url : "/",
      tag: typeof payload.tag === "string" ? payload.tag : "",
    };
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event) => {
  const payload = readPush(event);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: payload.tag || undefined,
        data: { url: payload.url },
      });
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: "hailmap-push", payload });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((item) => item.url.startsWith(self.location.origin));
      if (client && "navigate" in client) {
        try {
          const next = await client.navigate(target);
          if (next && "focus" in next) return next.focus();
        } catch {
          /* Open or focus below. */
        }
      }
      if (client && "focus" in client) {
        client.postMessage({ type: "hailmap-open", url: target });
        return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
