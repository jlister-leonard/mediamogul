import { z } from "zod";
import { itemSeedSchema, type ItemSeed } from "../types";

/**
 * Podcast metadata provider (E2.3) — SHOWS ONLY, never episodes (decision #2).
 *
 * Primary source: iTunes Search API (keyless). Enrichment: Spotify show-id
 * resolution via the client-credentials flow (PLAN §5: Spotify deep links
 * first), used when SPOTIFY_CLIENT_ID/SECRET are configured and degraded to a
 * typed marker when they are not. Spotify also supplies the show description —
 * iTunes Search results do not carry one.
 *
 * Server-side only: the Spotify client secret must never reach the client.
 * Routes under `app/api/providers/podcasts/*` are the public surface.
 */

/** The podcast variant of the provider-neutral search-result contract. */
export type PodcastSeed = Extract<ItemSeed, { medium: "podcast" }>;

// ---------------------------------------------------------------------------
// Deep links (consumed by E5.5's action row; exported here so the URL shape
// has exactly one owner)
// ---------------------------------------------------------------------------

/** Apple Podcasts deep link for a show — derivable from any seed carrying an appleId. */
export function applePodcastsUrl(appleId: number): string {
  return `https://podcasts.apple.com/podcast/id${appleId}`;
}

/** Spotify deep link for a show — the Spotify-first link of PLAN §5. */
export function spotifyShowUrl(spotifyShowId: string): string {
  return `https://open.spotify.com/show/${spotifyShowId}`;
}

// ---------------------------------------------------------------------------
// Typed envelopes — the graceful-degradation contract every caller sees
// ---------------------------------------------------------------------------

export const podcastProviderErrorCodeSchema = z.enum([
  "bad-request",
  "not-found",
  "upstream-unreachable",
  "upstream-malformed",
]);
export type PodcastProviderErrorCode = z.infer<
  typeof podcastProviderErrorCodeSchema
>;

export type PodcastProviderError = {
  code: PodcastProviderErrorCode;
  message: string;
};

/**
 * Spotify enrichment status for a whole response:
 * - `spotify-resolved` — credentials configured and Spotify answered; seeds
 *   that matched carry `ref.spotifyShowId` (an unmatched show is not an error).
 * - `spotify-unconfigured` — SPOTIFY_CLIENT_ID/SECRET absent; seeds ship
 *   without `spotifyShowId` and no Spotify request is ever made.
 * - `spotify-unavailable` — configured but Spotify errored mid-flight; seeds
 *   still ship, enriched only as far as resolution got.
 */
export const spotifyMarkerSchema = z.enum([
  "spotify-resolved",
  "spotify-unconfigured",
  "spotify-unavailable",
]);
export type SpotifyMarker = z.infer<typeof spotifyMarkerSchema>;

export type PodcastFailure = { ok: false; error: PodcastProviderError };
export type PodcastSearchEnvelope =
  | { ok: true; seeds: PodcastSeed[]; spotify: SpotifyMarker }
  | PodcastFailure;
export type PodcastLookupEnvelope =
  | { ok: true; seed: PodcastSeed; spotify: SpotifyMarker }
  | PodcastFailure;

function failure(
  code: PodcastProviderErrorCode,
  message: string,
): PodcastFailure {
  return { ok: false, error: { code, message } };
}

/** HTTP status for an envelope — shared by both route handlers. */
export function httpStatusForEnvelope(
  envelope: PodcastSearchEnvelope | PodcastLookupEnvelope,
): number {
  if (envelope.ok) return 200;
  switch (envelope.error.code) {
    case "bad-request":
      return 400;
    case "not-found":
      return 404;
    case "upstream-malformed":
      return 502;
    case "upstream-unreachable":
      return 503;
  }
}

/**
 * Cache headers for an envelope. Full successes are CDN-cacheable (metadata
 * moves slowly); a success degraded by a Spotify outage gets a short private
 * lifetime so recovery isn't masked for an hour; failures must never be
 * cached into a stale outage.
 */
