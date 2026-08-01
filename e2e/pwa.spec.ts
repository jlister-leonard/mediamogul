import { expect, test } from "@playwright/test";

async function waitForServiceWorker(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
    }
  });
}

async function reportNetworkStatus(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage({
      type: "NETWORK_STATUS",
      online: navigator.onLine,
    });
  });
}

const OFFLINE_BACKUP = JSON.stringify({
  version: 1,
  exportedAt: "2026-08-01T14:30:00.000Z",
  data: {
    items: [
      {
        id: "item-offline",
        medium: "book",
        title: "Piranesi",
        creators: ["Susanna Clarke"],
        ref: { medium: "book", isbn13: "9781635575637" },
        genre: { genre: "genre-fiction", source: "manual" },
      },
    ],
    entries: [],
    comparisons: [],
    queue: [],
    situations: [],
    availability: [],
    recs: [],
    portrait: [],
    manualMatches: [],
    availabilityRefreshes: [],
  },
});

test("manifest is linked and declares the installable app", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");

  const manifestResponse = await request.get(manifestHref!);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("Nightstand");
  expect(manifest.display).toBe("standalone");
  expect(manifest.share_target).toEqual({
    action: "/inbox",
    method: "GET",
    params: { title: "title", text: "text", url: "url" },
  });

  expect(manifest.icons).toHaveLength(4);
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toBe("image/png");
  }
});

test("share-target destination echoes shared params", async ({ page }) => {
  await page.goto(
    "/inbox?title=Piranesi&text=Susanna%20Clarke&url=https%3A%2F%2Fexample.com%2Fpiranesi",
  );
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("Piranesi", { exact: true })).toBeVisible();
  await expect(page.getByText("Susanna Clarke", { exact: true })).toBeVisible();
  await expect(
    page.getByText("https://example.com/piranesi", { exact: true }),
  ).toBeVisible();
});

test("offline reload renders the app shell from the service-worker cache", async ({
  page,
  context,
}) => {
  await page.goto("/");

  // Wait until the active service worker controls this page.
  await waitForServiceWorker(page);

  // Go offline. setOffline() covers the page; the route abort covers the
  // service worker's own fetch(), which network emulation does not reach
  // (PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS is set in the config).
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort());
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));
  const response = await page.reload();

  // Not vacuous: the marker header only exists on the cache-fallback path,
  // so this fails if the reload was somehow served by the network.
  expect(response, "offline reload should produce a response").not.toBeNull();
  expect(response!.fromServiceWorker()).toBe(true);
  expect(response!.headers()["x-nightstand-shell"]).toBe("cache");
  await expect(page.getByRole("heading", { name: "Nightstand" })).toBeVisible();

  // A working shell, not bare HTML: styles applied (Tailwind's flex on main)
  // and every static asset served from the precache — none hit the network.
  await expect(page.locator("main")).toHaveCSS("display", "flex");
  expect(failed.filter((url) => url.includes("/_next/static/"))).toEqual([]);
});

