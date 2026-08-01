import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderButton } from "../../components/provider-button/ProviderButton";
import {
  availabilitySchema,
  itemSchema,
  type Availability,
  type Item,
} from "../types";
import { availabilitySuffix, composeGetIt } from "./index";
import evidence from "./fixtures/link-evidence.json";

afterEach(cleanup);

const fetchedAt = "2026-08-01T12:00:00.000Z";

function item(input: unknown): Item {
  return itemSchema.parse(input);
}

function offer(input: unknown): Availability {
  return availabilitySchema.parse({
    itemId: "dune",
    region: "US",
    fetchedAt,
    ...input as object,
  });
}

const dune = item({
  id: "dune",
  medium: "movie",
  title: "Dune: Part Two",
  creators: ["Denis Villeneuve"],
  ref: { medium: "movie", tmdbId: 693134 },
});

describe("composeGetIt", () => {
  it("orders subscription, rent, buy, and theater independent of source row order", () => {
    const offers = [
      offer({ kind: "theater", fandangoUrl: "https://www.fandango.com/dune-part-two-2024-234499/movie-overview" }),
      offer({ kind: "buy", providerId: "prime-video", priceUsd: 19.99 }),
      offer({ kind: "subscription", providerId: "hulu" }),
      offer({ kind: "rent", providerId: "apple-tv-plus", priceUsd: 4.99 }),
      offer({ kind: "subscription", providerId: "netflix" }),
      offer({ kind: "rent", providerId: "prime-video", priceUsd: 3.99 }),
    ];

    const expected = [
      "netflix:included",
      "hulu:included",
      "prime-video:rent $3.99",
      "apple-tv-plus:rent $4.99",
      "prime-video:buy $19.99",
      "fandango:showtimes",
    ];
    const summarize = (rows: readonly Availability[]) =>
      composeGetIt(dune, rows).items.map(
        (entry) => `${entry.provider.id}:${entry.suffix}`,
      );

    expect(summarize(offers)).toEqual(expected);
    expect(summarize([...offers].reverse())).toEqual(expected);
    expect(summarize([offers[2], offers[5], offers[0], offers[4], offers[1], offers[3]])).toEqual(expected);
  });

  it("uses exact allowed direct URLs and falls back for unsafe, lookalike, or malformed URLs", () => {
    const exact = composeGetIt(dune, [offer({
      kind: "subscription",
      providerId: "netflix",
      url: "https://www.netflix.com/title/81498765",
    })]).items[0];
    expect(exact).toMatchObject({ href: "https://www.netflix.com/title/81498765" });

    for (const url of [
      "http://www.netflix.com/title/81498765",
      "https://netflix.com.evil.example/title/81498765",
      "https://help.netflix.com/title/81498765",
    ]) {
      const button = composeGetIt(dune, [offer({
        kind: "subscription",
        providerId: "netflix",
        url,
      })]).items[0];
      expect(button).not.toHaveProperty("href");
      expect(button).toMatchObject({ link: { params: "title", title: dune.title } });
    }

    const corrupt = {
      ...offer({ kind: "subscription", providerId: "netflix" }),
      url: "not a url",
    } as Availability;
    expect(composeGetIt(dune, [corrupt]).items[0]).not.toHaveProperty("href");
  });

  it("keeps a supplied local ZIP out of the Fandango fallback", () => {
    const theater = offer({ kind: "theater" });
    const button = composeGetIt(dune, [theater], { zip: "94110" }).items[0];
    expect(button).toMatchObject({
      provider: { id: "fandango" },
      link: { params: "showtimes", title: "Dune: Part Two" },
    });
    if (!("link" in button) || button.link === undefined) {
      throw new Error("expected registry fallback");
    }
    render(createElement(ProviderButton, button));
    const href = screen.getByRole("link").getAttribute("href");
    expect(href).toBe("https://www.fandango.com/search?q=Dune%3A%20Part%20Two");
    expect(href).not.toContain("94110");
  });

  it("ignores availability for a different item and labels its fallback as a search", () => {
    const result = composeGetIt(dune, [offer({
      itemId: "another-title",
      kind: "subscription",
      providerId: "netflix",
    })]);

    expect(result.emptyState).toEqual({
      message: "Not streamable right now.",
      alternativeLabel: "Best alternative",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provider: { id: "prime-video" },
      link: { params: "title", title: "Dune: Part Two" },
      suffix: "check rentals",
    });
  });

  it("puts Kindle then Audible then Bookshop and preserves a validated Audible detail URL", () => {
    const book = item({
      id: "overstory",
      medium: "book",
      title: "The Overstory",
      creators: ["Richard Powers"],
      ref: { medium: "book", isbn13: "9780393356687" },
    });
    const result = composeGetIt(book, [offer({
      itemId: "overstory",
      kind: "buy",
      providerId: "audible",
      url: "https://www.audible.com/pd/B07F17SYNG",
    })]);

    expect(result.items.map((entry) => entry.provider.id)).toEqual([
      "kindle",
      "audible",
      "bookshop",
    ]);
    expect(result.items[1]).toMatchObject({
      href: "https://www.audible.com/pd/B07F17SYNG",
      suffix: "buy",
    });
    expect(result.items[0]).toMatchObject({
      link: {
        params: "book",
        title: "The Overstory",
        author: "Richard Powers",
        isbn13: "9780393356687",
      },
    });
  });

  it("puts Spotify first for podcasts without offering Apple Podcasts", () => {
    const podcast = item({
      id: "99pi",
      medium: "podcast",
      title: "99% Invisible",
      creators: ["Roman Mars"],
      ref: {
        medium: "podcast",
        spotifyShowId: "2VRS1IJCTn2Nlkg33ZVfkM",
        appleId: 394775318,
      },
    });
    const result = composeGetIt(podcast, [offer({
      itemId: "99pi",
      kind: "subscription",
      providerId: "spotify",
      url: "https://open.spotify.com/show/2VRS1IJCTn2Nlkg33ZVfkM",
    })]);

    expect(result.items.map((entry) => entry.provider.id)).toEqual([
      "spotify",
      "overcast",
    ]);
    expect(result.items[0]).toMatchObject({
      href: "https://open.spotify.com/show/2VRS1IJCTn2Nlkg33ZVfkM",
    });
  });

  it("offers an honest generic podcast alternative when only Podcast Index identity exists", () => {
    const podcast = item({
      id: "index-only",
      medium: "podcast",
      title: "Index-only show",
      creators: [],
      ref: { medium: "podcast", podcastIndexId: 42 },
    });
    expect(composeGetIt(podcast, []).items).toMatchObject([{
      provider: { id: "overcast" },
      href: "https://overcast.fm/",
      suffix: "open app",
    }]);
  });

  it("formats every suffix from kind and finite positive price without widening surprises", () => {
    expect(availabilitySuffix(offer({ kind: "subscription", providerId: "hulu" }))).toBe("included");
    expect(availabilitySuffix(offer({ kind: "rent", providerId: "prime-video", priceUsd: 3.9 }))).toBe("rent $3.90");
    expect(availabilitySuffix(offer({ kind: "buy", providerId: "prime-video", priceUsd: 20 }))).toBe("buy $20.00");
    expect(availabilitySuffix(offer({ kind: "rent", providerId: "prime-video" }))).toBe("rent");
    expect(availabilitySuffix(offer({ kind: "theater" }))).toBe("showtimes");
  });

  it("rounds displayable cents and rejects tiny, unsafe, nonfinite, or pill-widening prices", () => {
    const rent = offer({ kind: "rent", providerId: "prime-video" }) as Extract<
      Availability,
      { kind: "rent" }
    >;
    const suffix = (priceUsd: number) =>
      availabilitySuffix({ ...rent, priceUsd });

    expect(suffix(0.0049)).toBe("rent");
    expect(suffix(0.005)).toBe("rent $0.01");
    expect(suffix(1.005)).toBe("rent $1.01");
    expect(suffix(999.994)).toBe("rent $999.99");
    expect(suffix(999.995)).toBe("rent");
    expect(suffix(Number.MAX_SAFE_INTEGER)).toBe("rent");
    expect(suffix(Number.POSITIVE_INFINITY)).toBe("rent");
    expect(suffix(Number.NaN)).toBe("rent");
  });

  it("renders every generic result through the provider registry", () => {
    const result = composeGetIt(dune, []);
    const button = result.items[0];
    if (!("link" in button) || button.link === undefined) {
      throw new Error("expected a registry-backed alternative");
    }
    render(createElement(ProviderButton, button));
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://www.primevideo.com/search?phrase=Dune%3A%20Part%20Two",
    );
  });
});

