import { z } from "zod";
import {
  itemSeedSchema,
  providerIdSchema,
  type Availability,
  type ItemSeed,
  type ProviderId,
} from "../types";

/**
 * TMDB provider (E2.2) — movies + TV metadata, US watch providers, and the
 * `now_playing` theatrical feed. All logic lives here; the routes under
 * `app/api/providers/tmdb/*` are thin envelopes over these functions.
 *
 * Upstream is TMDB API v3 (`api.themoviedb.org/3`). Every upstream payload is
 * zod-parsed before normalization — nothing downstream of this module ever
 * touches a raw TMDB shape (`MediaRef` doc in `lib/types/media.ts`).
 */

/* ------------------------------------------------------------------ */
/* Attribution                                                        */
/* ------------------------------------------------------------------ */

/**
 * TMDB's terms of use require this exact notice wherever TMDB data appears.
 *
 * HANDOFF (E3.3 / footer): the app must render this string, accompanied by
 * the official TMDB logo (from TMDB's brand page, bundled locally per the
 * E5.2 no-hotlinking rule), on every surface that shows TMDB data — at
 * minimum the detail page and the app footer. This constant is the single
 * source of the wording; do not restate it elsewhere.
 */
export const TMDB_ATTRIBUTION =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

/**
 * TMDB serves images from a configured base URL + size segment (the
 * `/configuration` endpoint). The value below is TMDB's documented,
 * long-stable default; a live `/configuration` round-trip per request would
 * cost more than it protects against. Overridable via env if TMDB ever moves
 * its CDN.
 */
const TMDB_IMAGE_BASE_URL =
  process.env.TMDB_IMAGE_BASE_URL ?? "https://image.tmdb.org/t/p/";

/** w500 balances retina poster rendering against transfer size. */
const POSTER_SIZE = "w500";

/** All lookups are region US (PLAN §5, decision #8). */
const REGION = "US" as const;

const FETCH_TIMEOUT_MS = 8_000;

/* ------------------------------------------------------------------ */
/* Typed result envelope                                              */
/* ------------------------------------------------------------------ */

/**
 * Graceful-degradation contract: every provider function returns one of
 * these, never throws. Routes map codes to HTTP statuses; the UI can switch
 * on `code` without string-matching messages.
 */
export type TmdbErrorCode =
  | "provider-unconfigured"
  | "provider-unreachable"
  | "provider-error"
  | "upstream-invalid"
  | "not-found"
  | "invalid-request";

export type TmdbResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: TmdbErrorCode; message: string } };

function fail<T>(code: TmdbErrorCode, message: string): TmdbResult<T> {
  return { ok: false, error: { code, message } };
}

/* ------------------------------------------------------------------ */
/* LRU cache                                                          */
/* ------------------------------------------------------------------ */

/**
 * In-process LRU with per-entry TTL. Serverless instances are ephemeral, so
 * this is a best-effort warm-instance cache; the durable layer is the
 * `Cache-Control: s-maxage` headers the routes set (CDN-side).
 */
class LruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency: Map iterates in insertion order, so re-insert.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

const cache = new LruCache<unknown>(256);

/** Test seam — resets the warm-instance cache between cases. */
export function clearTmdbCache(): void {
  cache.clear();
}

/** TTLs per endpoint, exported so routes derive `s-maxage` from the same numbers. */
export const TMDB_CACHE_TTL_MS = {
  search: 60 * 60 * 1000, // 1h — result ordering shifts with popularity
  detail: 24 * 60 * 60 * 1000, // 24h — runtime/credits are effectively static
  watchProviders: 24 * 60 * 60 * 1000, // 24h — matches E5.1's staleness budget
  nowPlaying: 12 * 60 * 60 * 1000, // 12h — the theatrical slate changes on Fridays
} as const;

/* ------------------------------------------------------------------ */
/* Upstream schemas (TMDB v3 documented shapes)                       */
/* ------------------------------------------------------------------ */

