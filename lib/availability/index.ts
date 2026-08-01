import {
  type TmdbErrorCode,
  type TmdbNowPlayingEntry,
  type TmdbResult,
  type TmdbWatchProviders,
} from "../providers/tmdb";
import {
  fetchAudibleCatalog,
  fetchTmdbNowPlaying,
  fetchTmdbWatchProviders,
} from "./client";
import { providerForTmdbId } from "../providers/registry";
import {
  type AudibleCatalogResult,
} from "./audible";
import {
  readAvailabilityState,
  refreshAvailabilityState,
  type AvailabilityState,
} from "../db/repo/availability";
import {
  providerIdSchema,
  type Availability,
  type Item,
  type ItemId,
  type IsoTimestamp,
} from "../types";

export { AUDIBLE_CATALOG_EVIDENCE, TMDB_TIER_EVIDENCE } from "./evidence";

export const AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;

/** The services Jeremy already pays for (PLAN §5). */
export const SUBSCRIBED_PROVIDER_IDS = [
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
] as const;

const subscribed = new Set<string>(SUBSCRIBED_PROVIDER_IDS);

export interface AvailabilityFailure {
  source: "watch-providers" | "now-playing" | "audible-catalog";
  code: TmdbErrorCode | "catalog-unavailable" | "catalog-invalid";
  message: string;
}

export interface AvailabilityMetadata {
  /** Oldest timestamp in the result: every rendered offer is at least this fresh. */
  fetchedAt?: string;
  /** Time the complete provider check committed, even when it found no offers. */
  checkedAt?: string;
  staleAfter?: string;
  stale: boolean;
  cache: "hit" | "refreshed" | "miss" | "stale-fallback";
  /** Presence is evidence; absence from TMDB's capped feed is only unknown. */
  theater: "present" | "unknown";
  failures: readonly AvailabilityFailure[];
}

export interface ItemAvailability {
  itemId: ItemId;
  offers: readonly Availability[];
  onSomethingIPayFor: boolean;
  metadata: AvailabilityMetadata;
}

export interface AvailabilityDependencies {
  readState(itemId: ItemId): Promise<AvailabilityState>;
  write(
    itemId: ItemId,
    offers: readonly Availability[],
    fetchedAt: IsoTimestamp,
  ): Promise<boolean>;
  watchProviders(
    medium: "movie" | "tv",
    tmdbId: number,
  ): Promise<TmdbResult<TmdbWatchProviders>>;
  nowPlaying(): Promise<TmdbResult<TmdbNowPlayingEntry[]>>;
  audibleCatalog(book: Extract<Item, { medium: "book" }>): Promise<AudibleCatalogResult>;
  now(): Date;
}

const defaults: AvailabilityDependencies = {
  readState: readAvailabilityState,
  write: refreshAvailabilityState,
  watchProviders: fetchTmdbWatchProviders,
  nowPlaying: fetchTmdbNowPlaying,
  audibleCatalog: fetchAudibleCatalog,
  now: () => new Date(),
};

const inFlight = new Map<string, Promise<ItemAvailability>>();

/** Resolve and cache the actionable offers for one library item. */
export async function resolveItemAvailability(
  item: Item,
  overrides: Partial<AvailabilityDependencies> = {},
): Promise<ItemAvailability> {
  const existing = inFlight.get(item.id);
  if (existing !== undefined) return existing;
  const resolving = resolveItemAvailabilityOnce(item, overrides);
  inFlight.set(item.id, resolving);
  try {
    return await resolving;
  } finally {
    if (inFlight.get(item.id) === resolving) inFlight.delete(item.id);
  }
}