export function cacheControlForEnvelope(
  envelope: PodcastSearchEnvelope | PodcastLookupEnvelope,
): string {
  if (!envelope.ok) return "no-store";
  if (envelope.spotify === "spotify-unavailable") return "private, max-age=60";
  return "public, s-maxage=3600, stale-while-revalidate=86400";
}

// ---------------------------------------------------------------------------
// Spotify configuration
// ---------------------------------------------------------------------------

export type SpotifyConfig = { clientId: string; clientSecret: string };

/** Reads Spotify credentials from the environment; empty values count as unconfigured. */
export function spotifyConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SpotifyConfig | undefined {
  const clientId = env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Upstream shapes (zod on every byte we consume — malformed upstream is a
// typed error, never a crash)
// ---------------------------------------------------------------------------

/**
 * One iTunes Search result of kind "podcast" (a show). Fields per Apple's
 * iTunes Search API documentation; unknown fields are stripped by zod.
 * `description` is not documented for podcast results and in practice absent —
 * kept optional so a future upstream addition flows through.
 */
const itunesShowSchema = z.object({
  kind: z.literal("podcast"),
  collectionId: z.number().int().positive(),
  collectionName: z.string().min(1),
  artistName: z.string().min(1).optional(),
  artworkUrl30: z.url().optional(),
  artworkUrl60: z.url().optional(),
  artworkUrl100: z.url().optional(),
  artworkUrl600: z.url().optional(),
  description: z.string().optional(),
});
type ItunesShow = z.infer<typeof itunesShowSchema>;

const itunesResponseSchema = z.object({
  resultCount: z.number().int().nonnegative(),
  results: z.array(z.unknown()),
});

/** Just enough shape to tell shows from episodes before strict parsing. */
const itunesKindPeekSchema = z.object({ kind: z.string().optional() });

const spotifyTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const spotifyShowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  publisher: z.string().optional(),
  description: z.string().optional(),
});

/** Spotify documents that search item arrays may contain nulls. */
const spotifySearchResponseSchema = z.object({
  shows: z.object({
    items: z.array(spotifyShowSchema.nullable()),
  }),
});

// ---------------------------------------------------------------------------
// LRU cache (per-instance, module-level — Vercel functions reuse warm
// instances, and the CDN layer above holds the HTTP cache headers)
// ---------------------------------------------------------------------------

export class LruCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, now: number = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    if (hit.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency: Map iteration order is insertion order.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, now: number = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: now + this.ttlMs });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

const CACHE_CAPACITY = 128;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — matches the s-maxage above.

const searchCache = new LruCache<
  Extract<PodcastSearchEnvelope, { ok: true }>
>(CACHE_CAPACITY, CACHE_TTL_MS);
const lookupCache = new LruCache<
  Extract<PodcastLookupEnvelope, { ok: true }>
>(CACHE_CAPACITY, CACHE_TTL_MS);

let spotifyToken: { token: string; expiresAt: number } | undefined;

/** Test-only isolation hook: clears the module-level caches between tests. */
export function resetPodcastProviderCaches(): void {
  searchCache.clear();
  lookupCache.clear();
  spotifyToken = undefined;
}

// ---------------------------------------------------------------------------
// Spotify resolution
// ---------------------------------------------------------------------------

export type SpotifyResolution =
  | { status: "resolved"; spotifyShowId: string; description?: string }
  | { status: "unmatched" }
  | { status: "unavailable" };

/**
 * Case-, diacritic-, and punctuation-insensitive comparison key.
 * Unicode-aware: letters and numbers in every script survive (a CJK or
 * Cyrillic title must never normalize to the empty string \u2014 that collapsed
 * distinct cache keys and produced false Spotify matches). Built via the
 * RegExp constructor because `\p{\u2026}` property escapes post-date the ES2017
 * compile target; every runtime we ship to supports them.
 */
