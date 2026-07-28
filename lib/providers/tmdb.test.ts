import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as detailRoute } from "../../app/api/providers/tmdb/detail/route";
import { GET as nowPlayingRoute } from "../../app/api/providers/tmdb/now-playing/route";
import { GET as searchRoute } from "../../app/api/providers/tmdb/search/route";
import { GET as watchProvidersRoute } from "../../app/api/providers/tmdb/watch-providers/route";
import { availabilitySchema, itemIdSchema, itemSeedSchema } from "../types";
import {
  clearTmdbCache,
  getTmdbDetail,
  getTmdbNowPlaying,
  getTmdbWatchProviders,
  searchTmdb,
  TMDB_ATTRIBUTION,
  TMDB_CACHE_TTL_MS,
} from "./tmdb";
import movieDetailFixture from "./tmdb.fixtures/movie-detail.json";
import nowPlayingFixture from "./tmdb.fixtures/now-playing.json";
import nowPlayingPage2Fixture from "./tmdb.fixtures/now-playing-page-2.json";
import searchMovieFixture from "./tmdb.fixtures/search-movie.json";
import searchTvFixture from "./tmdb.fixtures/search-tv.json";
import tvDetailFixture from "./tmdb.fixtures/tv-detail.json";
import watchProvidersFixture from "./tmdb.fixtures/watch-providers.json";

/**
 * Fixture-first suite (EPICS wave-3 egress note): api.themoviedb.org is
 * unreachable from the build environment, so upstream responses are served
 * from hand-built-to-spec fixtures in ./tmdb.fixtures/ (provenance noted in
 * each file). The live smoke at the bottom auto-skips without TMDB_API_KEY.
 */

/**
 * Serves fixtures by upstream path; records every request for assertions.
 * A key may pin a page (`"/3/movie/now_playing?page=2"`); a bare path key
 * matches any page.
 */
