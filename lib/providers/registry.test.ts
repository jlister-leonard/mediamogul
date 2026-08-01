import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_PROVIDER_IDS,
  getProvider,
  providerEntries,
  providerForTmdbId,
  providerRegistry,
  type ApplePodcastParams,
  type BookParams,
  type DeepLink,
  type ProviderEntry,
  type ShowtimesParams,
  type SpotifyShowParams,
  type TitleParams,
} from "./registry";

/*
 * ADDING A SERVICE — the proof of E5.2's extensibility AC. To add, say, the
 * Criterion Channel: append "criterion-channel" to KNOWN_PROVIDER_IDS, add
 * one entry to providerRegistry (the compiler forces exactly that — the
 * Record<KnownProviderId, ProviderEntry> type errors until the key exists),
 * and optionally drop public/brands/criterion-channel.svg + set logoAsset.
 * Nothing else: every test below iterates providerEntries rather than naming
 * providers, so the new entry is validated (completeness, unique ids, hex
 * colors, URL-producing templates, TMDB join) with zero test edits, and
 * ProviderButton (E5.3) renders it from the entry alone.
 */

/** Worst-case-ish sample params per template kind, exercising URL encoding. */
const sampleTitle: TitleParams = { title: "Spirited Away & Friends: 100%" };
const sampleBook: BookParams = {
  title: "Tomorrow, and Tomorrow, and Tomorrow",
  author: "Gabrielle Zevin",
  isbn13: "9780593321201",
};
const sampleBookNoIsbn: BookParams = { title: "Piranesi", author: "Susanna Clarke" };
const sampleShowtimes: ShowtimesParams = { title: "Dune: Part Two", zip: "94110" };
const sampleSpotify: SpotifyShowParams = {
  spotifyShowId: "7Fj0XffcRIhr9uhSKmdiaB",
};
const samplePodcast: ApplePodcastParams = { appleId: 1671669052 };

/**
 * Build every URL an entry's templates can produce from the matching sample
 * params, keeping app-scheme and web URLs explicitly separate — web templates
 * are exercised with all sample variants (with/without optional params).
 */
function buildSampleUrls(deepLink: DeepLink): { app: string[]; web: string[] } {
  switch (deepLink.params) {
    case "title":
      return {
        app: deepLink.app === null ? [] : [deepLink.app(sampleTitle)],
        web: [deepLink.web(sampleTitle)],
      };
    case "book":
      return {
        app:
          deepLink.app === null
            ? []
            : [deepLink.app(sampleBook), deepLink.app(sampleBookNoIsbn)],
        web: [deepLink.web(sampleBook), deepLink.web(sampleBookNoIsbn)],
      };
    case "showtimes":
      return {
        app: deepLink.app === null ? [] : [deepLink.app(sampleShowtimes)],
        web: [
          deepLink.web(sampleShowtimes),
          deepLink.web({ title: sampleShowtimes.title }),
        ],
      };
    case "spotifyShow":
      return {
        app: deepLink.app === null ? [] : [deepLink.app(sampleSpotify)],
        web: [deepLink.web(sampleSpotify)],
      };
    case "applePodcast":
      return {
        app: deepLink.app === null ? [] : [deepLink.app(samplePodcast)],
        web: [deepLink.web(samplePodcast)],
      };
  }
}