const NON_ALPHANUMERIC = new RegExp("[^\\p{L}\\p{N}]+", "gu");

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, " ")
    .trim();
}

async function getSpotifyToken(
  config: SpotifyConfig,
  fetchImpl: typeof fetch,
  now: number = Date.now(),
): Promise<string | undefined> {
  if (spotifyToken !== undefined && spotifyToken.expiresAt > now) {
    return spotifyToken.token;
  }
  let response: Response;
  try {
    response = await fetchImpl("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  const parsed = spotifyTokenSchema.safeParse(body);
  if (!parsed.success) return undefined;
  spotifyToken = {
    token: parsed.data.access_token,
    // 60s safety margin so a token never expires mid-request.
    expiresAt: now + (parsed.data.expires_in - 60) * 1000,
  };
  return spotifyToken.token;
}

/**
 * Resolves a show name (+ publisher, when known) to a Spotify show id via
 * Spotify search. A confident match requires normalized title equality; among
 * title matches, a publisher match wins. Exported for E2.4's resolver.
 */
export async function resolveSpotifyShow(
  show: { title: string; publisher?: string },
  config: SpotifyConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SpotifyResolution> {
  const token = await getSpotifyToken(config, fetchImpl);
  if (token === undefined) return { status: "unavailable" };

  const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
    q: show.title,
    type: "show",
    market: "US",
    limit: "5",
  })}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { status: "unavailable" };
  }
  if (!response.ok) return { status: "unavailable" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable" };
  }
  const parsed = spotifySearchResponseSchema.safeParse(body);
  if (!parsed.success) return { status: "unavailable" };

  const wantedTitle = normalizeName(show.title);
  // A title that normalizes to nothing can never be matched confidently —
  // without this guard it would "equal" any other degenerate title.
  if (wantedTitle.length === 0) return { status: "unmatched" };
  const wantedPublisher =
    show.publisher !== undefined ? normalizeName(show.publisher) : undefined;
  const titleMatches = parsed.data.shows.items
    .filter((item) => item !== null)
    .filter((item) => normalizeName(item.name) === wantedTitle);
  if (titleMatches.length === 0) return { status: "unmatched" };

  // When the publisher is known it is a veto, not a tiebreak: a same-title
  // show from a different publisher is a confidently WRONG deep link, and an
  // absent link is better than a wrong one.
  let match: (typeof titleMatches)[number];
  if (wantedPublisher !== undefined && wantedPublisher.length > 0) {
    const publisherMatch = titleMatches.find(
      (item) =>
        item.publisher !== undefined &&
        normalizeName(item.publisher) === wantedPublisher,
    );
    if (publisherMatch === undefined) return { status: "unmatched" };
    match = publisherMatch;
  } else {
    match = titleMatches[0];
  }
  return {
    status: "resolved",
    spotifyShowId: match.id,
    ...(match.description !== undefined && match.description.length > 0
      ? { description: match.description }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// iTunes fetch + normalization
// ---------------------------------------------------------------------------

type ItunesFetchResult =
  | { ok: true; shows: ItunesShow[] }
  | { ok: false; error: PodcastProviderError };

async function fetchItunesShows(
  url: string,
  fetchImpl: typeof fetch,
): Promise<ItunesFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    return {
      ok: false,
      error: {
        code: "upstream-unreachable",
        message: "iTunes Search could not be reached",
      },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: "upstream-unreachable",
        message: `iTunes Search responded ${response.status}`,
      },
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "upstream-malformed",
        message: "iTunes Search returned a non-JSON body",
      },
    };
  }
  const envelope = itunesResponseSchema.safeParse(body);
  if (!envelope.success) {
    return {
      ok: false,
      error: {
        code: "upstream-malformed",
        message: "iTunes Search response did not match the documented shape",
      },
    };
  }

  const shows: ItunesShow[] = [];
  for (const raw of envelope.data.results) {
    const peek = itunesKindPeekSchema.safeParse(raw);
    if (!peek.success) {
      return {
        ok: false,
        error: {
          code: "upstream-malformed",
          message: "iTunes Search returned a non-object result",
        },
      };
    }
    // Shows only, ever (decision #2): anything that is not a podcast show —
    // notably kind "podcast-episode" — is dropped, not normalized.
    if (peek.data.kind !== "podcast") continue;
    const show = itunesShowSchema.safeParse(raw);
    if (!show.success) {
      return {
        ok: false,
        error: {
          code: "upstream-malformed",
          message: "iTunes Search returned a malformed podcast result",
        },
      };
    }
    shows.push(show.data);
  }
  return { ok: true, shows };
}

