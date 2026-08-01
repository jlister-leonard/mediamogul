/**
 * Nightstand service worker — the app shell stays usable without a network.
 *
 * Personal data is deliberately absent from this cache. Library reads and
 * writes use on-device IndexedDB; this worker owns only public application
 * files and honest failure responses for network-only APIs.
 */

const CACHE = "nightstand-shell-v3";
const clientNetworkStatus = new Map();

// These are the current user-facing routes. Pre-caching every one means a
// first online visit to any page installs the complete shell for airplane
// mode, rather than requiring the person to visit every screen in advance.
const APP_ROUTES = [
  "/",
  "/availability-demo",
  "/inbox",
  "/primitives",
  "/providers-demo",
  "/settings/backup",
  "/style",
];

const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

/** Cache each route plus the immutable Next assets referenced by its HTML. */
async function precacheApp() {
  const cache = await caches.open(CACHE);
  const routeResponses = await Promise.all(
    APP_ROUTES.map(async (route) => {
      const response = await fetch(route, { cache: "reload" });
      if (!response.ok) {
        throw new Error(`route precache failed for ${route}: ${response.status}`);
      }
      return [route, response];
    }),
  );

  const staticAssets = new Set();
  for (const [route, response] of routeResponses) {
    const html = await response.clone().text();
    for (const asset of html.match(/\/_next\/static\/[^"'\s>\\]+/g) ?? []) {
      const assetUrl = new URL(asset.replaceAll("&amp;", "&"), self.location.origin);
      // Query strings can become user- or deployment-specific. The immutable
      // asset pathname is sufficient and is the only form allowed in cache.
      if (assetUrl.search === "") staticAssets.add(assetUrl.pathname);
    }
    await cache.put(route, response);
  }

  await cache.addAll([...CORE_ASSETS, ...staticAssets]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheApp().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
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
    // Query strings may contain shared text or future search terms. Never
    // persist them; update only the clean route shell.
    if (response.ok && new URL(request.url).search === "") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const url = new URL(request.url);
    const cached =
      (await cache.match(request)) ??
      (await cache.match(url.pathname)) ??
      (await cache.match("/"));
    if (!cached) throw error;

    const headers = new Headers(cached.headers);
    headers.set("X-Nightstand-Shell", "cache");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
}

async function handleCacheableAsset(request) {
  // This is intentionally before cache.match *and* cache.put. A future
  // refactor cannot turn a query-bearing manifest/icon/static request into a
  // durable cache entry merely because the network response succeeded.
  if (new URL(request.url).search !== "") {
    return fetch(request, { cache: "no-store" });
  }

  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Provider resolution and recommendations require remote services. They are
 * never cached as if current; airplane mode receives a stable, renderable
 * error while the on-device library remains untouched and usable.
 */
async function handleNetworkOnlyApi(request, clientId) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;

    // Preserve upstream status, status text, body, and content type, but do
    // not let an HTTP failure enter any browser HTTP cache.
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    const offline =
      clientNetworkStatus.get(clientId) === false || self.navigator.onLine === false;
    const code = offline ? "offline" : "network_unavailable";
    const message = offline
      ? "This lookup needs a connection. Your on-device library is still available."
      : "The network request could not be completed. Your on-device library is still available.";
    return new Response(
      JSON.stringify({
        error: { code, message },
      }),
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "X-Nightstand-Network": code,
        },
      },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(handleNetworkOnlyApi(request, event.clientId));
    return;
  }
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || CORE_ASSETS.includes(url.pathname))
  ) {
    event.respondWith(handleCacheableAsset(request));
  }
});

self.addEventListener("message", (event) => {
  if (
    event.data?.type === "NETWORK_STATUS" &&
    typeof event.data.online === "boolean" &&
    event.source?.id
  ) {
    clientNetworkStatus.set(event.source.id, event.data.online);
  }
});
