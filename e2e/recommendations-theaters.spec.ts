import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Recommendations exposes a live now-playing situation chip", async ({ page }) => {
  await page.route("**/api/providers/tmdb/now-playing", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [{
          seed: { medium: "movie", title: "Heat", creators: [], ref: { medium: "movie", tmdbId: 949 } },
          availability: { kind: "theater", region: "US", fetchedAt: new Date().toISOString() },
        }],
      }),
    });
  });

  await page.goto("/recommendations");
  await expect(page.getByRole("heading", { level: 1, name: "Recommendations" })).toBeVisible();
  const chip = page.getByRole("button", { name: "movies in theaters now, 1 confirmed" });
  await expect(chip).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await chip.click();
  await expect(page.getByRole("status")).toContainText("1 confirmed theater movie");
});