describe("captured provider-link evidence", () => {
  it("renders exactly 20 known-title fallbacks with genuinely reachable captured URLs", () => {
    expect(evidence.cases).toHaveLength(20);
    expect(new Set(evidence.cases.map((entry) => entry.title))).toHaveLength(20);

    for (const entry of evidence.cases) {
      const movie = item({
        id: `fixture-${entry.tmdbId}`,
        medium: "movie",
        title: entry.title,
        creators: [],
        ref: { medium: "movie", tmdbId: entry.tmdbId },
      });
      const composition = composeGetIt(movie, []);
      expect(composition.emptyState?.message).toBe("Not streamable right now.");
      expect(composition.items).toHaveLength(1);
      expect(composition.items[0]).toMatchObject({
        provider: { id: "prime-video" },
        suffix: "check rentals",
      });

      render(createElement(ProviderButton, composition.items[0]));
      const renderedHref = screen.getByRole("link").getAttribute("href");
      expect(renderedHref, entry.title).toBe(entry.requestedUrl);
      expect(entry.status).toBeGreaterThanOrEqual(200);
      expect(entry.status).toBeLessThan(400);
      expect(entry.redirects).toBeGreaterThanOrEqual(0);
      expect(new URL(entry.effectiveUrl).protocol).toBe("https:");
      cleanup();
    }
  });
});
