import { beforeEach, describe, expect, it } from "vitest";
import { itemSeedSchema } from "../types";
import {
  itunesLookupEmpty,
  itunesLookupOneShow,
  itunesMalformedResponse,
  itunesMalformedShow,
  itunesSearchTwoShows,
  itunesSearchWithEpisode,
  spotifySearchMatch,
  spotifySearchNoMatch,
  spotifySearchWrongPublisher,
  spotifyTokenResponse,
} from "./podcasts.fixtures";
import {
  LruCache,
  cacheControlForEnvelope,
  httpStatusForEnvelope,
  lookupPodcastShow,
  resetPodcastProviderCaches,
  resolveSpotifyShow,
  searchPodcastShows,
  spotifyConfigFromEnv,
  spotifyShowUrl,
  type SpotifyConfig,
} from "./podcasts";

const spotifyConfig: SpotifyConfig = {
  clientId: "fixture-client-id",
  clientSecret: "fixture-client-secret",
};

/**
 * A fixture-backed fetch: routes by URL, records every call, and throws a
 * network-style TypeError for anything unrouted.
 */
function makeFetch(
  routes: Array<[match: (url: URL) => boolean, respond: (url: URL) => Response]>,
) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(href);
    const url = new URL(href);
    for (const [match, respond] of routes) {
      if (match(url)) return respond(url);
    }
    throw new TypeError(`fetch failed: no route for ${href}`);
  }) as typeof fetch;
  return { impl, calls };
}

const isItunesSearch = (url: URL) =>
  url.hostname === "itunes.apple.com" && url.pathname === "/search";
const isItunesLookup = (url: URL) =>
  url.hostname === "itunes.apple.com" && url.pathname === "/lookup";
const isSpotifyToken = (url: URL) => url.hostname === "accounts.spotify.com";
const isSpotifySearch = (url: URL) => url.hostname === "api.spotify.com";

/** Spotify routes that answer the token flow and per-title show search. */
const spotifyRoutes: Array<[(url: URL) => boolean, (url: URL) => Response]> = [
  [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
  [
    isSpotifySearch,
    (url) =>
      Response.json(
        url.searchParams.get("q") === "99% Invisible"
          ? spotifySearchMatch
          : spotifySearchNoMatch,
      ),
  ],
];

beforeEach(() => {
  resetPodcastProviderCaches();
});

describe("deep-link builders", () => {
  it("builds the Spotify-first show URL from a spotifyShowId (PLAN §5)", () => {
    expect(spotifyShowUrl("2vjzeqQaEPCn7UBM8mNa1a")).toBe(
      "https://open.spotify.com/show/2vjzeqQaEPCn7UBM8mNa1a",
    );
  });
});

describe("LruCache", () => {
  it("evicts the least-recently-used entry beyond capacity", () => {
    const cache = new LruCache<number>(2, 1000);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    expect(cache.get("a", 1)).toBe(1); // refreshes a's recency
    cache.set("c", 3, 1); // over capacity: b is now the oldest
    expect(cache.get("b", 2)).toBeUndefined();
    expect(cache.get("a", 2)).toBe(1);
    expect(cache.get("c", 2)).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("expires entries after the TTL", () => {
    const cache = new LruCache<number>(4, 1000);
    cache.set("a", 1, 0);
    expect(cache.get("a", 999)).toBe(1);
    expect(cache.get("a", 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("searchPodcastShows — iTunes normalization", () => {
  it("normalizes shows to valid ItemSeeds: appleId, title, publisher, largest artwork", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
    ]);
    const result = await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seeds).toHaveLength(2);
    for (const seed of result.seeds) {
      expect(itemSeedSchema.safeParse(seed).success).toBe(true);
      expect(seed.medium).toBe("podcast");
    }
    const [first, second] = result.seeds;
    expect(first.title).toBe("99% Invisible");
    expect(first.creators).toEqual(["Roman Mars"]);
    expect(first.ref.appleId).toBe(394775318);
    expect(first.artUrl).toContain("600x600bb.jpg");
    // Second show has no 600px art: falls back to the largest available.
    expect(second.ref.appleId).toBe(299436963);
    expect(second.artUrl).toContain("100x100bb.jpg");
  });

  it("drops episode results — shows only, ever (decision #2)", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchWithEpisode)],
    ]);
    const result = await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0].title).toBe("99% Invisible");
    expect(JSON.stringify(result)).not.toContain("The Power Broker #99");
  });

  it("rejects an empty query as bad-request without touching the network", async () => {
    const { impl, calls } = makeFetch([]);
    const result = await searchPodcastShows("   ", { fetchImpl: impl });
    expect(result).toEqual({
      ok: false,
      error: { code: "bad-request", message: expect.any(String) },
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects an out-of-range limit as bad-request", async () => {
    const { impl } = makeFetch([]);
    const result = await searchPodcastShows("99pi", {
      fetchImpl: impl,
      limit: 100,
    });
    expect(!result.ok && result.error.code).toBe("bad-request");
  });
});

