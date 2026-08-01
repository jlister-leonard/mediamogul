import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

// Vitest globals are off, so testing-library's automatic cleanup never hooks in.
afterEach(cleanup);
import {
  providerEntries,
  providerRegistry,
  type ProviderEntry,
} from "@/lib/providers/registry";
import { brandTreatment, relativeLuminance } from "./brand";
import { GetItRow } from "./GetItRow";
import { ProviderButton } from "./ProviderButton";
import { providerWebUrl, type ProviderLinkArgs } from "./link";

const TITLE = "Dune: Part Two";
const BOOK = {
  title: "The Overstory",
  author: "Richard Powers",
  isbn13: "9780393635522",
} as const;

function sampleLink(entry: ProviderEntry): ProviderLinkArgs {
  switch (entry.deepLink.params) {
    case "title":
      return { params: "title", title: TITLE };
    case "book":
      return { params: "book", ...BOOK };
    case "showtimes":
      return { params: "showtimes", title: TITLE, zip: "94110" };
    case "spotifyShow":
      return { params: "spotifyShow", spotifyShowId: "4rOoJ6Egrf8K2Iryw" };
    case "applePodcast":
      return { params: "applePodcast", appleId: 1200361736 };
  }
}

/** Luminance of a treatment color: the sRGB poles are exact, hex is measured. */
function luminanceOf(color: string): number {
  if (color === "white") return 1;
  if (color === "black") return 0;
  return relativeLuminance(color);
}

