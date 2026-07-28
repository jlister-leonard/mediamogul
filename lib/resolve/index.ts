import {
  getBooksProvider,
  isbn10To13,
  type BookQueryInput,
  type BooksResult,
} from "../providers/books";
import {
  searchPodcastShows,
  spotifyConfigFromEnv,
  type PodcastSearchEnvelope,
} from "../providers/podcasts";
import {
  searchTmdb,
  type TmdbResult,
  type TmdbSearchResults,
  type TmdbSearchScope,
} from "../providers/tmdb";
import type { Medium } from "../types";
import {
  dedupeBooks,
  dedupeByTmdbId,
  dedupePodcasts,
  type BookSeed,
  type MovieSeed,
  type PodcastSeed,
  type TvSeed,
} from "./identity";

export * from "./identity";

/**
 * E2.4 `resolve` — cross-provider identity. One query in, one grouped and
 * deduped answer out. `ResolveResult` is the omnibox contract (E2.5); its
 * fields carry the rules.
 *
 * Seeds are `ItemSeed`s (`lib/types/item.ts`): no `id`, no `genre`. Both are
 * minted on add — the resolver never touches the library.
 */

/** Canonical order, shared by `groups`, `searched` and `degraded`. */
export const RESOLVE_MEDIA = ["book", "movie", "tv", "podcast"] as const;

/**
 * All four keys are always present, each an array that may be empty, so the
 * omnibox renders a fixed section order without null checks. Each group is
 * typed to its medium — `groups.book[0]` is a book seed, no narrowing. Within
 * a group the provider's own ranking is preserved: relevance order is the
 * provider's job, not the resolver's.
 */
export interface ResolveGroups {
  book: BookSeed[];
  movie: MovieSeed[];
  tv: TvSeed[];
  podcast: PodcastSeed[];
}

export type ResolveErrorCode =
  /** Empty query, or an empty `media` scope — nothing to search. */
  | "bad-request"
  /** Every provider in scope failed; there is no partial answer to show. */
  | "all-providers-failed";

/**
 * The three states a medium can be in, which the omnibox must render
 * differently:
 *
 * | in `searched` | in `degraded` | group | meaning |
 * |---|---|---|---|
 * | yes | no | empty | genuinely **no results** |
 * | yes | yes | empty or partial | **we could not finish looking** |
 * | no | no | empty | **never asked** — render nothing at all |
 *
 * Rendering "Movies — no results" for a medium that was never searched (an
 * ISBN query, or a scoped one) would be a lie, which is why `searched`
 * exists rather than leaving emptiness ambiguous.
 */
export type ResolveResult =
  | {
      ok: true;
      groups: ResolveGroups;
      /**
       * The media actually queried, in canonical order — the requested
       * `media` scope minus any lane the query short-circuited (an ISBN
       * query searches books alone).
       */
      searched: Medium[];
      /**
       * The searched media whose results are incomplete, in canonical order:
       * a provider that failed, or one TMDB namespace down while the other
       * answered. Always a subset of `searched`.
       */
      degraded: Medium[];
    }
  /**
   * Nothing could be searched at all — every provider in scope failed, or
   * the query was unusable. A partial outage is always `ok: true` with a
   * `degraded` entry, never an error.
   */
  | { ok: false; error: { code: ResolveErrorCode; message: string } };

/**
 * The three provider calls the resolver makes, as an injectable seam. Tests
 * pass fakes here instead of stubbing `fetch` underneath three different
 * provider implementations.
 */
export interface ResolveProviders {
  searchBooks(query: BookQueryInput): Promise<BooksResult>;
  searchVideo(
    query: string,
    scope: TmdbSearchScope,
  ): Promise<TmdbResult<TmdbSearchResults>>;
  searchPodcasts(query: string): Promise<PodcastSearchEnvelope>;
}

/** Binds the real providers, each with its own module-level cache. */
export function defaultResolveProviders(): ResolveProviders {
  return {
    searchBooks: (query) => getBooksProvider().search(query),
    searchVideo: (query, scope) => searchTmdb(query, scope),
    searchPodcasts: (query) =>
      searchPodcastShows(query, { spotify: spotifyConfigFromEnv() }),
  };
}

export interface ResolveOptions {
  /** Restrict the search; defaults to all four media. */
  media?: readonly Medium[];
  /** Injectable providers; defaults to the real ones. */
  providers?: ResolveProviders;
}

/**
 * Recognizes a query that *is* an ISBN and returns it in the form the books
 * provider takes. ISBN-13 is identified by its Bookland prefix (a 13-digit
 * number that starts with anything else is not an ISBN); ISBN-10 is
 * identified by its check digit, so a mistyped one falls through to ordinary
 * text search instead of becoming a lookup that can only return nothing.
 * The raw ISBN-10 is passed along — the provider does the 13-digit
 * conversion, so exactly one implementation of it exists.
 */
export function isbnFromQuery(query: string): string | undefined {
  const compact = query.replace(/[-\s]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(compact)) return compact;
  if (/^\d{9}[\dX]$/.test(compact) && isbn10To13(compact) !== undefined) {
    return compact;
  }
  return undefined;
}

type LaneOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Runs one provider lane. A provider that returns a typed failure and a
 * provider that throws are the same event here: this lane is degraded, the
 * others carry on.
 */
async function lane<T>(
  run: () => Promise<LaneOutcome<T>>,
): Promise<LaneOutcome<T>> {
  try {
    return await run();
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function bad(code: ResolveErrorCode, message: string): ResolveResult {
  return { ok: false, error: { code, message } };
}

/**
 * Fans out to the books, TMDB and podcast providers in parallel, groups the
 * seeds by medium, dedupes (and, for books, merges) within each group, and
 * reports which media were searched and which came back incomplete.
 *
 * An ISBN query is the one exception to the fan-out: it addresses a single
 * book edition, so it goes straight to the books lookup (0-or-1 result) and
 * no other provider is called — E1.4's Goodreads importer resolves 225 rows
 * through this path and must not fire 675 pointless upstream requests.
 */
export async function resolve(
  query: string,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return bad("bad-request", "a non-empty query is required");
  }
  const scope = new Set<Medium>(options.media ?? RESOLVE_MEDIA);
  if (scope.size === 0) {
    return bad("bad-request", "media must name at least one medium");
  }
  const providers = options.providers ?? defaultResolveProviders();

  const isbn = scope.has("book") ? isbnFromQuery(trimmed) : undefined;

  const videoScope: TmdbSearchScope | undefined =
    isbn !== undefined
      ? undefined
      : scope.has("movie") && scope.has("tv")
        ? "all"
        : scope.has("movie")
          ? "movie"
          : scope.has("tv")
            ? "tv"
            : undefined;

  const [books, video, podcasts] = await Promise.all([
    scope.has("book")
      ? lane<BookSeed[]>(async () => {
          const result = await providers.searchBooks(
            isbn !== undefined ? { isbn } : { q: trimmed },
          );
          return result.ok
            ? { ok: true, value: result.seeds }
            : { ok: false, reason: `books: ${result.error.message}` };
        })
      : undefined,
    videoScope !== undefined
      ? lane<TmdbSearchResults>(async () => {
          const result = await providers.searchVideo(trimmed, videoScope);
          return result.ok
            ? { ok: true, value: result.data }
            : { ok: false, reason: `tmdb: ${result.error.message}` };
        })
      : undefined,
    scope.has("podcast") && isbn === undefined
      ? lane<PodcastSeed[]>(async () => {
          const result = await providers.searchPodcasts(trimmed);
          return result.ok
            ? { ok: true, value: result.seeds }
            : { ok: false, reason: `podcasts: ${result.error.message}` };
        })
      : undefined,
  ]);

  const attempted = [books, video, podcasts].filter(
    (outcome) => outcome !== undefined,
  );
  const failures = attempted.filter((outcome) => !outcome.ok);
  // Every medium in scope maps to a lane, so `attempted` is never empty; the
  // guard keeps "nothing was tried" from ever reading as "everything failed".
  if (attempted.length > 0 && failures.length === attempted.length) {
    return bad(
      "all-providers-failed",
      failures.map((failure) => failure.reason).join("; "),
    );
  }

  const degraded = new Set<Medium>();
  if (books !== undefined && !books.ok) degraded.add("book");
  if (video !== undefined) {
    if (!video.ok) {
      // The whole TMDB call failed, so every namespace it would have covered
      // is unanswered.
      if (videoScope === "all" || videoScope === "movie") degraded.add("movie");
      if (videoScope === "all" || videoScope === "tv") degraded.add("tv");
    } else {
      // Propagate TMDB's own partial-degradation marker (one namespace down,
      // the other still answering), intersected with the requested scope so
      // `degraded` can never name a medium outside `searched`.
      for (const medium of video.value.degraded ?? []) {
        if (scope.has(medium)) degraded.add(medium);
      }
    }
  }
  if (podcasts !== undefined && !podcasts.ok) degraded.add("podcast");

  // What was actually asked, so an empty group can be told apart from a
  // medium nobody looked at.
  const searched = new Set<Medium>();
  if (books !== undefined) searched.add("book");
  if (videoScope === "all" || videoScope === "movie") searched.add("movie");
  if (videoScope === "all" || videoScope === "tv") searched.add("tv");
  if (podcasts !== undefined) searched.add("podcast");

  const videoSeeds = video?.ok === true ? video.value.seeds : [];
  return {
    ok: true,
    groups: {
      book: books?.ok === true ? dedupeBooks(books.value) : [],
      movie: dedupeByTmdbId(
        videoSeeds.filter((seed): seed is MovieSeed => seed.medium === "movie"),
      ),
      tv: dedupeByTmdbId(
        videoSeeds.filter((seed): seed is TvSeed => seed.medium === "tv"),
      ),
      podcast: podcasts?.ok === true ? dedupePodcasts(podcasts.value) : [],
    },
    searched: RESOLVE_MEDIA.filter((medium) => searched.has(medium)),
    degraded: RESOLVE_MEDIA.filter((medium) => degraded.has(medium)),
  };
}
