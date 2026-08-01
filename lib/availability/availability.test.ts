import { describe, expect, it, vi } from "vitest";
import {
  itemSchema,
  providerIdSchema,
  type Availability,
  type Item,
} from "../types";
import type {
  TmdbNowPlayingEntry,
  TmdbProviderOffer,
  TmdbResult,
  TmdbWatchProviders,
} from "../providers/tmdb";
import type { AudibleCatalogResult } from "./audible";
import {
  AVAILABILITY_TTL_MS,
  SUBSCRIBED_PROVIDER_IDS,
  TMDB_TIER_EVIDENCE,
  resolveItemAvailability,
  type AvailabilityDependencies,
} from ".";

const NOW = new Date("2026-08-01T16:00:00.000Z");
const FRESH = "2026-08-01T15:00:00.000Z";
const STALE = "2026-07-30T15:00:00.000Z";

const movie = itemSchema.parse({
  id: "item-heat",
  medium: "movie",
  title: "Heat",
  creators: ["Michael Mann"],
  ref: { medium: "movie", tmdbId: 949 },
}) as Extract<Item, { medium: "movie" }>;

function providerOffer(
  tmdbProviderId: number,
  kind: "subscription" | "rent" | "buy",
  options: { priceUsd?: number; url?: string; fetchedAt?: string } = {},
): TmdbProviderOffer {
  return {
    tmdbProviderId,
    providerName: `Provider ${tmdbProviderId}`,
    availability: {
      kind,
      providerId: providerIdSchema.parse(`raw-${tmdbProviderId}`),
      region: "US",
      fetchedAt: options.fetchedAt ?? FRESH,
      ...(options.priceUsd !== undefined && { priceUsd: options.priceUsd }),
      ...(options.url !== undefined && { url: options.url }),
    },
  };
}

const okWatch = (offers: TmdbProviderOffer[]): TmdbResult<TmdbWatchProviders> => ({
  ok: true,
  data: { offers },
});

const okTheaters = (
  entries: TmdbNowPlayingEntry[] = [],
): TmdbResult<TmdbNowPlayingEntry[]> => ({ ok: true, data: entries });

function theaterEntry(tmdbId = 949, fetchedAt = FRESH): TmdbNowPlayingEntry {
  return {
    seed: {
      medium: "movie",
      title: tmdbId === 949 ? "Heat" : "Other",
      creators: [],
      ref: { medium: "movie", tmdbId },
    },
    availability: { kind: "theater", region: "US", fetchedAt },
  };
}

function dependencies(options: {
  cached?: Availability[];
  refreshedAt?: string;
  writeResult?: boolean;
  watch?: TmdbResult<TmdbWatchProviders>;
  theaters?: TmdbResult<TmdbNowPlayingEntry[]>;
} = {}): AvailabilityDependencies & {
  readState: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  watchProviders: ReturnType<typeof vi.fn>;
  nowPlaying: ReturnType<typeof vi.fn>;
  audibleCatalog: ReturnType<typeof vi.fn>;
} {
  return {
    readState: vi.fn(async () => ({
      offers: options.cached ?? [],
      ...(options.refreshedAt
        ? { refresh: { itemId: movie.id, fetchedAt: options.refreshedAt } }
        : {}),
    })),
    write: vi.fn(async () => options.writeResult ?? true),
    watchProviders: vi.fn(async () => options.watch ?? okWatch([])),
    nowPlaying: vi.fn(async () => options.theaters ?? okTheaters()),
    audibleCatalog: vi.fn(async (): Promise<AudibleCatalogResult> => ({ ok: true })),
    now: () => NOW,
  };
}

