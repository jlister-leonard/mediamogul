import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { THEATER_ZIP_STORAGE_KEY } from "../lib/availability/theaters";

test.use({
  geolocation: { latitude: 40.7128, longitude: -74.006 },
  permissions: ["geolocation"],
});

test("theater ZIP stays local and BigDataCloud runs only after consent", async ({ page }) => {
  const outbound: string[] = [];
  await page.route("https://api.bigdatacloud.net/**", async (route) => {
    outbound.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        lookupSource: "coordinates",
        countryCode: "US",
        postcode: "10007",
      }),
    });
  });
  await page.goto("/settings/theaters");
  await expect(page.getByRole("heading", { level: 1, name: "Movie theaters" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("textbox", { name: "US ZIP code" }).fill("1234");
  await page.getByRole("button", { name: "Save ZIP" }).click();
  await expect(page.getByRole("status")).toContainText("valid 5-digit US ZIP");

  await page.getByRole("textbox", { name: "US ZIP code" }).fill("02138");
  await page.getByRole("button", { name: "Save ZIP" }).click();
  await expect(page.getByRole("status")).toContainText("saved on this device");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "US ZIP code" })).toHaveValue("02138");

  await expect(page.getByText(/requesting IP address go directly.*BigDataCloud/i)).toBeVisible();
  expect(outbound).toEqual([]);

  await page.getByRole("button", { name: "Find ZIP using my location" }).click();
  await expect(page.getByRole("textbox", { name: "US ZIP code" })).toHaveValue("10007");
  await expect(page.getByRole("status")).toContainText("Review it");
  expect(outbound).toHaveLength(1);
  const lookup = new URL(outbound[0]);
  expect(lookup.origin).toBe("https://api.bigdatacloud.net");
  expect(lookup.pathname).toBe("/data/reverse-geocode-client");
  expect([...lookup.searchParams.entries()]).toEqual([
    ["latitude", "40.713"],
    ["longitude", "-74.006"],
    ["localityLanguage", "en"],
  ]);
  expect(await page.evaluate((key) => localStorage.getItem(key), THEATER_ZIP_STORAGE_KEY)).toBe("02138");
  const storageBeforeSave = await page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
  ));
  expect(storageBeforeSave).toEqual({ [THEATER_ZIP_STORAGE_KEY]: "02138" });

  await page.getByRole("button", { name: "Save ZIP" }).click();
  await expect(page.getByRole("status")).toContainText("saved on this device");
  expect(await page.evaluate((key) => localStorage.getItem(key), THEATER_ZIP_STORAGE_KEY)).toBe("10007");

  await page.getByRole("button", { name: "Remove ZIP" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "US ZIP code" })).toHaveValue("");
});
