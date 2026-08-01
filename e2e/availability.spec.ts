import { expect, test } from "@playwright/test";

test("movie, podcast, and book refresh cold then survive reload from durable cache", async ({ page }) => {
  const fetchedAt = new Date().toISOString();
  let providerRequests = 0;
  await page.route("**/api/providers/tmdb/watch-providers**", async (route) => {
    providerRequests += 1;
    await route.fulfill({ json: { ok: true, data: { offers: [{
      tmdbProviderId: 8,
      providerName: "Netflix",
      availability: {
        kind: "subscription",
        providerId: "netflix",
        region: "US",
        fetchedAt,
      },
    }] } } });
  });
  await page.route("**/api/providers/tmdb/now-playing", async (route) => {
    providerRequests += 1;
    await route.fulfill({ json: { ok: true, data: [] } });
  });
  await page.route("**/api/providers/audible/catalog", async (route) => {
    providerRequests += 1;
    expect(await route.request().postDataJSON()).toEqual({
      title: "Bad Blood",
      creators: ["John Carreyrou"],
    });
    await route.fulfill({ json: { ok: true, product: {
      asin: "B07C8GVTB5",
      title: "Bad Blood",
      authors: [{ name: "John Carreyrou" }],
    } } });
  });

  await page.goto("/availability-demo");
  await expect(page.getByRole("status")).toHaveText(
    "movie:netflix:refreshed|podcast:spotify:refreshed|book:audible:refreshed",
  );
  expect(providerRequests).toBe(3);

  await page.reload();
  await expect(page.getByRole("status")).toHaveText(
    "movie:netflix:hit|podcast:spotify:hit|book:audible:hit",
  );
  expect(providerRequests).toBe(3);
});
