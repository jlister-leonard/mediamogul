import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { providerEntries } from "../lib/providers/registry";

// Mobile-first: these are the most-tapped elements in the app, judged at the
// size a thumb meets them.
test.use({ viewport: { width: 390, height: 844 } });

function axeScan(page: Page) {
  // The Next.js dev overlay is not part of the product surface.
  return new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
}

const buttons = (page: Page) => page.locator("main a[data-provider]");

for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("axe scan of /providers-demo finds zero violations", async ({ page }) => {
      await page.goto("/providers-demo");
      await expect(
        page.getByRole("heading", { name: "Provider buttons" }),
      ).toBeVisible();
      const results = await axeScan(page);
      expect(results.violations).toEqual([]);
    });
  });
}

test("every provider button is a comfortable tap target", async ({ page }) => {
  await page.goto("/providers-demo");
  const targets = buttons(page);
  const count = await targets.count();
  expect(count).toBeGreaterThanOrEqual(providerEntries.length);
  for (let i = 0; i < count; i++) {
    const button = targets.nth(i);
    const id = await button.getAttribute("data-provider");
    const box = await button.boundingBox();
    expect(box, `${id} should be visible`).not.toBeNull();
    expect(box!.height, `${id} height`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `${id} width`).toBeGreaterThanOrEqual(44);
  }
});

test("every wordmark renders in the registry's exact casing, untransformed", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  for (const entry of providerEntries) {
    // The "Every service" section renders one button per entry.
    const mark = page
      .locator(`a[data-provider="${entry.id}"] span[role="img"]`)
      .last();
    await expect(mark).toHaveText(entry.wordmark);
    // A CSS transform would re-case the mark without changing the DOM text.
    await expect(mark).toHaveCSS("text-transform", "none");
    // The interface sans, never the display serif: no faux brand lettering.
    const family = await mark.evaluate((node) => getComputedStyle(node).fontFamily);
    expect(family).toContain("Inter");
    expect(family).not.toContain("Fraunces");
  }
});

test("provider links leave the app safely and point at the registry's web URL", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  const netflix = page.locator('a[data-provider="netflix"]').first();
  await expect(netflix).toHaveAttribute(
    "href",
    "https://www.netflix.com/search?q=Dune%3A%20Part%20Two",
  );
  await expect(netflix).toHaveAttribute("target", "_blank");
  await expect(netflix).toHaveAttribute("rel", "noopener noreferrer");
});

test("the scrolling row never clips a focus ring", async ({ page }) => {
  await page.goto("/providers-demo");
  const row = page.getByRole("list", { name: "Get Dune: Part Two" });
  const scroller = row.locator("xpath=..");
  const scrollerBox = (await scroller.boundingBox())!;
  const items = row.locator("a[data-provider]");
  const count = await items.count();
  expect(count).toBeGreaterThan(0);

  // Establish keyboard modality so `:focus-visible` — which is what draws the
  // ring — matches on the programmatic focus below.
  await page.keyboard.press("Tab");

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    await item.focus();
    // The house focus ring is a 2px outline at a 2px offset: 4px beyond the
    // pill on every edge, all of which must survive the overflow container.
    const box = (await item.boundingBox())!;
    const id = await item.getAttribute("data-provider");
    expect(box.y - 4, `${id} ring top`).toBeGreaterThanOrEqual(scrollerBox.y);
    expect(box.y + box.height + 4, `${id} ring bottom`).toBeLessThanOrEqual(
      scrollerBox.y + scrollerBox.height,
    );
    const outline = await item.evaluate(
      (node) => getComputedStyle(node).outlineWidth,
    );
    expect(outline, `${id} focus ring`).toBe("2px");
  }
});

test("the logo branch renders the asset in place of the wordmark", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  // Only the logo branch emits an <img>; every other button renders a wordmark.
  const image = page.locator('main a[data-provider] img[alt="Netflix"]').first();
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  // 24px tall clears every published minimum size in BRANDS.md, and the width
  // follows the art's own aspect ratio — 96:24 for the stub, undistorted.
  expect(box.height).toBeCloseTo(24, 0);
  expect(box.width / box.height).toBeCloseTo(4, 1);
});