/** `GET /search/movie` result entry; also the row shape of `/movie/now_playing`. */
const upstreamMovieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  release_date: z.string().nullish(),
  overview: z.string().nullish(),
  poster_path: z.string().nullish(),
  vote_average: z.number(),
  vote_count: z.number().int().nonnegative(),
});

/** `GET /search/tv` result entry. */
const upstreamTvSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  first_air_date: z.string().nullish(),
  overview: z.string().nullish(),
  poster_path: z.string().nullish(),
  vote_average: z.number(),
  vote_count: z.number().int().nonnegative(),
});

const pagedSchema = <T extends z.ZodType>(result: T) =>
  z.object({
    page: z.number().int(),
    results: z.array(result),
    total_pages: z.number().int(),
    total_results: z.number().int(),
  });

const searchMoviePageSchema = pagedSchema(upstreamMovieSchema);
const searchTvPageSchema = pagedSchema(upstreamTvSchema);
const nowPlayingPageSchema = pagedSchema(upstreamMovieSchema);

/** `GET /movie/{id}?append_to_response=credits` — credits carry the director. */
const movieDetailSchema = upstreamMovieSchema.extend({
  runtime: z.number().int().nullish(),
  credits: z
    .object({
      crew: z.array(z.object({ name: z.string(), job: z.string() })),
    })
    .optional(),
});

/** `GET /tv/{id}` — creators ship on the base payload as `created_by`. */
const tvDetailSchema = upstreamTvSchema.extend({
  episode_run_time: z.array(z.number().int()).nullish(),
  number_of_seasons: z.number().int().nullish(),
  created_by: z.array(z.object({ name: z.string() })).nullish(),
});

/** One offer inside `GET /{movie,tv}/{id}/watch/providers` (JustWatch data). */
const watchProviderEntrySchema = z.object({
  provider_id: z.number().int(),
  provider_name: z.string().min(1),
});

/**
 * The US region block of the watch-providers payload. `link` is TMDB's
 * JustWatch attribution page for the title, not a per-provider deep link.
 * Zod's default strip semantics drop the other ~50 region keys unread.
 */
const watchProvidersSchema = z.object({
  id: z.number().int().positive(),
  results: z.object({
    US: z
      .object({
        link: z.string().optional(),
        flatrate: z.array(watchProviderEntrySchema).optional(),
        rent: z.array(watchProviderEntrySchema).optional(),
        buy: z.array(watchProviderEntrySchema).optional(),
      })
      .optional(),
  }),
});

/* ------------------------------------------------------------------ */
/* Fetch layer                                                        */
/* ------------------------------------------------------------------ */