describe("searchPodcastShows — graceful degradation", () => {
  it("types an unreachable upstream", async () => {
    const { impl } = makeFetch([]); // every fetch throws
    const result = await searchPodcastShows("99pi", { fetchImpl: impl });
    expect(!result.ok && result.error.code).toBe("upstream-unreachable");
  });

  it("types an upstream HTTP error", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => new Response("oops", { status: 503 })],
    ]);
    const result = await searchPodcastShows("99pi", { fetchImpl: impl });
    expect(!result.ok && result.error.code).toBe("upstream-unreachable");
  });

  it("types a non-JSON upstream body as malformed", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => new Response("<html>teapot</html>")],
    ]);
    const result = await searchPodcastShows("99pi", { fetchImpl: impl });
    expect(!result.ok && result.error.code).toBe("upstream-malformed");
  });

  it("types a shape-violating response as malformed (zod on the envelope)", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => Response.json(itunesMalformedResponse)],
    ]);
    const result = await searchPodcastShows("99pi", { fetchImpl: impl });
    expect(!result.ok && result.error.code).toBe("upstream-malformed");
  });

  it("types a shape-violating show result as malformed (zod on each result)", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => Response.json(itunesMalformedShow)],
    ]);
    const result = await searchPodcastShows("99pi", { fetchImpl: impl });
    expect(!result.ok && result.error.code).toBe("upstream-malformed");
  });
});

describe("searchPodcastShows — Spotify resolution", () => {
  it("unconfigured: seeds ship without spotifyShowId, marker is spotify-unconfigured, Spotify is never called", async () => {
    const { impl, calls } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
    ]);
    const result = await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotify).toBe("spotify-unconfigured");
    for (const seed of result.seeds) {
      expect(seed.ref.spotifyShowId).toBeUndefined();
    }
    expect(calls.filter((url) => url.includes("spotify"))).toHaveLength(0);
  });

  it("configured: matched seed gains spotifyShowId and Spotify's description; unmatched seed ships without", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
      ...spotifyRoutes,
    ]);
    const result = await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
      spotify: spotifyConfig,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotify).toBe("spotify-resolved");
    const [matched, unmatched] = result.seeds;
    expect(matched.ref.spotifyShowId).toBe("2vjzeqQaEPCn7UBM8mNa1a");
    expect(spotifyShowUrl(matched.ref.spotifyShowId as string)).toBe(
      "https://open.spotify.com/show/2vjzeqQaEPCn7UBM8mNa1a",
    );
    expect(matched.description).toContain("Design is everywhere");
    expect(unmatched.ref.spotifyShowId).toBeUndefined();
    expect(itemSeedSchema.safeParse(matched).success).toBe(true);
  });

  it("configured but Spotify down: seeds still ship, marker is spotify-unavailable", async () => {
    const { impl } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
      [isSpotifyToken, () => new Response("nope", { status: 500 })],
    ]);
    const result = await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
      spotify: spotifyConfig,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotify).toBe("spotify-unavailable");
    expect(result.seeds).toHaveLength(2);
    for (const seed of result.seeds) {
      expect(seed.ref.spotifyShowId).toBeUndefined();
    }
  });

  it("reuses the client-credentials token across resolutions", async () => {
    const { impl, calls } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
      ...spotifyRoutes,
    ]);
    await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
      spotify: spotifyConfig,
    });
    expect(
      calls.filter((url) => url.includes("accounts.spotify.com")),
    ).toHaveLength(1);
  });
});

