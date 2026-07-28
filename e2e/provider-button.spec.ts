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

// The house focus ring is a 2px outline at a 2px offset: 4px beyond the pill on
// every edge. The scrollport is masked over its outermost 8px, so the ring must
// clear that too — inside the clip box is not enough if it lands in the fade.
const RING = 4;
const FADE = 8;

test("the scrolling row never clips a focus ring — on either axis", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  // Every row on the page, not just the one that happens to fit.
  const rows = page.getByRole("list", { name: /^Get / });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);

  // Establish keyboard modality so `:focus-visible` — which is what draws the
  // ring — matches on the programmatic focus below.
  await page.keyboard.press("Tab");

  for (let r = 0; r < rowCount; r++) {
    const row = rows.nth(r);
    const scrollerBox = (await row.locator("xpath=..").boundingBox())!;
    const items = row.locator("a[data-provider]");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      await item.focus();
      const box = (await item.boundingBox())!;
      const id = `row ${r} ${await item.getAttribute("data-provider")}`;
      expect(box.y - RING, `${id} ring top`).toBeGreaterThanOrEqual(
        scrollerBox.y,
      );
      expect(box.y + box.height + RING, `${id} ring bottom`).toBeLessThanOrEqual(
        scrollerBox.y + scrollerBox.height,
      );
      // X is where the ring was being guillotined: a pill resting 1px inside
      // the clip edge had 3px of ring sliced flat.
      expect(box.x - RING - FADE, `${id} ring left`).toBeGreaterThanOrEqual(
        scrollerBox.x,
      );
      expect(
        box.x + box.width + RING + FADE,
        `${id} ring right`,
      ).toBeLessThanOrEqual(scrollerBox.x + scrollerBox.width);
      const outline = await item.evaluate(
        (node) => getComputedStyle(node).outlineWidth,
      );
      expect(outline, `${id} focus ring`).toBe("2px");
    }
  }
});

test("the row bleeds without pushing the page into horizontal scroll", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBe(0);
});

test("the cropped edge of an overflowing row is faded, never sliced", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  const row = page.getByRole("list", { name: "Get The Overstory" });
  const scroller = row.locator("xpath=..");
  // This row genuinely overflows at 390px — that is the case worth proving.
  const overflows = await scroller.evaluate(
    (node) => node.scrollWidth > node.clientWidth,
  );
  expect(overflows).toBe(true);
  const mask = await scroller.evaluate(
    (node) => getComputedStyle(node).maskImage,
  );
  expect(mask).toContain("linear-gradient");
  expect(mask).toContain("8px");
});

test("a partially visible pill can still be brought fully into view", async ({
  page,
}) => {
  await page.goto("/providers-demo");
  const row = page.getByRole("list", { name: "Get Dune: Part Two" });
  const scroller = row.locator("xpath=..");
  const items = row.locator("a[data-provider]");
  // Chromium's own focus scrolling gives up on an item that is already
  // partially on screen, which stranded the last pill of this row.
  await items.nth(2).focus();
  const last = items.nth((await items.count()) - 1);
  await last.focus();
  const box = (await last.boundingBox())!;
  const scrollerBox = (await scroller.boundingBox())!;
  expect(box.x + box.width + RING + FADE).toBeLessThanOrEqual(
    scrollerBox.x + scrollerBox.width,
  );
});

test("under reduced motion the pill does not snap", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("/providers-demo");
  const pill = page.locator('a[data-provider="netflix"]').first();
  await pill.hover();
  expect(await pill.evaluate((node) => getComputedStyle(node).transform)).toBe(
    "none",
  );
  await context.close();
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