function ratio(a: number, b: number): number {
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

describe("the registry, end to end", () => {
  test("every entry renders as a link — all 14, no exceptions", () => {
    render(
      <ul>
        {providerEntries.map((entry) => (
          <li key={entry.id}>
            <ProviderButton provider={entry} link={sampleLink(entry)} />
          </li>
        ))}
      </ul>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(14);
    expect(links.map((link) => link.getAttribute("data-provider"))).toEqual(
      providerEntries.map((entry) => entry.id),
    );
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  test("every registry entry renders a verified-context asset or exact-casing fallback", () => {
    for (const entry of providerEntries) {
      cleanup();
      render(<ProviderButton provider={entry} link={sampleLink(entry)} />);
      const mark = screen.getByRole("img", { name: entry.name });
      if (entry.logoAsset === null) {
        expect(mark.tagName).toBe("SPAN");
        expect(mark.textContent).toBe(entry.wordmark);
      } else {
        expect(mark.tagName).toBe("IMG");
        expect(mark.getAttribute("src")).toBe(entry.logoAsset);
        expect(mark.style.height).toBe(`${entry.logoHeightPx}px`);
      }
    }
  });

  test("the brand's own colors are what get painted", () => {
    render(
      <ProviderButton
        provider={providerRegistry.netflix}
        link={{ params: "title", title: TITLE }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.style.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(link.style.color).toBe("white");
  });

  test("external links open away from the app, without leaking a referrer", () => {
    render(
      <ProviderButton
        provider={providerRegistry.hulu}
        link={{ params: "title", title: TITLE }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("typed link building", () => {
  test("builds the right URL for each of the five param shapes", () => {
    expect(
      providerWebUrl(providerRegistry.netflix, {
        params: "title",
        title: TITLE,
      }),
    ).toBe("https://www.netflix.com/search?q=Dune%3A%20Part%20Two");

    expect(
      providerWebUrl(providerRegistry.kindle, { params: "book", ...BOOK }),
    ).toBe("https://www.amazon.com/s?k=9780393635522&i=digital-text");

    expect(
      providerWebUrl(providerRegistry.bookshop, {
        params: "book",
        title: BOOK.title,
        author: BOOK.author,
      }),
    ).toBe(
      "https://bookshop.org/search?keywords=The%20Overstory%20Richard%20Powers",
    );

    expect(
      providerWebUrl(providerRegistry.fandango, {
        params: "showtimes",
        title: TITLE,
        zip: "94110",
      }),
    ).toBe("https://www.fandango.com/search?q=Dune%3A%20Part%20Two");

    expect(
      providerWebUrl(providerRegistry.fandango, {
        params: "showtimes",
        title: TITLE,
      }),
    ).toBe("https://www.fandango.com/search?q=Dune%3A%20Part%20Two");

    expect(
      providerWebUrl(providerRegistry.spotify, {
        params: "spotifyShow",
        spotifyShowId: "4rOoJ6Egrf8K2Iryw",
      }),
    ).toBe("https://open.spotify.com/show/4rOoJ6Egrf8K2Iryw");

    expect(
      providerWebUrl(providerRegistry.overcast, {
        params: "applePodcast",
        appleId: 1200361736,
      }),
    ).toBe("https://overcast.fm/");
  });

  test("uses honest homepages where generated search routes are broken", () => {
    const args = { params: "title", title: TITLE } as const;
    expect(providerWebUrl(providerRegistry["hbo-max"], args)).toBe(
      "https://www.hbomax.com/",
    );
    expect(providerWebUrl(providerRegistry.peacock, args)).toBe(
      "https://www.peacocktv.com/",
    );
    expect(providerWebUrl(providerRegistry["disney-plus"], args)).toBe(
      "https://www.disneyplus.com/",
    );
  });

  test("a provider-resolved availability URL overrides the generic fallback", () => {
    render(
      <ProviderButton
        provider={providerRegistry.peacock}
        href="https://www.peacocktv.com/watch/asset/movies/dune/abc123"
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://www.peacocktv.com/watch/asset/movies/dune/abc123",
    );
  });

  test("rejects unsafe provider-resolved destinations", () => {
    expect(() =>
      render(
        <ProviderButton
          provider={providerRegistry.peacock}
          href="javascript:alert(document.cookie)"
        />,
      ),
    ).toThrow(/must use https/);
  });

  test("rejects a valid HTTPS URL belonging to another provider", () => {
    expect(() =>
      render(
        <ProviderButton
          provider={providerRegistry.netflix}
          href="https://www.hulu.com/watch/abc"
        />,
      ),
    ).toThrow(/Netflix destinations must use an allowed host/);
  });

  test("rejects lookalike and subdomain-confusion hosts", () => {
    for (const href of [
      "https://netflix.com.evil.example/watch/abc",
      "https://evil.netflix.com/watch/abc",
    ]) {
      expect(() =>
        render(<ProviderButton provider={providerRegistry.netflix} href={href} />),
      ).toThrow(/Netflix destinations must use an allowed host/);
    }
  });

  test("an entry resolved at runtime rejects arguments of the wrong shape", () => {
    expect(() =>
      providerWebUrl(providerRegistry.netflix, {
        params: "applePodcast",
        appleId: 1200361736,
      } as ProviderLinkArgs),
    ).toThrow(/netflix takes "title" link arguments, received "applePodcast"/);
  });

  test("the custom app scheme is never what the anchor points at", () => {
    // Spotify is the one entry with a documented `app` URI; the button still
    // uses the safe HTTPS destination so an absent app never dead-ends.
    render(
      <ProviderButton
        provider={providerRegistry.spotify}
        link={{ params: "spotifyShow", spotifyShowId: "abc" }}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://open.spotify.com/show/abc",
    );
  });
});

describe("the logo branch", () => {
  const STUB = "data:image/svg+xml,%3Csvg%20xmlns%3D'x'%3E%3C%2Fsvg%3E";
  const withLogo: ProviderEntry = {
    ...providerRegistry.netflix,
    logoAsset: STUB,
  };

  test("renders the asset instead of the wordmark, keeping the same name", () => {
    render(
      <ProviderButton provider={withLogo} link={{ params: "title", title: TITLE }} />,
    );
    const image = screen.getByRole("img", { name: "Netflix" });
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("src")).toBe(STUB);
    expect(screen.queryByText("NETFLIX")).toBeNull();
    // Height is fixed and width is auto: the mark is never distorted.
    expect(image.style.height).toBe("24px");
    expect(image.className).toContain("w-auto");
  });

  test("the accessible name is identical to the wordmark branch", () => {
    const { container } = render(
      <ProviderButton
        provider={withLogo}
        link={{ params: "title", title: TITLE }}
        suffix="rent $3.99"
      />,
    );
    expect(within(container).getByRole("link").textContent).toBe("rent $3.99");
    expect(within(container).getByRole("img", { name: "Netflix" })).toBeTruthy();
  });
});

describe("brand treatment", () => {
  test("button text clears AA on every brand field in the registry", () => {
    for (const entry of providerEntries) {
      const { textColor } = brandTreatment(entry.brand);
      const measured = ratio(
        luminanceOf(textColor),
        relativeLuminance(entry.brand.background),
      );
      expect(
        measured,
        `${entry.id} text on ${entry.brand.background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("only registry pairs below AA get a readable text substitute", () => {
    const substituted = providerEntries
      .filter((entry) => brandTreatment(entry.brand).textColor !== entry.brand.foreground)
      .map((entry) => entry.id);
    expect(substituted).toEqual(["netflix", "fandango", "overcast"]);
    expect(brandTreatment(providerRegistry.netflix.brand).pairRatio).toBeCloseTo(4.38, 2);
    expect(brandTreatment(providerRegistry.fandango.brand).pairRatio).toBeCloseTo(2.73, 2);
    expect(brandTreatment(providerRegistry.overcast.brand).pairRatio).toBeCloseTo(2.58, 2);
    expect(brandTreatment(providerRegistry.fandango.brand).textColor).toBe("black");
    expect(brandTreatment(providerRegistry.overcast.brand).textColor).toBe("black");
    expect(brandTreatment(providerRegistry.netflix.brand).textColor).toBe("white");
  });

  test("a below-AA brand keeps its field exactly and only re-colors the text", () => {
    render(
      <ProviderButton
        provider={providerRegistry.fandango}
        link={{ params: "showtimes", title: TITLE }}
        suffix="showtimes"
      />,
    );
    const link = screen.getByRole("link");
    // Fandango orange, untouched — the field is the recognition cue.
    expect(link.style.backgroundColor).toBe("rgb(255, 115, 0)");
    expect(link.style.color).toBe("black");
    // Wordmark and suffix share one color; neither carries its own.
    expect(screen.getByText("showtimes").style.color).toBe("");
    expect(screen.getByRole("img", { name: "Fandango" }).style.color).toBe("");
  });

  test("hairlines land on exactly the fields that dissolve into each ground", () => {
    const inDark = providerEntries
      .filter((entry) => brandTreatment(entry.brand).hairlineInDark)
      .map((entry) => entry.id);
    const inLight = providerEntries
      .filter((entry) => brandTreatment(entry.brand).hairlineInLight)
      .map((entry) => entry.id);
    // Near-black fields on warm ink.
    expect(inDark).toEqual([
      "netflix",
      "hbo-max",
      "prime-video",
      "apple-tv-plus",
      "peacock",
      "disney-plus",
      "kindle",
    ]);
    // Bright and white fields on warm paper.
    expect(inLight).toEqual([
      "hulu",
      "spotify",
      "audible",
      "bookshop",
      "fandango",
      "overcast",
    ]);
    expect(inDark).not.toContain("bookshop");
    expect(inLight).toContain("bookshop");
  });

  test("a hairline is a ring, so it costs no layout", () => {
    const { container } = render(
      <ProviderButton
        provider={providerRegistry.bookshop}
        link={{ params: "book", ...BOOK }}
      />,
    );
    const className = container.querySelector("a")!.className;
    expect(className).toContain("ring-1");
    expect(className).toContain("dark:ring-0");
    expect(className).not.toContain("border");
  });
});

describe("GetItRow", () => {
  const items = [
    { provider: providerRegistry["hbo-max"], link: { params: "title", title: TITLE } as const },
    { provider: providerRegistry["prime-video"], link: { params: "title", title: TITLE } as const, suffix: "rent $3.99" },
    { provider: providerRegistry["prime-video"], link: { params: "title", title: TITLE } as const, suffix: "buy $19.99" },
  ];

  test("renders the array exactly as ordered — it never sorts", () => {
    render(<GetItRow label="Get Dune" items={items} />);
    const list = screen.getByRole("list", { name: "Get Dune" });
    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => link.getAttribute("data-provider")),
    ).toEqual(["hbo-max", "prime-video", "prime-video"]);
  });

  test("the same provider can appear twice with different offers", () => {
    render(<GetItRow label="Get Dune" items={items} />);
    expect(screen.getByText("rent $3.99")).toBeTruthy();
    expect(screen.getByText("buy $19.99")).toBeTruthy();
  });

  test("two identical offers still render as two buttons", () => {
    // Position is part of the key, so an array E5.5 hands over with a repeat
    // renders both rather than silently collapsing to one.
    render(<GetItRow label="Get Dune" items={[items[1], items[1]]} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByText("rent $3.99")).toHaveLength(2);
  });

  test("the scrollport carries the padding and fade its geometry depends on", () => {
    const { container } = render(<GetItRow label="Get Dune" items={items} />);
    const scroller = container.firstElementChild!;
    // scroll-padding is the knob Chromium's scrollIntoView actually honors,
    // and the 8px fade must stay narrower than the 12px of ring clearance it
    // buys — the two numbers are a pair, so they are asserted together.
    expect(scroller.className).toContain("scroll-px-4");
    expect(scroller.className).toContain("black_8px");
  });

  test("an empty row renders nothing at all", () => {
    const { container } = render(<GetItRow label="Get Dune" items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