describe("searchPodcastShows — caching", () => {
  it("serves a repeat query from the LRU without refetching, normalizing case and whitespace", async () => {
    const { impl, calls } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
    ]);
    const first = await searchPodcastShows("99% Invisible", {
      fetchImpl: impl,
    });
    const second = await searchPodcastShows("  99%   INVISIBLE ", {
      fetchImpl: impl,
    });
    expect(first).toEqual(second);
    expect(calls.filter((url) => url.includes("itunes"))).toHaveLength(1);
  });

  it("never caches a failure", async () => {
    const { impl, calls } = makeFetch([]);
    await searchPodcastShows("99pi", { fetchImpl: impl });
    await searchPodcastShows("99pi", { fetchImpl: impl });
    expect(calls).toHaveLength(2);
  });

  it("keeps distinct cache keys for non-Latin queries — and still caches each (Unicode round-trip)", async () => {
    const koreanResponse = {
      resultCount: 1,
      results: [itunesSearchTwoShows.results[1]],
    };
    const { impl, calls } = makeFetch([
      [
        isItunesSearch,
        (url) =>
          Response.json(
            url.searchParams.get("term") === "日本語ポッドキャスト"
              ? itunesSearchTwoShows
              : koreanResponse,
          ),
      ],
    ]);
    const japanese = await searchPodcastShows("日本語ポッドキャスト", {
      fetchImpl: impl,
    });
    const korean = await searchPodcastShows("한국어 팟캐스트", {
      fetchImpl: impl,
    });
    expect(japanese.ok && japanese.seeds).toHaveLength(2);
    expect(korean.ok && korean.seeds).toHaveLength(1);
    expect(calls).toHaveLength(2); // one upstream hit each — no cross-serving
    const japaneseAgain = await searchPodcastShows("日本語ポッドキャスト", {
      fetchImpl: impl,
    });
    expect(japaneseAgain).toEqual(japanese);
    expect(calls).toHaveLength(2); // repeat served from cache
  });

  it("falls back to the raw term for queries that normalize to nothing (emoji-only)", async () => {
    const singleShow = {
      resultCount: 1,
      results: [itunesSearchTwoShows.results[0]],
    };
    const { impl, calls } = makeFetch([
      [
        isItunesSearch,
        (url) =>
          Response.json(
            url.searchParams.get("term") === "🎧"
              ? itunesSearchTwoShows
              : singleShow,
          ),
      ],
    ]);
    const headphones = await searchPodcastShows("🎧", { fetchImpl: impl });
    const microphone = await searchPodcastShows("🎙", { fetchImpl: impl });
    expect(headphones.ok && headphones.seeds).toHaveLength(2);
    expect(microphone.ok && microphone.seeds).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("does not cache a spotify-unavailable degraded success", async () => {
    const { impl, calls } = makeFetch([
      [isItunesSearch, () => Response.json(itunesSearchTwoShows)],
      [isSpotifyToken, () => new Response("nope", { status: 500 })],
    ]);
    await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
      spotify: spotifyConfig,
    });
    await searchPodcastShows("99% invisible", {
      fetchImpl: impl,
      spotify: spotifyConfig,
    });
    expect(calls.filter((url) => url.includes("itunes"))).toHaveLength(2);
  });
});

