import { describe, expect, it, vi } from "vitest";
import type { BookQueryInput, BooksResult } from "../providers/books";
import type { PodcastSearchEnvelope } from "../providers/podcasts";
import type {
  TmdbResult,
  TmdbSearchResults,
  TmdbSearchScope,
} from "../providers/tmdb";
import { itemSeedSchema, type ItemSeed } from "../types";
import { isbnFromQuery, resolve, type ResolveProviders } from "./index";

/**
 * Every test here injects fakes at the `ResolveProviders` seam — the three
 * real providers already own their own fetch-level tests, and stubbing a
 * global through three layers would test their plumbing, not this bead's.
 */

function seed(candidate: unknown): ItemSeed {
  return itemSeedSchema.parse(candidate);
}

const bookSeed = (title: string, openLibraryId: string): ItemSeed =>
  seed({
    medium: "book",
    ref: { medium: "book", openLibraryId },
    title,
    creators: ["Frank Herbert"],
  });

const movieSeed = (title: string, tmdbId: number): ItemSeed =>
  seed({
    medium: "movie",
    ref: { medium: "movie", tmdbId },
    title,
    creators: [],
  });

const tvSeed = (title: string, tmdbId: number): ItemSeed =>
  seed({ medium: "tv", ref: { medium: "tv", tmdbId }, title, creators: [] });

const podcastSeed = (title: string, appleId: number): ItemSeed =>
  seed({
    medium: "podcast",
    ref: { medium: "podcast", appleId },
    title,
    creators: [],
  });

function booksOk(seeds: ItemSeed[]): BooksResult {
  const parsed = seeds.map((s) => {
    if (s.medium !== "book") throw new Error("expected book seeds");
    return s;
  });
  return { ok: true, source: "openlibrary", seeds: parsed };
}

const videoOk = (
  seeds: ItemSeed[],
  degraded?: ("movie" | "tv")[],
): TmdbResult<TmdbSearchResults> => ({
  ok: true,
  data: { seeds, ...(degraded === undefined ? {} : { degraded }) },
});

function podcastsOk(seeds: ItemSeed[]): PodcastSearchEnvelope {
  const parsed = seeds.map((s) => {
    if (s.medium !== "podcast") throw new Error("expected podcast seeds");
    return s;
  });
  return { ok: true, seeds: parsed, spotify: "spotify-unconfigured" };
}

interface Recorder {
  providers: ResolveProviders;
  bookQueries: BookQueryInput[];
  videoQueries: { query: string; scope: TmdbSearchScope }[];
  podcastQueries: string[];
}

/**
 * Each responder decides what a provider answers; the recording wrapper is
 * always in place, so a test can assert both what was asked and what came
 * back. An empty success is the default.
 */
interface FakeResponses {
  books?: () => BooksResult | Promise<BooksResult>;
  video?: () =>
    | TmdbResult<TmdbSearchResults>
    | Promise<TmdbResult<TmdbSearchResults>>;
  podcasts?: () => PodcastSearchEnvelope | Promise<PodcastSearchEnvelope>;
}

function fakes(responses: FakeResponses = {}): Recorder {
  const bookQueries: BookQueryInput[] = [];
  const videoQueries: { query: string; scope: TmdbSearchScope }[] = [];
  const podcastQueries: string[] = [];
  const providers: ResolveProviders = {
    searchBooks: async (query) => {
      bookQueries.push(query);
      return await (responses.books?.() ?? booksOk([]));
    },
    searchVideo: async (query, scope) => {
      videoQueries.push({ query, scope });
      return await (responses.video?.() ?? videoOk([]));
    },
    searchPodcasts: async (query) => {
      podcastQueries.push(query);
      return await (responses.podcasts?.() ?? podcastsOk([]));
    },
  };
  return { providers, bookQueries, videoQueries, podcastQueries };
}