async function resolveItemAvailabilityOnce(
  item: Item,
  overrides: Partial<AvailabilityDependencies>,
): Promise<ItemAvailability> {
  const dependencies = { ...defaults, ...overrides };
  const state = await dependencies.readState(item.id);
  const cached = dedupeOffers(state.offers);
  const now = dependencies.now();
  const cachedMetadata = metadataFor(cached, now, state.refresh?.fetchedAt);

  if (!cachedMetadata.stale && cachedMetadata.fetchedAt !== undefined) {
    return present(item.id, cached, { ...cachedMetadata, cache: "hit" });
  }

  if (item.medium === "podcast" && item.ref.spotifyShowId !== undefined) {
    const checkedAt = now.toISOString() as IsoTimestamp;
    const offers: Availability[] = [{
      itemId: item.id,
      kind: "subscription",
      providerId: providerIdSchema.parse("spotify"),
      region: "US",
      fetchedAt: checkedAt,
      url: `https://open.spotify.com/show/${encodeURIComponent(item.ref.spotifyShowId)}`,
    }];
    return commitOrReadLatest(item.id, offers, checkedAt, now, dependencies);
  }

  if (item.medium === "book") {
    const audible = await dependencies.audibleCatalog(item);
    if (!audible.ok) {
      return present(item.id, cached, {
        ...cachedMetadata,
        stale: true,
        cache: cached.length > 0 ? "stale-fallback" : "miss",
        failures: [{
          source: "audible-catalog",
          code: audible.code,
          message: audible.message,
        }],
      });
    }
    const checkedAt = now.toISOString() as IsoTimestamp;
    const offers: Availability[] = audible.product === undefined
      ? []
      : [{
          itemId: item.id,
          kind: "buy",
          providerId: providerIdSchema.parse("audible"),
          region: "US",
          fetchedAt: checkedAt,
          url: `https://www.audible.com/pd/${encodeURIComponent(audible.product.asin)}`,
        }];
    return commitOrReadLatest(item.id, offers, checkedAt, now, dependencies);
  }

  if (item.medium !== "movie" && item.medium !== "tv") {
    return present(item.id, cached, {
      ...cachedMetadata,
      cache: cached.length > 0 ? "stale-fallback" : "miss",
    });
  }

  const watchPromise = dependencies.watchProviders(item.medium, item.ref.tmdbId);
  const theaterPromise =
    item.medium === "movie"
      ? dependencies.nowPlaying()
      : Promise.resolve<TmdbResult<TmdbNowPlayingEntry[]>>({ ok: true, data: [] });
  const [watch, theater] = await Promise.all([watchPromise, theaterPromise]);
  const failures = [
    ...failureOf("watch-providers", watch),
    ...failureOf("now-playing", theater),
  ];

  // Keep old rows intact if either source is unavailable. Otherwise a
  // transient now-playing failure could erase valid streaming availability.
  if (!watch.ok || !theater.ok) {
    return present(item.id, cached, {
      ...cachedMetadata,
      stale: true,
      cache: cached.length > 0 ? "stale-fallback" : "miss",
      failures,
    });
  }

  const mapped = mapWatchOffers(item.id, watch.data);
  const theatrical =
    item.medium === "movie"
      ? theater.data.find((entry) => entry.seed.ref.tmdbId === item.ref.tmdbId)
      : undefined;
  if (theatrical !== undefined) {
    mapped.push({ ...theatrical.availability, itemId: item.id });
  }
  const offers = dedupeOffers(mapped);
  const refreshedAt = now.toISOString() as IsoTimestamp;
  return commitOrReadLatest(item.id, offers, refreshedAt, now, dependencies);
}

async function commitOrReadLatest(
  itemId: ItemId,
  offers: readonly Availability[],
  checkedAt: IsoTimestamp,
  now: Date,
  dependencies: AvailabilityDependencies,
): Promise<ItemAvailability> {
  const committed = await dependencies.write(itemId, offers, checkedAt);
  if (committed) {
    return present(itemId, offers, {
      ...metadataFor(offers, now, checkedAt),
      cache: "refreshed",
      failures: [],
    });
  }
  const latest = await dependencies.readState(itemId);
  const metadata = metadataFor(latest.offers, now, latest.refresh?.fetchedAt);
  return present(itemId, latest.offers, {
    ...metadata,
    cache: metadata.stale ? "stale-fallback" : "hit",
  });
}

function mapWatchOffers(
  itemId: ItemId,
  payload: TmdbWatchProviders,
): Availability[] {
  return payload.offers.flatMap((offer) => {
    const registered = providerForTmdbId(offer.tmdbProviderId);
    if (registered === undefined || !subscribed.has(registered.id)) return [];
    const source = offer.availability;
    if (source.kind === "theater") return [];
    // `kind`, price, and a direct URL come from the payload. Only providerId
    // is folded through the registry (10 Amazon Video → prime-video).
    return [{ ...source, itemId, providerId: registered.id }];
  });
}

function dedupeOffers(offers: readonly Availability[]): Availability[] {
  const unique = new Map<string, Availability>();
  for (const offer of offers) {
    const key = `${offer.kind}|${"providerId" in offer ? offer.providerId : ""}`;
    if (!unique.has(key)) unique.set(key, offer);
  }
  return [...unique.values()];
}

function metadataFor(
  offers: readonly Availability[],
  now: Date,
  refreshFetchedAt?: string,
): Omit<AvailabilityMetadata, "cache"> {
  const oldestOfferFetchedAt = offers.map((offer) => offer.fetchedAt).sort()[0];
  const fetchedAt = oldestOfferFetchedAt ?? refreshFetchedAt;
  const fetchedMs = fetchedAt === undefined ? undefined : Date.parse(fetchedAt);
  const staleAfterMs = fetchedMs === undefined ? undefined : fetchedMs + AVAILABILITY_TTL_MS;
  return {
    ...(fetchedAt !== undefined && { fetchedAt }),
    ...(refreshFetchedAt !== undefined && { checkedAt: refreshFetchedAt }),
    ...(staleAfterMs !== undefined && { staleAfter: new Date(staleAfterMs).toISOString() }),
    stale: staleAfterMs === undefined || now.getTime() >= staleAfterMs,
    theater: offers.some((offer) => offer.kind === "theater")
      ? "present"
      : "unknown",
    failures: [],
  };
}

function present(
  itemId: ItemId,
  offers: readonly Availability[],
  metadata: AvailabilityMetadata,
): ItemAvailability {
  return {
    itemId,
    offers,
    onSomethingIPayFor: offers.some(
      (offer) =>
        offer.kind === "subscription" &&
        subscribed.has(String(offer.providerId)),
    ),
    metadata,
  };
}

function failureOf<T>(
  source: AvailabilityFailure["source"],
  result: TmdbResult<T>,
): AvailabilityFailure[] {
  return result.ok ? [] : [{ source, ...result.error }];
}