describe("lookupPodcastShow", () => {
  it("returns the single show as a valid seed", async () => {
    const { impl } = makeFetch([
      [isItunesLookup, () => Response.json(itunesLookupOneShow)],
    ]);
    const result = await lookupPodcastShow(394775318, { fetchImpl: impl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotify).toBe("spotify-unconfigured");
    expect(result.seed.ref.appleId).toBe(394775318);
    expect(itemSeedSchema.safeParse(result.seed).success).toBe(true);
  });

  it("types an unknown appleId as not-found", async () => {
    const { impl } = makeFetch([
      [isItunesLookup, () => Response.json(itunesLookupEmpty)],
    ]);
    const result = await lookupPodcastShow(1, { fetchImpl: impl });
    expect(!result.ok && result.error.code).toBe("not-found");
  });

  it("rejects a non-positive, non-integer, or unsafe appleId as bad-request", async () => {
    const { impl, calls } = makeFetch([]);
    expect(
      (await lookupPodcastShow(0, { fetchImpl: impl })).ok,
    ).toBe(false);
    expect(
      (await lookupPodcastShow(1.5, { fetchImpl: impl })).ok,
    ).toBe(false);
    expect(
      (await lookupPodcastShow(2 ** 53, { fetchImpl: impl })).ok,
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("serves a repeat lookup from the LRU", async () => {
    const { impl, calls } = makeFetch([
      [isItunesLookup, () => Response.json(itunesLookupOneShow)],
    ]);
    await lookupPodcastShow(394775318, { fetchImpl: impl });
    await lookupPodcastShow(394775318, { fetchImpl: impl });
    expect(calls).toHaveLength(1);
  });
});

describe("resolveSpotifyShow", () => {
  it("prefers the publisher match among equal titles", async () => {
    const twoSameName = {
      shows: {
        items: [
          {
            id: "3wrong3wrong3wrong3wro",
            name: "The Daily",
            publisher: "Someone Else",
          },
          {
            id: "4right4right4right4rig",
            name: "The Daily",
            publisher: "The New York Times",
          },
        ],
      },
    };
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json(twoSameName)],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "The Daily", publisher: "The New York Times" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({
      status: "resolved",
      spotifyShowId: "4right4right4right4rig",
    });
  });

  it("vetoes a same-title show from a different publisher — absent beats wrong", async () => {
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json(spotifySearchWrongPublisher)],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "The Daily", publisher: "The New York Times" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({ status: "unmatched" });
  });

  it("never matches a non-Latin title against unrelated results (no empty-string collapse)", async () => {
    const unrelated = {
      shows: {
        items: [
          { id: "6nope6nope6nope6nope6n", name: "Something Else", publisher: "X" },
        ],
      },
    };
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json(unrelated)],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "日本語ポッドキャスト" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({ status: "unmatched" });
  });

  it("matches a CJK title exactly", async () => {
    const cjk = {
      shows: {
        items: [
          {
            id: "7yesyes7yesyes7yesyes7",
            name: "日本語ポッドキャスト",
            publisher: "放送局",
          },
        ],
      },
    };
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json(cjk)],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "日本語ポッドキャスト", publisher: "放送局" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({
      status: "resolved",
      spotifyShowId: "7yesyes7yesyes7yesyes7",
    });
  });

  it("returns unmatched for a title that normalizes to nothing, even against equally degenerate results", async () => {
    const degenerate = {
      shows: {
        items: [{ id: "8punct8punct8punct8pun", name: "???", publisher: "Y" }],
      },
    };
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json(degenerate)],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "!!!" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({ status: "unmatched" });
  });

  it("returns unmatched when no result shares the title", async () => {
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json(spotifySearchNoMatch)],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "The Memory Palace", publisher: "Nate DiMeo" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({ status: "unmatched" });
  });

  it("returns unavailable on a malformed Spotify body", async () => {
    const { impl } = makeFetch([
      [isSpotifyToken, () => Response.json(spotifyTokenResponse)],
      [isSpotifySearch, () => Response.json({ shows: "nope" })],
    ]);
    const resolution = await resolveSpotifyShow(
      { title: "99% Invisible" },
      spotifyConfig,
      impl,
    );
    expect(resolution).toEqual({ status: "unavailable" });
  });
});

describe("spotifyConfigFromEnv", () => {
  it("treats absent or empty credentials as unconfigured", () => {
    expect(spotifyConfigFromEnv({})).toBeUndefined();
    expect(
      spotifyConfigFromEnv({ SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "" }),
    ).toBeUndefined();
    expect(
      spotifyConfigFromEnv({ SPOTIFY_CLIENT_ID: " ", SPOTIFY_CLIENT_SECRET: "s" }),
    ).toBeUndefined();
  });

  it("returns trimmed credentials when both are present", () => {
    expect(
      spotifyConfigFromEnv({
        SPOTIFY_CLIENT_ID: " id ",
        SPOTIFY_CLIENT_SECRET: "secret",
      }),
    ).toEqual({ clientId: "id", clientSecret: "secret" });
  });
});

describe("envelope → HTTP mapping", () => {
  it("maps every error code to its status and success to 200", () => {
    const ok = { ok: true as const, seeds: [], spotify: "spotify-unconfigured" as const };
    expect(httpStatusForEnvelope(ok)).toBe(200);
    const codes = [
      ["bad-request", 400],
      ["not-found", 404],
      ["upstream-malformed", 502],
      ["upstream-unreachable", 503],
    ] as const;
    for (const [code, status] of codes) {
      expect(
        httpStatusForEnvelope({ ok: false, error: { code, message: "m" } }),
      ).toBe(status);
    }
  });

  it("makes successes CDN-cacheable, degraded successes short-and-private, failures uncacheable", () => {
    const ok = { ok: true as const, seeds: [], spotify: "spotify-resolved" as const };
    expect(cacheControlForEnvelope(ok)).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    expect(
      cacheControlForEnvelope({
        ok: true,
        seeds: [],
        spotify: "spotify-unavailable",
      }),
    ).toBe("private, max-age=60");
    expect(
      cacheControlForEnvelope({
        ok: false,
        error: { code: "upstream-unreachable", message: "m" },
      }),
    ).toBe("no-store");
  });
});
