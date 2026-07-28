import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * E0.7 — the style tile is a human gate, so this spec's first job is to
 * produce the artefact Jeremy actually looks at: a full-length 390px capture
 * of the screen in both themes, written to `style-tile-shots/`. The rest of
 * the spec is the floor those captures have to clear — zero axe violations
 * on both themes and with the dismissal open, and a 44px tap target on every
 * interactive element, including the branded Get-it buttons.
 */

const SHOTS = "style-tile-shots";

// The screen is designed at phone width; it is judged at phone width.
test.use({ viewport: { width: 390, height: 844 } });

function axeScan(page: Page) {
  // The Next.js dev overlay is not part of the product surface.
  return new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
}

async function openTile(page: Page) {
  await page.goto("/style");
  await expect(
    page.getByRole("heading", { level: 1, name: "Something long tonight?" }),
  ).toBeVisible();
  // Fraunces and Inter are self-hosted; wait for both so no capture is taken
  // mid-swap.
  await page.evaluate(() => document.fonts.ready);
}

/**
 * A full-length capture taken by growing the viewport to the document, not by
 * `fullPage`. `fullPage` stitches the scroll and paints the sticky tab bar
 * across the middle of the image — an artefact of the capture, not of the
 * screen, and a misleading thing to put in front of a reviewer.
 */
async function captureFullLength(page: Page, path: string) {
  const viewport = page.viewportSize()!;
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({ width: viewport.width, height: Math.ceil(height) });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path });
  await page.setViewportSize(viewport);
}

for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("captures the tile and finds zero axe violations", async ({ page }) => {
      await openTile(page);
      // Above the fold, at the size it ships: the first impression on its own.
      await page.screenshot({ path: `${SHOTS}/style-tile-${colorScheme}-fold.png` });
      await captureFullLength(page, `${SHOTS}/style-tile-${colorScheme}.png`);

      const results = await axeScan(page);
      expect(results.violations).toEqual([]);
    });
  });
}

// Dark is the product's default theme, so the detail captures are taken there.
test.describe("dark theme details", () => {
  test.use({ colorScheme: "dark" });

  test("dismiss-with-reason opens, captures, and stays accessible", async ({
    page,
  }) => {
    await openTile(page);
    const notTonight = page.getByRole("button", { name: "Not tonight" });
    await expect(notTonight).toHaveAttribute("aria-expanded", "false");
    await notTonight.click();
    await expect(notTonight).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", { name: "Bounced off it" }),
    ).toBeVisible();
    await captureFullLength(page, `${SHOTS}/style-tile-dark-dismiss.png`);

    const results = await axeScan(page);
    expect(results.violations).toEqual([]);
  });

  test("captures the drawer strip scrolled to its end", async ({ page }) => {
    await openTile(page);
    const strip = page
      .getByRole("list")
      .filter({ hasText: "The House of Morgan" });
    await expect(
      page.getByRole("link", { name: /^Into Thin Air by Jon Krakauer/ }),
    ).toBeAttached();
    await strip.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(() => strip.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    await page
      .locator("section", {
        has: page.getByRole("heading", { name: "The drawer" }),
      })
      .screenshot({ path: `${SHOTS}/style-tile-dark-covers.png` });
  });
});

/**
 * Every sentence on this screen is checked against
 * `data/goodreads_library_export.csv` and TASTE-BASELINE Finding 7. These
 * are the assertions that keep a claim from drifting back into something
 * that merely sounds personal.
 */
