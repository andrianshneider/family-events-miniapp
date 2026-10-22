// Only a generic offline document is cached. No API, user page, media or token is stored.
const CACHE = "family-events-offline-v1";
const OFFLINE = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(OFFLINE, { cache: "no-store" });
      if (!response.ok) throw Error("Offline document unavailable");
      await (await caches.open(CACHE)).put(OFFLINE, response);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("family-events-offline-") && name !== CACHE)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  // Authentication/API exchanges and writes always use the browser's ordinary network path.
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    fetch(request, { cache: "no-store" }).catch(async () => {
      const fallback = await (await caches.open(CACHE)).match(OFFLINE);
      return fallback || Response.error();
    }),
  );
});