describe("E5.1 availability", () => {
  it("defines exactly the ten subscribed services and documents unverified ad-tier ids", () => {
    expect(SUBSCRIBED_PROVIDER_IDS).toHaveLength(10);
    expect(new Set(SUBSCRIBED_PROVIDER_IDS).size).toBe(10);
    expect(TMDB_TIER_EVIDENCE.verifiedLive).toBe(false);
    expect(TMDB_TIER_EVIDENCE.reason).toContain("TMDB_API_KEY");
    expect(TMDB_TIER_EVIDENCE.unknowns[0]).toContain("were asserted");
  });

  it("folds storefront ids while preserving payload kind, direct URL, prices, and first duplicate", async () => {
    const direct = "https://www.primevideo.com/detail/heat";
    const deps = dependencies({
      watch: okWatch([
        // Provider 10 is Amazon's store. It remains rent because the payload
        // put it in rent; mapping it to Prime must not turn it subscription.
        providerOffer(10, "rent", { priceUsd: 3.99, url: direct }),
        providerOffer(10, "rent", { priceUsd: 5.99 }),
        providerOffer(10, "buy", { priceUsd: 14.99 }),
        providerOffer(9, "subscription"),
        providerOffer(8, "subscription"),
        providerOffer(999999, "subscription"),
      ]),
    });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.offers).toEqual([
      expect.objectContaining({
        kind: "rent",
        providerId: "prime-video",
        priceUsd: 3.99,
        url: direct,
      }),
      expect.objectContaining({ kind: "buy", providerId: "prime-video", priceUsd: 14.99 }),
      expect.objectContaining({ kind: "subscription", providerId: "prime-video" }),
      expect.objectContaining({ kind: "subscription", providerId: "netflix" }),
    ]);
    expect(result.offers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ providerId: "raw-10" })]),
    );
    expect(result.onSomethingIPayFor).toBe(true);
    expect(deps.write).toHaveBeenCalledWith(
      movie.id,
      result.offers,
      NOW.toISOString(),
    );
  });

  it("does not call rent-only Prime an included subscription", async () => {
    const deps = dependencies({
      watch: okWatch([providerOffer(10, "rent", { priceUsd: 3.99 })]),
    });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.offers).toEqual([
      expect.objectContaining({ kind: "rent", providerId: "prime-video" }),
    ]);
    expect(result.onSomethingIPayFor).toBe(false);
  });

  it("uses a fresh 24h cache with visible fetch and stale-after metadata", async () => {
    const cached: Availability[] = [{
      itemId: movie.id,
      kind: "subscription",
      providerId: providerIdSchema.parse("netflix"),
      region: "US",
      fetchedAt: FRESH,
    }];
    const deps = dependencies({ cached, refreshedAt: FRESH });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.metadata).toMatchObject({
      fetchedAt: FRESH,
      staleAfter: "2026-08-02T15:00:00.000Z",
      stale: false,
      cache: "hit",
    });
    expect(Date.parse(result.metadata.staleAfter!) - Date.parse(FRESH)).toBe(
      AVAILABILITY_TTL_MS,
    );
    expect(deps.watchProviders).not.toHaveBeenCalled();
    expect(deps.nowPlaying).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });

  it("refreshes stale data and returns stale cached offers when either provider fails", async () => {
    const cached: Availability[] = [{
      itemId: movie.id,
      kind: "subscription",
      providerId: providerIdSchema.parse("netflix"),
      region: "US",
      fetchedAt: STALE,
    }];
    const deps = dependencies({
      cached,
      refreshedAt: STALE,
      watch: {
        ok: false,
        error: { code: "provider-unreachable", message: "TMDB did not respond" },
      },
      theaters: okTheaters([theaterEntry()]),
    });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.offers).toEqual(cached);
    expect(result.metadata).toMatchObject({
      stale: true,
      cache: "stale-fallback",
      theater: "unknown",
      failures: [{ source: "watch-providers", code: "provider-unreachable" }],
    });
    expect(deps.write).not.toHaveBeenCalled();
  });

  it("shows the oldest offer freshness even when the successful-check marker is newer", async () => {
    const oldOffer = "2026-07-30T15:00:00.000Z";
    const deps = dependencies({
      cached: [{
        itemId: movie.id,
        kind: "subscription",
        providerId: providerIdSchema.parse("netflix"),
        region: "US",
        fetchedAt: oldOffer,
      }],
      refreshedAt: FRESH,
      watch: {
        ok: false,
        error: { code: "provider-unreachable", message: "offline" },
      },
    });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.metadata).toMatchObject({
      fetchedAt: oldOffer,
      checkedAt: FRESH,
      staleAfter: "2026-07-31T15:00:00.000Z",
      stale: true,
      cache: "stale-fallback",
    });
    expect(deps.watchProviders).toHaveBeenCalledOnce();
  });

  it("durably treats a successful empty result as fresh instead of refetching", async () => {
    const deps = dependencies({ cached: [], refreshedAt: FRESH });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.offers).toEqual([]);
    expect(result.metadata).toMatchObject({
      fetchedAt: FRESH,
      stale: false,
      cache: "hit",
      theater: "unknown",
    });
    expect(deps.watchProviders).not.toHaveBeenCalled();
    expect(deps.nowPlaying).not.toHaveBeenCalled();
  });

  it("refreshes at the exact 24-hour boundary", async () => {
    const deps = dependencies({
      cached: [],
      refreshedAt: "2026-07-31T16:00:00.000Z",
    });

    const result = await resolveItemAvailability(movie, deps);

    expect(deps.watchProviders).toHaveBeenCalledOnce();
    expect(deps.nowPlaying).toHaveBeenCalledOnce();
    expect(deps.write).toHaveBeenCalledWith(movie.id, [], NOW.toISOString());
    expect(result.metadata).toMatchObject({ stale: false, cache: "refreshed" });
  });

  it("infers theater only from presence; absence from the capped feed remains unknown", async () => {
    const presentDeps = dependencies({ theaters: okTheaters([theaterEntry()]) });
    const present = await resolveItemAvailability(movie, presentDeps);
    expect(present.metadata.theater).toBe("present");
    expect(present.offers).toContainEqual(
      expect.objectContaining({ kind: "theater", itemId: movie.id }),
    );

    const absentDeps = dependencies({ theaters: okTheaters([theaterEntry(123)]) });
    const absent = await resolveItemAvailability(movie, absentDeps);
    expect(absent.metadata.theater).toBe("unknown");
    expect(absent.offers.some((offer) => offer.kind === "theater")).toBe(false);
  });

  it("reports provider failures on an uncached item without claiming unavailability", async () => {
    const failure = {
      ok: false,
      error: { code: "provider-error", message: "TMDB returned 503" },
    } as const;
    const deps = dependencies({ watch: failure, theaters: failure });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.offers).toEqual([]);
    expect(result.metadata).toMatchObject({
      stale: true,
      cache: "miss",
      theater: "unknown",
    });
    expect(result.metadata.failures.map((entry) => entry.source)).toEqual([
      "watch-providers",
      "now-playing",
    ]);
    expect(deps.write).not.toHaveBeenCalled();
  });

  it("coalesces concurrent refreshes for the same item into one provider call", async () => {
    let release!: (result: TmdbResult<TmdbWatchProviders>) => void;
    const waiting = new Promise<TmdbResult<TmdbWatchProviders>>((resolve) => {
      release = resolve;
    });
    const deps = dependencies();
    deps.watchProviders.mockImplementation(async () => waiting);

    const first = resolveItemAvailability(movie, deps);
    const second = resolveItemAvailability(movie, deps);
    await vi.waitFor(() => expect(deps.watchProviders).toHaveBeenCalledOnce());
    release(okWatch([providerOffer(8, "subscription")]));

    expect(await first).toEqual(await second);
    expect(deps.write).toHaveBeenCalledOnce();
  });

  it("returns the newer stored state when its delayed commit loses the timestamp fence", async () => {
    const latest: Availability = {
      itemId: movie.id,
      kind: "subscription",
      providerId: providerIdSchema.parse("netflix"),
      region: "US",
      fetchedAt: "2026-08-01T16:01:00.000Z",
    };
    const deps = dependencies({
      watch: okWatch([providerOffer(10, "rent", { fetchedAt: STALE })]),
      writeResult: false,
    });
    deps.readState
      .mockResolvedValueOnce({ offers: [] })
      .mockResolvedValueOnce({
        offers: [latest],
        refresh: { itemId: movie.id, fetchedAt: latest.fetchedAt },
      });

    const result = await resolveItemAvailability(movie, deps);

    expect(result.offers).toEqual([latest]);
    expect(result.metadata).toMatchObject({
      checkedAt: latest.fetchedAt,
      cache: "hit",
    });
    expect(result.offers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rent" })]),
    );
  });

  it("creates a direct Spotify subscription offer from a canonical show id", async () => {
    const podcast = itemSchema.parse({
      id: "item-acquired",
      medium: "podcast",
      title: "Acquired",
      creators: ["Ben Gilbert", "David Rosenthal"],
      ref: { medium: "podcast", spotifyShowId: "7Fj0XffcRIhr9uhSKmdiaB" },
    });
    const deps = dependencies();
    deps.readState.mockResolvedValue({ offers: [] });

    const result = await resolveItemAvailability(podcast, deps);

    expect(result.offers).toEqual([expect.objectContaining({
      kind: "subscription",
      providerId: "spotify",
      url: "https://open.spotify.com/show/7Fj0XffcRIhr9uhSKmdiaB",
    })]);
    expect(result.onSomethingIPayFor).toBe(true);
    expect(deps.watchProviders).not.toHaveBeenCalled();
  });

  it("creates an Audible offer only from a strictly resolved catalog product", async () => {
    const book = itemSchema.parse({
      id: "item-bad-blood",
      medium: "book",
      title: "Bad Blood",
      creators: ["John Carreyrou"],
      ref: { medium: "book", isbn13: "9781524731656" },
    });
    const deps = dependencies();
    deps.readState.mockResolvedValue({ offers: [] });
    deps.audibleCatalog.mockResolvedValue({
      ok: true,
      product: {
        asin: "B07C8GVTB5",
        title: "Bad Blood",
        authors: [{ name: "John Carreyrou" }],
      },
    });

    const result = await resolveItemAvailability(book, deps);

    expect(result.offers).toEqual([expect.objectContaining({
      kind: "buy",
      providerId: "audible",
      url: "https://www.audible.com/pd/B07C8GVTB5",
    })]);
    expect(result.onSomethingIPayFor).toBe(false);
  });
});