test.describe("the copy is corpus-true", () => {
  test("the reason cites two real Lives titles and a real film", async ({
    page,
  }) => {
    await openTile(page);
    const card = page.locator("article.ns-rec-card");
    await expect(card).toContainText(
      "Steve Jobs and Titan sit one and four in your Lives ladder, and this is the only life story on your stack",
    );
    await expect(card).toContainText("You gave The Social Network five stars");
    // Into Thin Air is grit-wilderness, not lives (lib/types/genre.ts). It may
    // appear in the library; it may never be cited as a Lives standing.
    await expect(card).not.toContainText("Into Thin Air");
  });

  test("the greeting asserts no date and no invented finish", async ({
    page,
  }) => {
    await openTile(page);
    const header = page.locator("main > header");
    await expect(header).toContainText(
      "The last five books you added to the stack are all business strategy",
    );
    // Dates are unreliable in this corpus (Finding 5) — nothing on the screen
    // may lean on a weekday, a "since", or a date added.
    await expect(header).not.toContainText(
      /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|longest/,
    );
  });

  test("the drawer runs the whole rating scale and mixes media", async ({
    page,
  }) => {
    await openTile(page);
    for (const name of [
      "The House of Morgan by Ron Chernow — you loved it",
      "Sicario directed by Denis Villeneuve — you loved it",
      "Titan by Ron Chernow — you liked it",
      "Going Infinite by Michael Lewis — you thought it was fine",
      "Catch-22 by Joseph Heller — not for you",
    ]) {
      await expect(page.getByRole("link", { name })).toHaveCount(1);
    }
  });
});

/**
 * The accent tint must never cost the card its elevation. A raised surface
 * is lighter than the ground in BOTH themes, and mixing a light-mode accent
 * (a dark value) into the surface once pulled the hero card below the page.
 */
for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`${colorScheme} elevation`, () => {
    test.use({ colorScheme });

    test("the tinted hero card still sits above the ground", async ({
      page,
    }) => {
      await openTile(page);
      const luminance = (color: string) => {
        const [r, g, b] = color
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      const card = await page
        .locator("article.ns-rec-card")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(luminance(card)).toBeGreaterThan(luminance(ground));
    });
  });
}

test("the Get-it row is branded from the provider registry", async ({ page }) => {
  await openTile(page);
  // Exact official casing, straight out of lib/providers/registry.ts.
  for (const wordmark of ["kindle", "audible", "BOOKSHOP.ORG"]) {
    await expect(
      page.getByRole("link", { name: /^Get American Prometheus on / }).filter({
        hasText: wordmark,
      }),
    ).toHaveCount(1);
  }
  const kindle = page.getByRole("link", {
    name: "Get American Prometheus on Kindle",
  });
  await expect(kindle).toHaveAttribute(
    "href",
    "https://www.amazon.com/s?k=9780375726262&i=digital-text",
  );
  await expect(kindle).toHaveCSS("background-color", "rgb(35, 47, 62)");
});

test("the hero card repaints its own controls from the cover's accent", async ({
  page,
}) => {
  await openTile(page);
  const pageAccent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  const cardAccent = await page
    .locator("article.ns-rec-card")
    .evaluate((node) => getComputedStyle(node).getPropertyValue("--accent").trim());
  expect(cardAccent).not.toBe("");
  expect(cardAccent).not.toBe(pageAccent);

  // The primary action inside the card is painted with the card's accent,
  // not the page's lamp.
  const buttonBg = await page
    .getByRole("button", { name: "Start it tonight" })
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const lampBg = await page
    .locator("article.ns-rec-card")
    .evaluate((node) => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--lamp)";
      node.ownerDocument.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    });
  expect(buttonBg).not.toBe(lampBg);
});

test("every interactive element presents a tap target of at least 44px", async ({
  page,
}) => {
  await openTile(page);
  await page.getByRole("button", { name: "Not tonight" }).click();
  for (const locator of [
    page.locator("main :is(a, button)"),
    page.locator("nav a"),
  ]) {
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

test("the tab bar never occludes the screen — content ends above it", async ({
  page,
}) => {
  await openTile(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await page.waitForFunction(
    () =>
      Math.abs(
        window.scrollY + window.innerHeight - document.documentElement.scrollHeight,
      ) < 1,
  );
  const main = await page.locator("main").boundingBox();
  const nav = await page.locator("nav").boundingBox();
  expect(main).not.toBeNull();
  expect(nav).not.toBeNull();
  expect(main!.y + main!.height).toBeLessThanOrEqual(nav!.y + 0.5);
});
