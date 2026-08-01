import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("theater ZIP stays local and geolocation remains honestly disabled", async ({ page }) => {
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

  await page.getByRole("button", { name: "Check location option" }).click();
  await expect(page.getByRole("status")).toContainText("no location permission was requested");

  await page.getByRole("button", { name: "Remove ZIP" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "US ZIP code" })).toHaveValue("");
});