function largestArtwork(show: ItunesShow): string | undefined {
  return (
    show.artworkUrl600 ??
    show.artworkUrl100 ??
    show.artworkUrl60 ??
    show.artworkUrl30
  );
}

/**
 * Normalizes one iTunes show (plus optional Spotify enrichment) into the
 * shared `ItemSeed` contract, re-validated so a contract violation can never
 * leave this module. No `year`: iTunes' `releaseDate` on a show is the latest
 * episode's date, not the show's start year, and a wrong year is worse than
 * none.
 */
function toSeed(
  show: ItunesShow,
  enrichment?: { spotifyShowId: string; description?: string },
): PodcastSeed | undefined {
  const description = enrichment?.description ?? show.description;
  const candidate = {
    medium: "podcast",
    title: show.collectionName,
    creators: show.artistName !== undefined ? [show.artistName] : [],
    artUrl: largestArtwork(show),
    ...(description !== undefined && description.length > 0
      ? { description }
      : {}),
    ref: {
      medium: "podcast",
      appleId: show.collectionId,
      ...(enrichment !== undefined
        ? { spotifyShowId: enrichment.spotifyShowId }
        : {}),
    },
  };
  const parsed = itemSeedSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.medium !== "podcast") return undefined;
  return parsed.data;
}

type EnrichedSeeds = { seeds: PodcastSeed[]; spotify: SpotifyMarker } | null;

/**
 * Runs Spotify resolution over a batch of iTunes shows and builds the final
 * seeds. The token is minted once up front (a token failure marks the whole
 * batch unavailable without further Spotify calls); the per-show searches
 * then run in parallel against the cached token, so enrichment costs one
 * round-trip, not N. Seeds always ship, enriched as far as resolution got.
 * Returns null when a built seed fails contract validation (upstream gave us
 * something unusable).
 */
async function buildSeeds(
  shows: ItunesShow[],
  spotify: SpotifyConfig | undefined,
  fetchImpl: typeof fetch,
): Promise<EnrichedSeeds> {
  let marker: SpotifyMarker =
    spotify === undefined ? "spotify-unconfigured" : "spotify-resolved";
  let resolutions: (SpotifyResolution | undefined)[] = shows.map(
    () => undefined,
  );
  if (spotify !== undefined && shows.length > 0) {
    const token = await getSpotifyToken(spotify, fetchImpl);
    if (token === undefined) {
      marker = "spotify-unavailable";
    } else {
      resolutions = await Promise.all(
        shows.map((show) =>
          resolveSpotifyShow(
            { title: show.collectionName, publisher: show.artistName },
            spotify,
            fetchImpl,
          ),
        ),
      );
      if (resolutions.some((r) => r?.status === "unavailable")) {
        marker = "spotify-unavailable";
      }
    }
  }

  const seeds: PodcastSeed[] = [];
  for (let i = 0; i < shows.length; i += 1) {
    const resolution = resolutions[i];
    const enrichment =
      resolution?.status === "resolved"
        ? {
            spotifyShowId: resolution.spotifyShowId,
            ...(resolution.description !== undefined
              ? { description: resolution.description }
              : {}),
          }
        : undefined;
    const seed = toSeed(shows[i], enrichment);
    if (seed === undefined) return null;
    seeds.push(seed);
  }
  return { seeds, spotify: marker };
}

