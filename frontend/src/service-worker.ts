/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `cache-${version}`;
// App-shell assets to precache (built JS/CSS + static files).
const ASSETS = [...build, ...files];

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only serve same-origin built assets from cache; never touch the API/auth
  // (different origin) or dynamic navigations.
  if (url.origin !== location.origin) return;
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached ?? fetch(req))
    );
  }
});