function stubTmdbFetch(
  routes: Record<string, unknown>,
  fallback?: () => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: URL | RequestInfo): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const page = url.searchParams.get("page") ?? "1";
    const body =
      routes[`${url.pathname}?page=${page}`] ?? routes[url.pathname];
    if (body !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (fallback !== undefined) return Promise.resolve(fallback());
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestedUrls(mock: ReturnType<typeof vi.fn>): URL[] {
  return mock.mock.calls.map((call) => {
    const input = call[0] as URL | RequestInfo;
    return new URL(input instanceof Request ? input.url : String(input));
  });
}

const anItemId = itemIdSchema.parse("item-under-test");

/** Captured before the beforeEach stub so the live smoke uses the real key. */
const LIVE_API_KEY = process.env.TMDB_API_KEY;

beforeEach(() => {
  vi.stubEnv("TMDB_API_KEY", "test-api-key");
  clearTmdbCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("searchTmdb", () => {
  it("normalizes movie results to ItemSeed and sends the key server-side", async () => {
    const mock = stubTmdbFetch({ "/3/search/movie": searchMovieFixture });
    const result = await searchTmdb("heat", "movie");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Row 3 of the fixture has an empty title and cannot form an ItemSeed —
    // it is dropped, not fatal.
    expect(result.data.seeds).toHaveLength(2);
    expect(result.data.degraded).toBeUndefined();

    const [heat, heat2] = result.data.seeds;
    expect(heat).toMatchObject({
      medium: "movie",
      ref: { medium: "movie", tmdbId: 949 },
      title: "Heat",
      year: 1995,
      artUrl: "https://image.tmdb.org/t/p/w500/umSVjVdbVwtx5ryCA2QXL44Durm.jpg",
    });
    expect(heat?.description).toMatch(/^Obsessive master thief/);
    // Native TMDB 0–10 scale, unconverted (contract stores source scale).
    expect(heat?.communityRating).toEqual({ average: 7.916, count: 7534 });
    // Search payloads carry no runtime; detail fills it.
    expect(heat !== undefined && "runtimeMinutes" in heat).toBe(true);
    if (heat === undefined || !("runtimeMinutes" in heat)) return;
    expect(heat.runtimeMinutes).toBeUndefined();

    // Empty release_date, null poster, zero votes → fields absent, not junk.
    expect(heat2?.year).toBeUndefined();
    expect(heat2?.artUrl).toBeUndefined();
    expect(heat2?.description).toBeUndefined();
    expect(heat2?.communityRating).toBeUndefined();

    for (const seed of result.data.seeds) {
      expect(itemSeedSchema.safeParse(seed).success).toBe(true);
    }

    const [url] = requestedUrls(mock);
    expect(url?.searchParams.get("query")).toBe("heat");
    expect(url?.searchParams.get("api_key")).toBe("test-api-key");
  });

  it("normalizes tv results (name → title, first_air_date → year)", async () => {
    stubTmdbFetch({ "/3/search/tv": searchTvFixture });
    const result = await searchTmdb("the bear", "tv");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seeds[0]).toMatchObject({
      medium: "tv",
      ref: { medium: "tv", tmdbId: 136315 },
      title: "The Bear",
      year: 2022,
      communityRating: { average: 8.28, count: 1379 },
    });
    for (const seed of result.data.seeds) {
      expect(itemSeedSchema.safeParse(seed).success).toBe(true);
    }
  });

  it("searches both namespaces for scope 'all', movies first", async () => {
    stubTmdbFetch({
      "/3/search/movie": searchMovieFixture,
      "/3/search/tv": searchTvFixture,
    });
    const result = await searchTmdb("bear", "all");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seeds.map((seed) => seed.medium)).toEqual([
      "movie",
      "movie",
      "tv",
      "tv",
    ]);
    expect(result.data.degraded).toBeUndefined();
  });

  it("degrades partially: a dead tv namespace does not blank movie results", async () => {
    stubTmdbFetch(
      { "/3/search/movie": searchMovieFixture },
      () => new Response("upstream boom", { status: 500 }),
    );
    const result = await searchTmdb("heat", "all");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seeds).toHaveLength(2);
    expect(
      result.data.seeds.every((seed) => seed.medium === "movie"),
    ).toBe(true);
    // The envelope names the dead namespace so the UI can distinguish
    // "no TV results" from "TV search down".
    expect(result.data.degraded).toEqual(["tv"]);
  });

  it("rejects a blank query without touching the network", async () => {
    const mock = stubTmdbFetch({});
    const result = await searchTmdb("   ");

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-request", message: expect.any(String) as string },
    });
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("getTmdbDetail", () => {
  it("movie: fills runtimeMinutes and director-only creators via credits", async () => {
    const mock = stubTmdbFetch({ "/3/movie/949": movieDetailFixture });
    const result = await getTmdbDetail("movie", 949);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seed).toMatchObject({
      medium: "movie",
      title: "Heat",
      runtimeMinutes: 170,
      creators: ["Michael Mann"], // Writer/Producer crew rows excluded
    });
    expect(result.data.seasons).toBeUndefined();
    expect(itemSeedSchema.safeParse(result.data.seed).success).toBe(true);

    const [url] = requestedUrls(mock);
    expect(url?.searchParams.get("append_to_response")).toBe("credits");
  });

  it("tv: fills episode runtime, created_by, and the seasons sidecar", async () => {
    stubTmdbFetch({ "/3/tv/136315": tvDetailFixture });
    const result = await getTmdbDetail("tv", 136315);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seed).toMatchObject({
      medium: "tv",
      title: "The Bear",
      runtimeMinutes: 38,
      creators: ["Christopher Storer"],
    });
    // The Item contract has no seasons field — carried alongside the seed.
    expect(result.data.seasons).toBe(4);
  });

  it("maps an unknown id to a typed not-found", async () => {
    stubTmdbFetch({});
    const result = await getTmdbDetail("movie", 999999999);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not-found");
  });

  it("rejects a non-positive id without touching the network", async () => {
    const mock = stubTmdbFetch({});
    const result = await getTmdbDetail("movie", -1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid-request");
    expect(mock).not.toHaveBeenCalled();
  });

  it("maps a payload that violates the documented shape to upstream-invalid", async () => {
    stubTmdbFetch({ "/3/movie/949": { totally: "unexpected" } });
    const result = await getTmdbDetail("movie", 949);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("upstream-invalid");
  });
});

describe("getTmdbWatchProviders", () => {
  it("maps US flatrate/rent/buy to contract availability kinds", async () => {
    stubTmdbFetch({ "/3/movie/949/watch/providers": watchProvidersFixture });
    const result = await getTmdbWatchProviders("movie", 949);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { offers, attributionLink } = result.data;
    expect(offers.map((offer) => offer.availability.kind)).toEqual([
      "subscription",
      "subscription",
      "rent",
      "rent",
      "buy",
      "buy",
    ]);
    // US block only — the GB flatrate row must not leak in.
    expect(attributionLink).toBe(
      "https://www.themoviedb.org/movie/949-heat/watch?locale=US",
    );
    expect(
      offers.some((offer) => offer.providerName === "Amazon Prime Video"),
    ).toBe(false);

    const netflix = offers[0];
    expect(netflix).toMatchObject({
      tmdbProviderId: 8,
      providerName: "Netflix",
      availability: {
        kind: "subscription",
        providerId: "netflix",
        region: "US",
      },
    });
    // Deep links are E5.2's job (registry templates) — absent here.
    expect(
      offers.every(
        (offer) => !("url" in offer.availability),
      ),
    ).toBe(true);
    // Multi-word names slugify into registry keys.
    expect(
      offers.map((offer) =>
        "providerId" in offer.availability
          ? offer.availability.providerId
          : undefined,
      ),
    ).toContain("amazon-video");

    // Contract proof: seed + an ItemId parses as a contract Availability.
    for (const offer of offers) {
      const parsed = availabilitySchema.safeParse({
        ...offer.availability,
        itemId: anItemId,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("returns empty offers, not an error, when a title has no US offers", async () => {
    stubTmdbFetch({
      "/3/tv/136315/watch/providers": { id: 136315, results: {} },
    });
    const result = await getTmdbWatchProviders("tv", 136315);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.offers).toEqual([]);
    expect(result.data.attributionLink).toBeUndefined();
  });
});

describe("getTmdbNowPlaying", () => {
  it("fetches every page of the US slate, deduped, as theater availability", async () => {
    const mock = stubTmdbFetch({
      "/3/movie/now_playing?page=1": nowPlayingFixture,
      "/3/movie/now_playing?page=2": nowPlayingPage2Fixture,
    });
    const result = await getTmdbNowPlaying();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // total_pages=2 → both pages fetched; Superman repeats across the page
    // boundary and must appear once.
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.data).toHaveLength(3);
    expect(
      result.data.map((entry) => entry.seed.ref.tmdbId),
    ).toEqual([1061474, 552524, 1234821]);

    const [superman] = result.data;
    expect(superman?.seed).toMatchObject({
      medium: "movie",
      ref: { medium: "movie", tmdbId: 1061474 },
      title: "Superman",
      year: 2026,
    });
    expect(superman?.availability.kind).toBe("theater");
    // The showtimes deep link is E5.4's job — absent here.
    expect(
      result.data.every((entry) => !("fandangoUrl" in entry.availability)),
    ).toBe(true);

    for (const entry of result.data) {
      expect(itemSeedSchema.safeParse(entry.seed).success).toBe(true);
      const parsed = availabilitySchema.safeParse({
        ...entry.availability,
        itemId: anItemId,
      });
      expect(parsed.success).toBe(true);
    }

    // The merged slate is cached whole — a repeat call fetches no pages.
    const repeat = await getTmdbNowPlaying();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(repeat).toEqual(result);
  });
});

describe("graceful degradation", () => {
  it("returns provider-unconfigured without a key and never calls upstream", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    const mock = stubTmdbFetch({ "/3/movie/now_playing": nowPlayingFixture });

    for (const result of [
      await searchTmdb("heat", "movie"),
      await getTmdbDetail("movie", 949),
      await getTmdbWatchProviders("movie", 949),
      await getTmdbNowPlaying(),
    ]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("provider-unconfigured");
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it("maps a network failure to provider-unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const result = await searchTmdb("heat", "movie");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider-unreachable");
  });

  it("maps an upstream 5xx to provider-error", async () => {
    stubTmdbFetch({}, () => new Response("boom", { status: 503 }));
    const result = await getTmdbNowPlaying();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider-error");
  });

  it("maps a non-JSON body to upstream-invalid", async () => {
    stubTmdbFetch(
      {},
      () => new Response("<html>maintenance</html>", { status: 200 }),
    );
    const result = await getTmdbNowPlaying();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("upstream-invalid");
  });
});

describe("LRU cache", () => {
  it("serves a repeat request from cache within the TTL", async () => {
    const mock = stubTmdbFetch({ "/3/search/movie": searchMovieFixture });
    const first = await searchTmdb("heat", "movie");
    const second = await searchTmdb("heat", "movie");

    expect(mock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("refetches after the TTL expires", async () => {
    vi.useFakeTimers();
    const mock = stubTmdbFetch({ "/3/search/movie": searchMovieFixture });

    await searchTmdb("heat", "movie");
    vi.advanceTimersByTime(TMDB_CACHE_TTL_MS.search + 1);
    await searchTmdb("heat", "movie");

    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("never caches failures — the next request retries upstream", async () => {
    let failing = true;
    const mock = vi.fn((): Promise<Response> => {
      if (failing) return Promise.resolve(new Response("boom", { status: 500 }));
      return Promise.resolve(
        new Response(JSON.stringify(searchMovieFixture), {
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", mock);

    const first = await searchTmdb("heat", "movie");
    expect(first.ok).toBe(false);

    failing = false;
    const second = await searchTmdb("heat", "movie");
    expect(second.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("API routes", () => {
  const base = "http://nightstand.test/api/providers/tmdb";

  it("search: 200 with envelope body and CDN cache headers", async () => {
    stubTmdbFetch({ "/3/search/movie": searchMovieFixture });
    const response = await searchRoute(
      new Request(`${base}/search?q=heat&scope=movie`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=3600",
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: { seeds: unknown[] };
    };
    expect(body.ok).toBe(true);
    expect(body.data.seeds).toHaveLength(2);
  });

  it("search: 400 invalid-request envelope for a bad scope", async () => {
    const mock = stubTmdbFetch({});
    const response = await searchRoute(
      new Request(`${base}/search?q=heat&scope=vhs`),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe("invalid-request");
    expect(mock).not.toHaveBeenCalled();
  });

  it("detail: 400 for a bad medium, 200 for a good lookup", async () => {
    stubTmdbFetch({ "/3/movie/949": movieDetailFixture });

    const bad = await detailRoute(
      new Request(`${base}/detail?medium=book&tmdbId=949`),
    );
    expect(bad.status).toBe(400);

    const good = await detailRoute(
      new Request(`${base}/detail?medium=movie&tmdbId=949`),
    );
    expect(good.status).toBe(200);
  });

  it("watch-providers: 200 with US offers", async () => {
    stubTmdbFetch({ "/3/movie/949/watch/providers": watchProvidersFixture });
    const response = await watchProvidersRoute(
      new Request(`${base}/watch-providers?medium=movie&tmdbId=949`),
    );

    expect(response.status).toBe(200);
    // SWR halved vs s-maxage: availability has a ~24h staleness budget (E5.1).
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=43200",
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: { offers: unknown[] };
    };
    expect(body.data.offers).toHaveLength(6);
  });

  it("now-playing: 200 with the full deduped theatrical slate", async () => {
    stubTmdbFetch({
      "/3/movie/now_playing?page=1": nowPlayingFixture,
      "/3/movie/now_playing?page=2": nowPlayingPage2Fixture,
    });
    const response = await nowPlayingRoute();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: unknown[] };
    expect(body.data).toHaveLength(3);
  });

  it("routes surface provider-unconfigured as 503, uncached", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    stubTmdbFetch({});
    const response = await nowPlayingRoute();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("provider-unconfigured");
  });
});

describe("attribution", () => {
  it("exports TMDB's required notice for E3.3/footer to render", () => {
    expect(TMDB_ATTRIBUTION).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
  });
});

/**
 * Live smoke — runs only where TMDB_API_KEY is configured (production CI);
 * auto-skips here, where the key is absent and the host is blocked. A
 * transient unreachable host also skips rather than fails.
 */
describe.skipIf(!LIVE_API_KEY)("live TMDB smoke", () => {
  beforeEach(() => {
    // The global beforeEach stubs a fake key; the smoke needs the real one.
    vi.stubEnv("TMDB_API_KEY", LIVE_API_KEY ?? "");
  });

  it("search/movie returns a normalized seed for a known title", async (ctx) => {
    clearTmdbCache();
    const result = await searchTmdb("heat", "movie");
    if (!result.ok && result.error.code === "provider-unreachable") {
      ctx.skip();
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seeds.length).toBeGreaterThan(0);
    expect(itemSeedSchema.safeParse(result.data.seeds[0]).success).toBe(true);
  });

  it("watch/providers returns parseable US offers for Heat", async (ctx) => {
    const result = await getTmdbWatchProviders("movie", 949);
    if (!result.ok && result.error.code === "provider-unreachable") {
      ctx.skip();
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const offer of result.data.offers) {
      expect(
        availabilitySchema.safeParse({
          ...offer.availability,
          itemId: anItemId,
        }).success,
      ).toBe(true);
    }
  });
});