test("airplane mode preserves first-load routes, local writes, and local reads", async ({
  page,
  context,
}) => {
  // Visit only the home page online. The backup screen below therefore proves
  // install-time pre-caching, not a route that this tab happened to cache.
  await page.goto("/");
  await waitForServiceWorker(page);

  // Mutation probes: attempt to fetch every cacheable request class with a
  // query string, plus a query-bearing navigation, while the worker controls
  // the page. None may become a durable key.
  const staticPath = await page.evaluate(async () => {
    const shellKey = (await caches.keys()).find((key) =>
      key.startsWith("nightstand-shell-"),
    );
    if (shellKey === undefined) return undefined;
    const requests = await (await caches.open(shellKey)).keys();
    return requests
      .map((request) => new URL(request.url).pathname)
      .find((path) => path.startsWith("/_next/static/"));
  });
  expect(staticPath).toBeDefined();
  await page.evaluate(async () => {
    await Promise.all([
      fetch("/manifest.webmanifest?private=manifest"),
      fetch("/icons/icon-192.png?private=icon"),
    ]);
  });

  // Cache Storage and the browser HTTP cache are separate. Observe the same
  // query-bearing immutable asset twice through Chromium's network protocol;
  // the second response must not be served from disk cache.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const queriedStaticUrl = new URL(
    `${staticPath!}?private=static-repeat`,
    page.url(),
  ).href;
  const staticResponses: Array<{ fromDiskCache: boolean }> = [];
  cdp.on("Network.responseReceived", (event) => {
    if (event.response.url === queriedStaticUrl) {
      staticResponses.push({
        fromDiskCache: event.response.fromDiskCache === true,
      });
    }
  });
  await page.evaluate(async (url) => {
    await fetch(url);
    await fetch(url);
  }, queriedStaticUrl);
  await expect.poll(() => staticResponses.length).toBeGreaterThanOrEqual(2);
  expect(staticResponses.at(-1)?.fromDiskCache).toBe(false);
  await cdp.detach();

  await page.goto("/inbox?title=must-not-enter-the-cache");
  await page.goto("/");
  await waitForServiceWorker(page);

  const cachedRequests = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shellKey = keys.find((key) => key.startsWith("nightstand-shell-"));
    if (shellKey === undefined) return [];
    return (await (await caches.open(shellKey)).keys())
      .map((request) => {
        const url = new URL(request.url);
        return { path: url.pathname, search: url.search };
      });
  });
  // Mutation-style privacy assertion: inspecting every single key catches a
  // query leak even if it is a future static/core asset type.
  expect(cachedRequests).not.toEqual([]);
  expect(cachedRequests.map(({ search }) => search)).toEqual(
    cachedRequests.map(() => ""),
  );
  const cachedRoutes = cachedRequests
    .map(({ path }) => path)
    .filter((path) => !path.startsWith("/_next/") && !path.startsWith("/icons/"))
    .sort();
  expect(cachedRoutes).toEqual([
    "/",
    "/availability-demo",
    "/inbox",
    "/manifest.webmanifest",
    "/primitives",
    "/providers-demo",
    "/settings/backup",
    "/style",
  ]);

  // An upstream HTTP failure is not a transport failure: retain its status
  // and body exactly, while preventing the browser from caching the error.
  await context.route("**/api/providers/books?upstream-test=1", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify({ error: { code: "quota", message: "Slow down" } }),
    }),
  );
  const upstreamFailure = await page.evaluate(async () => {
    const response = await fetch("/api/providers/books?upstream-test=1");
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: await response.json(),
    };
  });
  expect(upstreamFailure).toEqual({
    status: 429,
    cacheControl: "no-store",
    body: { error: { code: "quota", message: "Slow down" } },
  });
  await context.unroute("**/api/providers/books?upstream-test=1");

  // A severed request while the browser is online must not be called offline.
  await reportNetworkStatus(page);
  await context.route("**/api/providers/books?transport-test=1", (route) =>
    route.abort(),
  );
  const transportFailure = await page.evaluate(async () => {
    const response = await fetch("/api/providers/books?transport-test=1");
    return {
      status: response.status,
      network: response.headers.get("x-nightstand-network"),
      body: await response.json(),
    };
  });
  expect(transportFailure).toEqual({
    status: 503,
    network: "network_unavailable",
    body: {
      error: {
        code: "network_unavailable",
        message:
          "The network request could not be completed. Your on-device library is still available.",
      },
    },
  });
  await context.unroute("**/api/providers/books?transport-test=1");

  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort());

  const offlineRoutes = [
    ["/", "Nightstand"],
    ["/inbox", "Inbox"],
    ["/primitives", "Primitives"],
    ["/providers-demo", "Provider buttons"],
    ["/style", "Something long tonight?"],
    ["/settings/backup", "Backup"],
  ] as const;
  for (const [path, heading] of offlineRoutes) {
    const response = await page.goto(path);
    expect(response, `${path} should render offline`).not.toBeNull();
    expect(response!.fromServiceWorker()).toBe(true);
    expect(response!.headers()["x-nightstand-shell"]).toBe("cache");
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await reportNetworkStatus(page);

  // Restore is a genuine application write into IndexedDB; it needs no
  // server queue because Nightstand's library is intentionally local-only.
  await page.getByLabel("Choose a Nightstand backup file").setInputFiles({
    name: "offline-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(OFFLINE_BACKUP),
  });
  await expect(page.getByRole("status")).toHaveText("Backup restored successfully.");

  // Export is a whole-database application read. Verify the local write is
  // immediately readable, then survives an offline reload.
  async function exportAndReadTitle() {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const backup = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      data: { items: Array<{ title: string }> };
    };
    expect(backup.data.items.map((item) => item.title)).toEqual(["Piranesi"]);
  }

  await exportAndReadTitle();
  const cachedReload = await page.reload();
  expect(cachedReload).not.toBeNull();
  expect(cachedReload!.headers()["x-nightstand-shell"]).toBe("cache");
  await exportAndReadTitle();

  // This verification harness performs its own durable local refresh write,
  // so render it after the fresh-install-only backup restore above.
  const availabilityRoute = await page.goto("/availability-demo");
  expect(availabilityRoute).not.toBeNull();
  expect(availabilityRoute!.fromServiceWorker()).toBe(true);
  expect(availabilityRoute!.headers()["x-nightstand-shell"]).toBe("cache");
  await expect(
    page.getByRole("heading", { level: 1, name: "Availability verification" }),
  ).toBeVisible();
  await reportNetworkStatus(page);

  // Network-only provider lookups say exactly why they are unavailable. The
  // response is deliberately not cached, so it cannot masquerade as current.
  const providerResult = await page.evaluate(async () => {
    const response = await fetch("/api/providers/books?q=Piranesi");
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      offline: response.headers.get("x-nightstand-network"),
      body: await response.json(),
    };
  });
  expect(providerResult).toEqual({
    status: 503,
    cacheControl: "no-store",
    offline: "offline",
    body: {
      error: {
        code: "offline",
        message:
          "This lookup needs a connection. Your on-device library is still available.",
      },
    },
  });

  // A failed recommendation POST is neither queued nor successful. There is
  // no invented sync queue behind Nightstand's local-only architecture.
  const recommendResult = await page.evaluate(async () => {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Pick one" }] }),
    });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: await response.json(),
    };
  });
  expect(recommendResult).toEqual({
    status: 503,
    cacheControl: "no-store",
    body: {
      error: {
        code: "offline",
        message:
          "This lookup needs a connection. Your on-device library is still available.",
      },
    },
  });
  expect(JSON.stringify(recommendResult.body)).not.toMatch(/queued|success/i);
});
