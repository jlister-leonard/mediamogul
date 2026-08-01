import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Mobile-first: the primitives are judged at phone size.
test.use({ viewport: { width: 390, height: 844 } });

function axeScan(page: Page) {
  // The Next.js dev overlay is not part of the product surface.
  return new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
}

for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("axe scan of /primitives finds zero violations", async ({ page }) => {
      await page.goto("/primitives");
      await expect(page.getByRole("heading", { name: "Primitives" })).toBeVisible();
      const results = await axeScan(page);
      expect(results.violations).toEqual([]);
    });

    test("axe scan with the sheet open finds zero violations", async ({ page }) => {
      await page.goto("/primitives");
      await page.getByRole("button", { name: "Open sheet" }).click();
      await expect(
        page.getByRole("dialog", { name: "Log The Overstory" }),
      ).toBeVisible();
      await page.waitForFunction(() => {
        const dialog = document.querySelector("dialog");
        return dialog && getComputedStyle(dialog).opacity === "1";
      });
      // A modal dialog makes the document behind it inert. Restrict this scan
      // to the active surface so axe does not composite the translucent
      // backdrop over inaccessible background controls and report false
      // contrast failures. The preceding test scans that full page directly.
      const results = await new AxeBuilder({ page })
        .include("dialog")
        .exclude("nextjs-portal")
        .analyze();
      expect(results.violations).toEqual([]);
    });
  });
}

test("every interactive primitive presents a tap target of at least 44px", async ({
  page,
}) => {
  await page.goto("/primitives");
  await page.getByRole("button", { name: "Open sheet" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const targets = page.locator(
    "main :is(button, a, input, [role='tab'], [role='radio'])",
  );
  const navTargets = page.locator("nav a");
  for (const locator of [targets, navTargets]) {
    const count = await locator.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const element = locator.nth(i);
      const box = await element.boundingBox();
      const label = await element.evaluate(
        (node) => node.getAttribute("aria-label") ?? node.textContent?.trim(),
      );
      expect(box, `${label} should be visible`).not.toBeNull();
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("the tab bar never occludes content — the page ends above it", async ({
  page,
}) => {
  await page.goto("/primitives");
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await page.waitForFunction(
    () =>
      Math.abs(
        window.scrollY + window.innerHeight -
          document.documentElement.scrollHeight,
      ) < 1,
  );
  const main = await page.locator("main").boundingBox();
  const nav = await page.locator("nav").boundingBox();
  expect(main).not.toBeNull();
  expect(nav).not.toBeNull();
  // Sticky-in-flow: the content column ends at or above the bar's top edge.
  expect(main!.y + main!.height).toBeLessThanOrEqual(nav!.y + 0.5);
});

test("the sheet closes on Escape and on backdrop tap", async ({ page }) => {
  await page.goto("/primitives");
  const opener = page.getByRole("button", { name: "Open sheet" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Log The Overstory" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await opener.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(195, 40); // above the sheet: the backdrop
  await expect(dialog).toBeHidden();
});