describe("resolve — fan-out", () => {
  it("calls all three providers in parallel, not in sequence", async () => {
    const started: string[] = [];
    let release = (): void => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const held = <T>(name: string, value: T) => async (): Promise<T> => {
      started.push(name);
      await gate;
      return value;
    };

    const { providers } = fakes({
      books: held("books", booksOk([])),
      video: held("video", videoOk([])),
      podcasts: held("podcasts", podcastsOk([])),
    });

    const pending = resolve("dune", { providers });
    // All three are in flight while every one of them is still blocked — a
    // sequential implementation could never reach three.
    await vi.waitFor(() => {
      expect(started).toHaveLength(3);
    });
    release();
    const result = await pending;
    expect(result.ok).toBe(true);
  });

  it("groups by medium and preserves each provider's ranking", async () => {
    const { providers } = fakes({
      books: () =>
        Promise.resolve(
          booksOk([bookSeed("Dune", "OL1W"), bookSeed("Dune Messiah", "OL2W")]),
        ),
      video: () =>
        Promise.resolve(
          videoOk([
            movieSeed("Dune", 438631),
            movieSeed("Dune", 841),
            tvSeed("Dune: The Sisterhood", 89393),
          ]),
        ),
      podcasts: () =>
        Promise.resolve(
          podcastsOk([
            podcastSeed("Gom Jabbar", 1),
            podcastSeed("Dune Pod", 2),
          ]),
        ),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.groups.book.map((s) => s.title)).toEqual([
      "Dune",
      "Dune Messiah",
    ]);
    expect(result.groups.movie.map((s) => s.ref.tmdbId)).toEqual([438631, 841]);
    expect(result.groups.tv.map((s) => s.ref.tmdbId)).toEqual([89393]);
    expect(result.groups.podcast.map((s) => s.ref.appleId)).toEqual([1, 2]);
    expect(result.searched).toEqual(["book", "movie", "tv", "podcast"]);
    expect(result.degraded).toEqual([]);
  });

  it("keeps the same title in different media as separate results", async () => {
    const { providers } = fakes({
      books: () => Promise.resolve(booksOk([bookSeed("Dune", "OL1W")])),
      video: () =>
        Promise.resolve(
          videoOk([movieSeed("Dune", 438631), tvSeed("Dune", 12345)]),
        ),
      podcasts: () =>
        Promise.resolve(podcastsOk([podcastSeed("Dune", 7)])),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.groups.book).toHaveLength(1);
    expect(result.groups.movie).toHaveLength(1);
    expect(result.groups.tv).toHaveLength(1);
    expect(result.groups.podcast).toHaveLength(1);
    for (const group of Object.values(result.groups)) {
      expect(group[0].title).toBe("Dune");
    }
  });

  it("always returns all four groups, even when a medium has no results", async () => {
    const { providers } = fakes();
    const result = await resolve("nothing matches", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(Object.keys(result.groups).sort()).toEqual([
      "book",
      "movie",
      "podcast",
      "tv",
    ]);
    // Searched but not degraded: these are genuine "no results", and the
    // omnibox may say so.
    expect(result.searched).toEqual(["book", "movie", "tv", "podcast"]);
    expect(result.degraded).toEqual([]);
  });
});

describe("resolve — degradation", () => {
  it("marks the books medium degraded and still serves the rest", async () => {
    const { providers } = fakes({
      books: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream_unavailable", message: "both down" },
        }),
      video: () => Promise.resolve(videoOk([movieSeed("Dune", 438631)])),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.degraded).toEqual(["book"]);
    expect(result.groups.book).toEqual([]);
    expect(result.groups.movie).toHaveLength(1);
  });

  it("propagates TMDB's own partial-degradation marker", async () => {
    const { providers } = fakes({
      video: () =>
        Promise.resolve(videoOk([movieSeed("Dune", 438631)], ["tv"])),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.degraded).toEqual(["tv"]);
    expect(result.groups.movie).toHaveLength(1);
  });

  it("never reports a degraded medium that was not searched", async () => {
    // A TMDB marker naming a namespace outside the requested scope must not
    // leak into `degraded` — the type documents `degraded ⊆ searched`.
    const { providers } = fakes({ video: () => videoOk([], ["tv"]) });
    const result = await resolve("dune", {
      media: ["book", "movie"],
      providers,
    });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.searched).toEqual(["book", "movie"]);
    expect(result.degraded).toEqual([]);
  });

  it("marks both movie and tv degraded when the whole TMDB call fails", async () => {
    const { providers } = fakes({
      video: () =>
        Promise.resolve({
          ok: false,
          error: { code: "provider-unreachable", message: "TMDB is down" },
        }),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.degraded).toEqual(["movie", "tv"]);
  });

  it("marks podcasts degraded on a podcast failure", async () => {
    const { providers } = fakes({
      podcasts: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream-unreachable", message: "iTunes is down" },
        }),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.degraded).toEqual(["podcast"]);
  });

  it("treats a provider that throws as a degraded medium, not a crash", async () => {
    const { providers } = fakes({
      podcasts: () => Promise.reject(new Error("boom")),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.degraded).toEqual(["podcast"]);
  });

  it("lists degraded media in canonical order", async () => {
    const { providers } = fakes({
      books: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream_unavailable", message: "books down" },
        }),
      podcasts: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream-unreachable", message: "podcasts down" },
        }),
      video: () => Promise.resolve(videoOk([], ["tv"])),
    });

    const result = await resolve("dune", { providers });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.degraded).toEqual(["book", "tv", "podcast"]);
    // `degraded` is always a subset of `searched`.
    for (const medium of result.degraded) {
      expect(result.searched).toContain(medium);
    }
  });

  it("fails the query only when every provider in scope fails", async () => {
    const { providers } = fakes({
      books: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream_unavailable", message: "books down" },
        }),
      video: () =>
        Promise.resolve({
          ok: false,
          error: { code: "provider-unreachable", message: "tmdb down" },
        }),
      podcasts: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream-unreachable", message: "podcasts down" },
        }),
    });

    const result = await resolve("dune", { providers });
    if (result.ok) throw new Error("expected an error envelope");
    expect(result.error.code).toBe("all-providers-failed");
    expect(result.error.message).toContain("books down");
    expect(result.error.message).toContain("tmdb down");
    expect(result.error.message).toContain("podcasts down");
  });
});

