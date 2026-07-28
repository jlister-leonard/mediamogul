/**
 * Nightstand service worker — keeps the app shell available offline.
 *
 * Strategy: network-first for navigations (cache each visited route, fall
 * back to the cached route or the shell), cache-first for Next's immutable
 * hashed static assets. Everything else goes straight to the network.
 */

const CACHE = "nightstand-shell-v1";
const SHELL = "/";

/** Precache the shell HTML and every hashed static asset it references,
 *  so an offline reload renders styled and hydrated — not bare HTML. */
async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch(SHELL);
  if (!response.ok) throw new Error(`shell precache failed: ${response.status}`);
  const html = await response.clone().text();
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s>\\]+/g) ?? [])];
  await cache.put(SHELL, response);
  await cache.addAll(assets);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Only reap our own versioned caches; other beads own their own.
            .filter((key) => key.startsWith("nightstand-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Cache clean route URLs only — query-string variants (share echoes,
    // future filters) would grow the cache unboundedly and replay stale.
    if (response.ok && new URL(request.url).search === "") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) ?? (await cache.match(SHELL));
    if (!cached) throw error;
    // Marker header so the offline e2e test can prove the cache path ran.
    const headers = new Headers(cached.headers);
    headers.set("X-Nightstand-Shell", "cache");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
}

async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStaticAsset(request));
  }
});