// ---------------------------------------------------------------------------
// Public provider API
// ---------------------------------------------------------------------------

export type PodcastProviderOptions = {
  /** Spotify credentials; omit (or pass undefined) for keyless operation. */
  spotify?: SpotifyConfig;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Max shows to return, 1–25. */
  limit?: number;
};

const DEFAULT_LIMIT = 10;

/**
 * Searches podcast shows by free text. iTunes Search is the primary, keyless
 * source; results normalize to `ItemSeed` and are LRU-cached per
 * (query, spotify-configured) for an hour.
 */
export async function searchPodcastShows(
  query: string,
  options: PodcastProviderOptions = {},
): Promise<PodcastSearchEnvelope> {
  const term = query.trim();
  if (term.length === 0) {
    return failure("bad-request", "a non-empty search query is required");
  }
  const { spotify, fetchImpl = fetch, limit = DEFAULT_LIMIT } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    return failure("bad-request", "limit must be an integer between 1 and 25");
  }

  // Unicode-aware key; if normalization still yields nothing (e.g. an
  // emoji-only query) fall back to the raw term so distinct queries can
  // never share a key.
  const normalizedTerm = normalizeName(term);
  const keyTerm = normalizedTerm.length > 0 ? normalizedTerm : term.toLowerCase();
  const cacheKey = `search:${limit}:${spotify !== undefined}:${keyTerm}`;
  const cached = searchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    media: "podcast",
    entity: "podcast",
    limit: String(limit),
  })}`;
  const upstream = await fetchItunesShows(url, fetchImpl);
  if (!upstream.ok) return upstream;

  const built = await buildSeeds(upstream.shows, spotify, fetchImpl);
  if (built === null) {
    return failure(
      "upstream-malformed",
      "iTunes Search returned a result that cannot satisfy the item contract",
    );
  }
  const envelope = { ok: true as const, ...built };
  // A Spotify-outage-degraded success is not cached: the next request should
  // retry enrichment, not replay the outage for an hour.
  if (envelope.spotify !== "spotify-unavailable") {
    searchCache.set(cacheKey, envelope);
  }
  return envelope;
}

/**
 * Looks up one show by its Apple id (iTunes `/lookup`) — the detail half of
 * the provider. Same normalization, enrichment, and caching as search.
 */
export async function lookupPodcastShow(
  appleId: number,
  options: Omit<PodcastProviderOptions, "limit"> = {},
): Promise<PodcastLookupEnvelope> {
  if (!Number.isSafeInteger(appleId) || appleId <= 0) {
    return failure("bad-request", "appleId must be a positive safe integer");
  }
  const { spotify, fetchImpl = fetch } = options;

  const cacheKey = `lookup:${spotify !== undefined}:${appleId}`;
  const cached = lookupCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://itunes.apple.com/lookup?${new URLSearchParams({
    id: String(appleId),
    entity: "podcast",
  })}`;
  const upstream = await fetchItunesShows(url, fetchImpl);
  if (!upstream.ok) return upstream;
  if (upstream.shows.length === 0) {
    return failure("not-found", `no podcast show with appleId ${appleId}`);
  }

  const built = await buildSeeds([upstream.shows[0]], spotify, fetchImpl);
  if (built === null || built.seeds.length !== 1) {
    return failure(
      "upstream-malformed",
      "iTunes lookup returned a result that cannot satisfy the item contract",
    );
  }
  const envelope = {
    ok: true as const,
    seed: built.seeds[0],
    spotify: built.spotify,
  };
  if (envelope.spotify !== "spotify-unavailable") {
    lookupCache.set(cacheKey, envelope);
  }
  return envelope;
}