describe("resolve — media scope", () => {
  it("only calls the providers the scope needs", async () => {
    const recorder = fakes();
    const result = await resolve("dune", {
      media: ["book"],
      providers: recorder.providers,
    });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(recorder.bookQueries).toHaveLength(1);
    expect(recorder.videoQueries).toHaveLength(0);
    expect(recorder.podcastQueries).toHaveLength(0);
    expect(result.groups.movie).toEqual([]);
    // Empty *and* never searched: the omnibox must render no movie section
    // at all, rather than "Movies — no results".
    expect(result.searched).toEqual(["book"]);
    expect(result.degraded).toEqual([]);
  });

  it("narrows TMDB's own scope to the requested namespaces", async () => {
    const movieOnly = fakes();
    await resolve("dune", {
      media: ["movie"],
      providers: movieOnly.providers,
    });
    expect(movieOnly.videoQueries).toEqual([{ query: "dune", scope: "movie" }]);

    const tvOnly = fakes();
    await resolve("dune", { media: ["tv"], providers: tvOnly.providers });
    expect(tvOnly.videoQueries).toEqual([{ query: "dune", scope: "tv" }]);

    const both = fakes();
    await resolve("dune", {
      media: ["movie", "tv"],
      providers: both.providers,
    });
    expect(both.videoQueries).toEqual([{ query: "dune", scope: "all" }]);
  });

  it("fails a book-only scope whose only provider is down", async () => {
    const { providers } = fakes({
      books: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream_unavailable", message: "books down" },
        }),
    });
    const result = await resolve("dune", { media: ["book"], providers });
    if (result.ok) throw new Error("expected an error envelope");
    expect(result.error.code).toBe("all-providers-failed");
  });
});