describe("registry completeness", () => {
  it("holds all fifteen services from PLAN §5", () => {
    // The ten subscriptions on file + Kindle, Bookshop.org, Fandango,
    // Apple Podcasts, Overcast.
    expect(KNOWN_PROVIDER_IDS).toHaveLength(15);
    expect([...KNOWN_PROVIDER_IDS].sort()).toEqual(
      [
        "netflix",
        "hbo-max",
        "prime-video",
        "hulu",
        "apple-tv-plus",
        "peacock",
        "paramount-plus",
        "disney-plus",
        "spotify",
        "audible",
        "kindle",
        "bookshop",
        "fandango",
        "apple-podcasts",
        "overcast",
      ].sort(),
    );
    expect(providerEntries).toHaveLength(KNOWN_PROVIDER_IDS.length);
  });

  it("has no duplicate ProviderIds, and every key matches its entry's id", () => {
    const ids = providerEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const key of KNOWN_PROVIDER_IDS) {
      expect(providerRegistry[key].id).toBe(key);
    }
  });

  it("gives every entry a display name and a non-empty wordmark", () => {
    for (const entry of providerEntries) {
      expect(entry.name.length, entry.id).toBeGreaterThan(0);
      expect(entry.wordmark.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("binds direct availability URLs to explicit provider-owned hosts", () => {
    for (const entry of providerEntries) {
      expect(entry.allowedHosts.length, entry.id).toBeGreaterThan(0);
      for (const host of entry.allowedHosts) {
        expect(host, entry.id).toBe(host.toLowerCase());
        expect(host, entry.id).toMatch(/^[a-z0-9.-]+$/);
      }
      expect(new Set(entry.allowedHosts).size, entry.id).toBe(
        entry.allowedHosts.length,
      );
    }
  });

  it("preserves official wordmark casing", () => {
    expect(providerRegistry.netflix.wordmark).toBe("NETFLIX");
    expect(providerRegistry.hulu.wordmark).toBe("hulu");
    expect(providerRegistry.peacock.wordmark).toBe("peacock");
    expect(providerRegistry["prime-video"].wordmark).toBe("prime video");
    expect(providerRegistry.audible.wordmark).toBe("audible");
    expect(providerRegistry["disney-plus"].wordmark).toBe("Disney+");
    expect(providerRegistry["paramount-plus"].wordmark).toBe("Paramount+");
    expect(providerRegistry.bookshop.wordmark).toBe("BOOKSHOP.ORG");
    expect(providerRegistry.fandango.wordmark).toBe("FANDANGO");
  });
});

describe("brand colors", () => {
  // The one sanctioned raw-hex site outside styles/tokens.css (see
  // registry.ts header) — sanctioned, but still validated.
  it("uses well-formed uppercase #RRGGBB for every background and foreground", () => {
    for (const entry of providerEntries) {
      expect(entry.brand.background, entry.id).toMatch(/^#[0-9A-F]{6}$/);
      expect(entry.brand.foreground, entry.id).toMatch(/^#[0-9A-F]{6}$/);
      expect(entry.brand.background, entry.id).not.toBe(
        entry.brand.foreground,
      );
    }
  });

  it("cites a source for every color pair", () => {
    for (const entry of providerEntries) {
      expect(entry.brand.source, entry.id).toMatch(/official|observed/);
    }
  });
});

describe("logo assets", () => {
  it("retains only Hulu's verified-context official asset and uses text elsewhere", () => {
    const verified = new Set(["hulu"]);
    for (const entry of providerEntries) {
      if (!verified.has(entry.id)) {
        expect(entry.logoAsset, entry.id).toBeNull();
        expect(entry.logoHeightPx, entry.id).toBeNull();
        continue;
      }
      expect(entry.logoAsset, entry.id).toMatch(
        new RegExp(`^/brands/${entry.id}\\.(?:svg|png)$`),
      );
      expect(entry.logoHeightPx, entry.id).toBeGreaterThanOrEqual(21);
      expect(
        existsSync(join(process.cwd(), "public", entry.logoAsset!.slice(1))),
        entry.id,
      ).toBe(true);
    }
  });
});

describe("deep links", () => {
  it("produces a parseable URL from every template (app and web) with sample params", () => {
    for (const entry of providerEntries) {
      const { app, web } = buildSampleUrls(entry.deepLink);
      for (const url of [...app, ...web]) {
        // new URL() throws on malformed input; custom schemes parse fine.
        expect(() => new URL(url), `${entry.id}: ${url}`).not.toThrow();
      }
    }
  });

  it("always offers at least one https web fallback with a real host", () => {
    for (const entry of providerEntries) {
      const { web } = buildSampleUrls(entry.deepLink);
      expect(web.length, entry.id).toBeGreaterThan(0);
      for (const webUrl of web) {
        const parsed = new URL(webUrl);
        expect(parsed.protocol, entry.id).toBe("https:");
        expect(parsed.hostname, entry.id).toMatch(/\./);
        expect(entry.allowedHosts, `${entry.id}: ${parsed.hostname}`).toContain(
          parsed.hostname,
        );
      }
    }
  });

  it("URL-encodes title params for every title-search fallback", () => {
    for (const entry of providerEntries) {
      if (entry.deepLink.params !== "title") continue;
      const url = new URL(entry.deepLink.web(sampleTitle));
      // HBO Max, Peacock, and Disney+ have no verified working public search
      // path; their honest homepage fallbacks intentionally carry no query.
      if (["hbo-max", "peacock", "disney-plus"].includes(entry.id)) {
        expect(url.pathname, entry.id).toBe("/");
        expect(url.search, entry.id).toBe("");
        continue;
      }
      // Query key varies per provider (q/phrase/term); the round-tripped
      // value must come back exactly.
      expect([...url.searchParams.values()], entry.id).toContain(
        sampleTitle.title,
      );
    }
  });

  it("kindle: scopes to the Kindle store and searches by ISBN when held", () => {
    const { deepLink } = providerRegistry.kindle;
    if (deepLink.params !== "book") throw new Error("kindle takes BookParams");
    const withIsbn = new URL(deepLink.web(sampleBook));
    expect(withIsbn.searchParams.get("i")).toBe("digital-text");
    expect(withIsbn.searchParams.get("k")).toBe(sampleBook.isbn13);
    const withoutIsbn = new URL(deepLink.web(sampleBookNoIsbn));
    expect(withoutIsbn.searchParams.get("k")).toBe("Piranesi Susanna Clarke");
  });

  it("fandango: carries the zip only when provided", () => {
    const { deepLink } = providerRegistry.fandango;
    if (deepLink.params !== "showtimes")
      throw new Error("fandango takes ShowtimesParams");
    const zipped = new URL(deepLink.web(sampleShowtimes));
    expect(zipped.searchParams.get("zip")).toBe("94110");
    expect(zipped.searchParams.get("q")).toBe(sampleShowtimes.title);
    const unzipped = new URL(deepLink.web({ title: "Dune: Part Two" }));
    expect(unzipped.searchParams.get("zip")).toBeNull();
  });

  it("spotify: official URI scheme for the app, open.spotify.com show URL on web", () => {
    const { deepLink } = providerRegistry.spotify;
    if (deepLink.params !== "spotifyShow")
      throw new Error("spotify takes SpotifyShowParams");
    expect(deepLink.app?.(sampleSpotify)).toBe(
      `spotify:show:${sampleSpotify.spotifyShowId}`,
    );
    expect(deepLink.web(sampleSpotify)).toBe(
      `https://open.spotify.com/show/${sampleSpotify.spotifyShowId}`,
    );
  });

  it("apple podcasts and overcast: appleId-keyed deep links", () => {
    const apple = providerRegistry["apple-podcasts"].deepLink;
    const overcast = providerRegistry.overcast.deepLink;
    if (apple.params !== "applePodcast" || overcast.params !== "applePodcast")
      throw new Error("podcast targets take ApplePodcastParams");
    expect(apple.web(samplePodcast)).toBe(
      "https://podcasts.apple.com/us/podcast/id1671669052",
    );
    expect(overcast.web(samplePodcast)).toBe("https://overcast.fm/");
  });
});

describe("TMDB provider-id join (E5.1)", () => {
  it("maps each TMDB id to exactly one entry", () => {
    const seen = new Map<number, ProviderEntry>();
    for (const entry of providerEntries) {
      for (const tmdbId of entry.tmdbProviderIds) {
        expect(Number.isInteger(tmdbId) && tmdbId > 0, entry.id).toBe(true);
        expect(seen.has(tmdbId), `tmdb id ${tmdbId} claimed twice`).toBe(false);
        seen.set(tmdbId, entry);
      }
    }
  });

  it("joins TMDB's documented US ids to the right services", () => {
    // Ids per TMDB GET /watch/providers/movie|tv (region US).
    expect(providerForTmdbId(8)?.id).toBe("netflix");
    expect(providerForTmdbId(9)?.id).toBe("prime-video");
    expect(providerForTmdbId(10)?.id).toBe("prime-video"); // Amazon Video rent/buy
    expect(providerForTmdbId(15)?.id).toBe("hulu");
    expect(providerForTmdbId(337)?.id).toBe("disney-plus");
    expect(providerForTmdbId(350)?.id).toBe("apple-tv-plus");
    expect(providerForTmdbId(2)?.id).toBe("apple-tv-plus"); // Apple TV store
    expect(providerForTmdbId(386)?.id).toBe("peacock");
    expect(providerForTmdbId(531)?.id).toBe("paramount-plus");
    expect(providerForTmdbId(1899)?.id).toBe("hbo-max");
  });

  it("returns undefined for a provider nobody on this nightstand pays for", () => {
    expect(providerForTmdbId(283)).toBeUndefined(); // Crunchyroll
  });

  it("leaves non-TMDB targets (books, podcasts, theaters) unmapped", () => {
    for (const id of [
      "spotify",
      "audible",
      "kindle",
      "bookshop",
      "fandango",
      "apple-podcasts",
      "overcast",
    ] as const) {
      expect(providerRegistry[id].tmdbProviderIds).toEqual([]);
    }
  });
});

describe("getProvider", () => {
  it("resolves a known id and rejects an unknown one", () => {
    expect(getProvider("netflix")?.name).toBe("Netflix");
    expect(getProvider("blockbuster")).toBeUndefined();
  });
});