async function tmdbFetch(
  path: string,
  params: Readonly<Record<string, string>>,
): Promise<TmdbResult<unknown>> {
  const apiKey = process.env.TMDB_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    return fail(
      "provider-unconfigured",
      "TMDB_API_KEY is not configured; set it in the deployment environment (PLAN §8).",
    );
  }

  const url = new URL(`${TMDB_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // Deliberate transport choice: `api_key` in the query string is v3's
  // documented mechanism for the v3 key PLAN §8 has Jeremy paste; the
  // `Authorization: Bearer` alternative officially takes TMDB's separate v4
  // Read Access Token, not the v3 key. Tradeoff accepted: the key can
  // surface in upstream/proxy request logs — server-side only, never in a
  // client-visible URL.
  url.searchParams.set("api_key", apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return fail(
      "provider-unreachable",
      "TMDB did not respond; try again shortly.",
    );
  }

  if (response.status === 404) {
    return fail("not-found", "TMDB has no record for that id.");
  }
  if (!response.ok) {
    return fail(
      "provider-error",
      `TMDB responded with status ${String(response.status)}.`,
    );
  }

  try {
    return { ok: true, data: (await response.json()) as unknown };
  } catch {
    return fail("upstream-invalid", "TMDB returned a non-JSON body.");
  }
}

/**
 * Fetch + zod-parse + normalize, with the LRU in front. Only successes are
 * cached; failures always retry upstream. `normalize` returning `undefined`
 * signals a payload that parsed but could not be normalized (e.g. an empty
 * title), which degrades to a typed `upstream-invalid` — never a throw.
 */
async function cachedTmdbCall<Upstream, Data>(
  cacheKey: string,
  ttlMs: number,
  path: string,
  params: Readonly<Record<string, string>>,
  schema: z.ZodType<Upstream>,
  normalize: (upstream: Upstream) => Data | undefined,
): Promise<TmdbResult<Data>> {
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return { ok: true, data: hit as Data };

  const fetched = await tmdbFetch(path, params);
  if (!fetched.ok) return fetched;

  const parsed = schema.safeParse(fetched.data);
  const data = parsed.success ? normalize(parsed.data) : undefined;
  if (data === undefined) {
    return fail(
      "upstream-invalid",
      `TMDB payload for ${path} did not match the documented shape.`,
    );
  }

  cache.set(cacheKey, data, ttlMs);
  return { ok: true, data };
}

/* ------------------------------------------------------------------ */
/* Normalization                                                      */
/* ------------------------------------------------------------------ */

function toYear(date: string | null | undefined): number | undefined {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(date ?? "");
  return match ? Number(match[1]) : undefined;
}

function toArtUrl(posterPath: string | null | undefined): string | undefined {
  return posterPath
    ? `${TMDB_IMAGE_BASE_URL}${POSTER_SIZE}${posterPath}`
    : undefined;
}

function toDescription(
  overview: string | null | undefined,
): string | undefined {
  const trimmed = overview?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * TMDB's `vote_average` is on a 0–10 scale; the contract stores the source's
 * native scale (`CommunityRating` doc in `lib/types/item.ts`), so it passes
 * through unconverted. Zero votes means no community verdict, not a 0.0 one.
 */
function toCommunityRating(
  voteAverage: number,
  voteCount: number,
): ItemSeed["communityRating"] {
  return voteCount > 0 ? { average: voteAverage, count: voteCount } : undefined;
}

function toRuntimeMinutes(
  runtime: number | null | undefined,
): number | undefined {
  return typeof runtime === "number" && runtime > 0 ? runtime : undefined;
}

type MovieSeed = Extract<ItemSeed, { medium: "movie" }>;
type TvSeed = Extract<ItemSeed, { medium: "tv" }>;

interface SeedExtras {
  runtimeMinutes?: number;
  creators?: string[];
}

/**
 * The final safeParse is the contract gate: a TMDB row that survives the
 * upstream schema but cannot form a valid `ItemSeed` (empty title, malformed
 * poster URL) yields `undefined` — search drops the row, detail degrades to
 * `upstream-invalid`.
 */
function movieSeed(
  movie: z.infer<typeof upstreamMovieSchema>,
  extras: SeedExtras = {},
): MovieSeed | undefined {
  const parsed = itemSeedSchema.safeParse({
    medium: "movie",
    ref: { medium: "movie", tmdbId: movie.id },
    title: movie.title,
    creators: extras.creators ?? [],
    year: toYear(movie.release_date),
    artUrl: toArtUrl(movie.poster_path),
    description: toDescription(movie.overview),
    communityRating: toCommunityRating(movie.vote_average, movie.vote_count),
    runtimeMinutes: extras.runtimeMinutes,
  });
  return parsed.success && parsed.data.medium === "movie"
    ? parsed.data
    : undefined;
}

function tvSeed(
  tv: z.infer<typeof upstreamTvSchema>,
  extras: SeedExtras = {},
): TvSeed | undefined {
  const parsed = itemSeedSchema.safeParse({
    medium: "tv",
    ref: { medium: "tv", tmdbId: tv.id },
    title: tv.name,
    creators: extras.creators ?? [],
    year: toYear(tv.first_air_date),
    artUrl: toArtUrl(tv.poster_path),
    description: toDescription(tv.overview),
    communityRating: toCommunityRating(tv.vote_average, tv.vote_count),
    runtimeMinutes: extras.runtimeMinutes,
  });
  return parsed.success && parsed.data.medium === "tv"
    ? parsed.data
    : undefined;
}

function present<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

export const tmdbMediumSchema = z.enum(["movie", "tv"]);
export type TmdbMedium = z.infer<typeof tmdbMediumSchema>;

export const tmdbSearchScopeSchema = z.enum(["movie", "tv", "all"]);
export type TmdbSearchScope = z.infer<typeof tmdbSearchScopeSchema>;

export interface TmdbSearchResults {
  seeds: ItemSeed[];
  /**
   * Namespaces that failed while the other still answered (scope `all`
   * only). Lets the UI say "TV search is down" instead of implying "no TV
   * results". Absent when every searched namespace succeeded.
   */
  degraded?: TmdbMedium[];
}

/**
 * `GET /search/movie` + `GET /search/tv`, normalized to `ItemSeed[]`.
 *
 * Search payloads carry no runtime, seasons, or credits — those land via
 * `getTmdbDetail`. Results keep TMDB's popularity order, movies before TV
 * when scope is `all`; E2.4 groups and dedupes across providers.
 */
export async function searchTmdb(
  query: string,
  scope: TmdbSearchScope = "all",
): Promise<TmdbResult<TmdbSearchResults>> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return fail("invalid-request", "Search needs a non-empty query.");
  }

  const searchOne = (medium: TmdbMedium): Promise<TmdbResult<ItemSeed[]>> =>
    medium === "movie"
      ? cachedTmdbCall(
          `search/movie:${trimmed.toLowerCase()}`,
          TMDB_CACHE_TTL_MS.search,
          "/search/movie",
          { query: trimmed, include_adult: "false", region: REGION },
          searchMoviePageSchema,
          (page) => present(page.results.map((movie) => movieSeed(movie))),
        )
      : cachedTmdbCall(
          `search/tv:${trimmed.toLowerCase()}`,
          TMDB_CACHE_TTL_MS.search,
          "/search/tv",
          { query: trimmed, include_adult: "false" },
          searchTvPageSchema,
          (page) => present(page.results.map((tv) => tvSeed(tv))),
        );

  if (scope !== "all") {
    const single = await searchOne(scope);
    return single.ok ? { ok: true, data: { seeds: single.data } } : single;
  }

  const [movies, tv] = await Promise.all([searchOne("movie"), searchOne("tv")]);
  // Partial degradation: if one namespace fails, the other's results still
  // serve — a dead /search/tv must not blank movie search — and `degraded`
  // names the failed namespace so the UI can say so.
  if (!movies.ok && !tv.ok) return movies;
  const degraded: TmdbMedium[] = [
    ...(movies.ok ? [] : ["movie" as const]),
    ...(tv.ok ? [] : ["tv" as const]),
  ];
  return {
    ok: true,
    data: {
      seeds: [...(movies.ok ? movies.data : []), ...(tv.ok ? tv.data : [])],
      ...(degraded.length > 0 ? { degraded } : {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Detail                                                             */
/* ------------------------------------------------------------------ */

/**
 * `seasons` rides alongside the seed because the `Item` contract has no
 * seasons field (TV stores per-episode `runtimeMinutes` only) — recorded as
 * a finding for the orchestrator; the detail page can render it from this
 * envelope without a contract change.
 */
export interface TmdbDetail {
  seed: MovieSeed | TvSeed;
  /** TV only: TMDB `number_of_seasons`. */
  seasons?: number;
}

/** `GET /movie/{id}?append_to_response=credits` or `GET /tv/{id}`, normalized. */
export async function getTmdbDetail(
  medium: TmdbMedium,
  tmdbId: number,
): Promise<TmdbResult<TmdbDetail>> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return fail("invalid-request", "tmdbId must be a positive integer.");
  }

  if (medium === "movie") {
    return cachedTmdbCall(
      `movie:${String(tmdbId)}`,
      TMDB_CACHE_TTL_MS.detail,
      `/movie/${String(tmdbId)}`,
      { append_to_response: "credits" },
      movieDetailSchema,
      (movie): TmdbDetail | undefined => {
        const seed = movieSeed(movie, {
          runtimeMinutes: toRuntimeMinutes(movie.runtime),
          creators:
            movie.credits?.crew
              .filter((member) => member.job === "Director")
              .map((member) => member.name) ?? [],
        });
        return seed === undefined ? undefined : { seed };
      },
    );
  }

  return cachedTmdbCall(
    `tv:${String(tmdbId)}`,
    TMDB_CACHE_TTL_MS.detail,
    `/tv/${String(tmdbId)}`,
    {},
    tvDetailSchema,
    (tv): TmdbDetail | undefined => {
      const seed = tvSeed(tv, {
        runtimeMinutes: toRuntimeMinutes(tv.episode_run_time?.[0]),
        creators: (tv.created_by ?? []).map((creator) => creator.name),
      });
      if (seed === undefined) return undefined;
      const seasons = tv.number_of_seasons;
      return typeof seasons === "number" && seasons > 0
        ? { seed, seasons }
        : { seed };
    },
  );
}

/* ------------------------------------------------------------------ */
/* Watch providers                                                    */
/* ------------------------------------------------------------------ */

/**
 * A contract `Availability` minus `itemId`: this proxy is keyed by tmdbId
 * and item ids are minted on-device at add time (`lib/types/item.ts`), so
 * E5.1 attaches the `ItemId` when persisting. Attaching an id yields a
 * record that parses under `availabilitySchema` — proven by test.
 */
export type AvailabilitySeed = {
  [K in Availability as K["kind"]]: Omit<K, "itemId">;
}[Availability["kind"]];

/**
 * One US offer for a title.
 *
 * HANDOFF (E5.2): `availability.url` is deliberately absent — TMDB's payload
 * carries no per-provider deep links (its `link` is a JustWatch attribution
 * page). The provider registry's deep-link templates fill `url` at render
 * time, keyed by `providerId` (a slug derived here from TMDB's
 * `provider_name`, e.g. "Amazon Prime Video" → `amazon-prime-video`) or,
 * more robustly, by `tmdbProviderId` — TMDB's stable numeric id, carried
 * verbatim so the registry can match without string games.
 */
export interface TmdbProviderOffer {
  availability: AvailabilitySeed;
  tmdbProviderId: number;
  /** TMDB's display name, verbatim — UI fallback when the registry lacks the service. */
  providerName: string;
}

export interface TmdbWatchProviders {
  /** TMDB's JustWatch page for the title; their terms ask for this link where offers render. */
  attributionLink?: string;
  offers: TmdbProviderOffer[];
}

function toProviderId(providerName: string): ProviderId {
  const slug = providerName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return providerIdSchema.parse(slug === "" ? "unknown" : slug);
}

function toOffers(
  entries: readonly z.infer<typeof watchProviderEntrySchema>[] | undefined,
  kind: "subscription" | "rent" | "buy",
  fetchedAt: string,
): TmdbProviderOffer[] {
  return (entries ?? []).map((entry) => {
    const providerId = toProviderId(entry.provider_name);
    return {
      availability: { kind, providerId, region: REGION, fetchedAt },
      tmdbProviderId: entry.provider_id,
      providerName: entry.provider_name,
    };
  });
}

/**
 * `GET /{movie,tv}/{id}/watch/providers`, US region only, mapped to the
 * contract's kinds: `flatrate` → subscription, `rent` → rent, `buy` → buy.
 * TMDB reports no prices, so `priceUsd` stays absent. A title with no US
 * block returns `offers: []` — "not streamable right now" is honest data
 * (E5.5), not an error.
 */
export async function getTmdbWatchProviders(
  medium: TmdbMedium,
  tmdbId: number,
): Promise<TmdbResult<TmdbWatchProviders>> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return fail("invalid-request", "tmdbId must be a positive integer.");
  }

  return cachedTmdbCall(
    `${medium}/watch-providers:${String(tmdbId)}`,
    TMDB_CACHE_TTL_MS.watchProviders,
    `/${medium}/${String(tmdbId)}/watch/providers`,
    {},
    watchProvidersSchema,
    (payload): TmdbWatchProviders => {
      const us = payload.results.US;
      const fetchedAt = new Date().toISOString();
      return {
        ...(us?.link !== undefined ? { attributionLink: us.link } : {}),
        offers: [
          ...toOffers(us?.flatrate, "subscription", fetchedAt),
          ...toOffers(us?.rent, "rent", fetchedAt),
          ...toOffers(us?.buy, "buy", fetchedAt),
        ],
      };
    },
  );
}

/* ------------------------------------------------------------------ */
/* Now playing                                                        */
/* ------------------------------------------------------------------ */

/**
 * A current theatrical release: the movie's seed plus a theater-kind
 * availability seed.
 *
 * HANDOFF (E5.4): `availability.fandangoUrl` is deliberately absent — TMDB
 * knows a film is in theaters, not where it's showing. The theaters
 * resolver (E5.4) builds the Fandango showtimes deep link (title + zip) and
 * fills the field; until then the theater state renders without a showtimes
 * button.
 */
export interface TmdbNowPlayingEntry {
  seed: MovieSeed;
  availability: Extract<AvailabilitySeed, { kind: "theater" }>;
}

/**
 * The US slate typically spans 4–6 pages of 20; this cap bounds the fan-out
 * at ~100 titles. IMPORTANT: absence from this feed is only meaningful
 * within the cap — E5.1/E6 must never infer "not in theaters" from a title
 * missing here, only "in theaters" from its presence.
 */
const NOW_PLAYING_MAX_PAGES = 5;

/**
 * `GET /movie/now_playing` (US), normalized to theater-kind availability
 * seeds. Fetches up to `NOW_PLAYING_MAX_PAGES` pages (page 1 first for the
 * page count, the rest in parallel), merged and deduped by TMDB id — TMDB
 * pagination can repeat a title across page boundaries. The merged slate is
 * cached whole; any page failing fails the call rather than silently
 * serving a partial slate.
 */
export async function getTmdbNowPlaying(): Promise<
  TmdbResult<TmdbNowPlayingEntry[]>
> {
  const cacheKey = "movie/now_playing";
  const hit = cache.get(cacheKey);
  if (hit !== undefined) {
    return { ok: true, data: hit as TmdbNowPlayingEntry[] };
  }

  type NowPlayingPage = z.infer<typeof nowPlayingPageSchema>;
  const fetchPage = async (
    page: number,
  ): Promise<TmdbResult<NowPlayingPage>> => {
    const fetched = await tmdbFetch("/movie/now_playing", {
      region: REGION,
      page: String(page),
    });
    if (!fetched.ok) return fetched;
    const parsed = nowPlayingPageSchema.safeParse(fetched.data);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : fail(
          "upstream-invalid",
          "TMDB payload for /movie/now_playing did not match the documented shape.",
        );
  };

  const first = await fetchPage(1);
  if (!first.ok) return first;

  const pageCount = Math.min(
    Math.max(first.data.total_pages, 1),
    NOW_PLAYING_MAX_PAGES,
  );
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2)),
  );

  const fetchedAt = new Date().toISOString();
  const seen = new Set<number>();
  const entries: TmdbNowPlayingEntry[] = [];
  for (const page of [first, ...rest]) {
    if (!page.ok) return page;
    for (const movie of page.data.results) {
      if (seen.has(movie.id)) continue;
      seen.add(movie.id);
      const seed = movieSeed(movie);
      if (seed !== undefined) {
        entries.push({
          seed,
          availability: { kind: "theater", region: REGION, fetchedAt },
        });
      }
    }
  }

  cache.set(cacheKey, entries, TMDB_CACHE_TTL_MS.nowPlaying);
  return { ok: true, data: entries };
}
