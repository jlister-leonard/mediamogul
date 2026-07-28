import { expect, test } from "@playwright/test";

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