describe("resolve — ISBN path", () => {
  it("routes an ISBN-13 straight to the books lookup and nowhere else", async () => {
    const recorder = fakes({
      books: () =>
        Promise.resolve(booksOk([bookSeed("Dune", "OL893415W")])),
    });
    const result = await resolve("978-0-441-01359-3", {
      providers: recorder.providers,
    });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(recorder.bookQueries).toEqual([{ isbn: "9780441013593" }]);
    expect(recorder.videoQueries).toHaveLength(0);
    expect(recorder.podcastQueries).toHaveLength(0);
    expect(result.groups.book).toHaveLength(1);
    expect(result.groups.movie).toEqual([]);
    // The other three media were never asked, and must not be reported as
    // empty results.
    expect(result.searched).toEqual(["book"]);
    expect(result.degraded).toEqual([]);
  });

  it("hands an ISBN-10 to the provider, which converts it", async () => {
    const recorder = fakes();
    await resolve("0-306-40615-2", { providers: recorder.providers });
    expect(recorder.bookQueries).toEqual([{ isbn: "0306406152" }]);
    expect(recorder.videoQueries).toHaveLength(0);
  });

  it("reports an ISBN nothing matches as a searched, empty books group", async () => {
    const recorder = fakes();
    const result = await resolve("9780441013593", {
      providers: recorder.providers,
    });
    if (!result.ok) throw new Error("expected a success envelope");
    expect(result.groups.book).toEqual([]);
    // Searched, not degraded, nothing found — E1.4's "queue this row for
    // manual match", as distinct from an outage.
    expect(result.searched).toEqual(["book"]);
    expect(result.degraded).toEqual([]);
  });

  it("errors — not degrades — when the ISBN lookup's provider is down", async () => {
    const { providers } = fakes({
      books: () =>
        Promise.resolve({
          ok: false,
          error: { code: "upstream_unavailable", message: "books down" },
        }),
    });
    const result = await resolve("9780441013593", { providers });
    // Books is the only lane an ISBN query runs, so its failure is total.
    if (result.ok) throw new Error("expected an error envelope");
    expect(result.error.code).toBe("all-providers-failed");
  });

  it("treats a number that is not an ISBN as ordinary text", async () => {
    const recorder = fakes();
    // Not a Bookland prefix, and a failed ISBN-10 check digit.
    await resolve("1234567890123", { providers: recorder.providers });
    await resolve("0306406153", { providers: recorder.providers });
    expect(recorder.bookQueries).toEqual([
      { q: "1234567890123" },
      { q: "0306406153" },
    ]);
    expect(recorder.videoQueries).toHaveLength(2);
    expect(recorder.podcastQueries).toHaveLength(2);
  });

  it("does not take the ISBN path when books are out of scope", async () => {
    const recorder = fakes();
    await resolve("9780441013593", {
      media: ["movie"],
      providers: recorder.providers,
    });
    expect(recorder.videoQueries).toEqual([
      { query: "9780441013593", scope: "movie" },
    ]);
  });
});

describe("isbnFromQuery", () => {
  it("accepts both ISBN forms, hyphenated or not", () => {
    expect(isbnFromQuery("978-0-441-01359-3")).toBe("9780441013593");
    expect(isbnFromQuery("9791234567896")).toBe("9791234567896");
    expect(isbnFromQuery("0 306 40615 2")).toBe("0306406152");
    expect(isbnFromQuery("080442957X")).toBe("080442957X");
  });

  it("rejects anything that is not an ISBN", () => {
    expect(isbnFromQuery("dune")).toBeUndefined();
    expect(isbnFromQuery("1234567890123")).toBeUndefined();
    expect(isbnFromQuery("0306406153")).toBeUndefined();
    expect(isbnFromQuery("97804410135")).toBeUndefined();
  });
});

describe("resolve — bad requests", () => {
  it("rejects an empty or whitespace-only query", async () => {
    const { providers } = fakes();
    for (const query of ["", "   "]) {
      const result = await resolve(query, { providers });
      if (result.ok) throw new Error("expected an error envelope");
      expect(result.error.code).toBe("bad-request");
    }
  });

  it("rejects an empty media scope", async () => {
    const { providers } = fakes();
    const result = await resolve("dune", { media: [], providers });
    if (result.ok) throw new Error("expected an error envelope");
    expect(result.error.code).toBe("bad-request");
  });
});
