import type { BookSeed } from "../providers/books";
import type { PodcastSeed } from "../providers/podcasts";
import { itemSeedSchema, type ItemSeed } from "../types";

/**
 * E2.4 identity — how two provider results become one item.
 *
 * Every rule here is a *positive* match: seeds collapse only on evidence that
 * they are the same real-world thing. Nothing in this file compares across
 * media; a "Dune" book, a "Dune" film and a "Dune" podcast never meet,
 * because `resolve()` groups by medium before any of these functions run.
 *
 * When evidence conflicts, dedupe fails toward showing two cards. A duplicate
 * row is a blemish; a deleted book is a book the reader can never find.
 */

export type { BookSeed, PodcastSeed };
/** TMDB exports no seed aliases of its own; these narrow the shared contract. */
export type MovieSeed = Extract<ItemSeed, { medium: "movie" }>;
export type TvSeed = Extract<ItemSeed, { medium: "tv" }>;

/**
 * Case-, diacritic- and punctuation-insensitive comparison key, mirroring the
 * podcasts provider's `normalizeName`. Unicode-aware: letters and numbers in
 * every script survive, so a CJK or Cyrillic title never normalizes to the
 * empty string and collides with every other degenerate title. Built via the
 * RegExp constructor because `\p{…}` property escapes post-date the ES2017
 * compile target; every runtime we ship to supports them.
 */
const NON_ALPHANUMERIC = new RegExp("[^\\p{L}\\p{N}]+", "gu");

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Books                                                              */
/* ------------------------------------------------------------------ */

function normalizedCreators(seed: BookSeed): string[] {
  return seed.creators
    .map(normalizeName)
    .filter((name) => name.length > 0);
}

/**
 * Two different *work* ids are two different works. Only Open Library's id
 * qualifies: it names the work, so two of them that differ are evidence of
 * two books. `isbn13` and `googleBooksId` name an *edition* — differing
 * values there are exactly what edition duplicates are made of, and treating
 * them as conflict would split the same book across three cards.
 */
function conflictingIds(a: BookSeed, b: BookSeed): boolean {
  return (
    a.ref.openLibraryId !== undefined &&
    b.ref.openLibraryId !== undefined &&
    a.ref.openLibraryId !== b.ref.openLibraryId
  );
}

/**
 * How far apart two records of the same book may be dated. Catalogues
 * disagree by a year on reprints and revised printings; volumes of a series
 * are published years apart.
 */
const EDITION_YEAR_WINDOW = 1;

/**
 * The identity ladder from the top down:
 *
 * 1. **isbn13** — both carry one and they are equal: the same edition, done.
 * 2. **openLibraryId / googleBooksId** — the same provider record.
 * 3. **normalized title + author, minus two vetoes** — the cross-provider
 *    case, since an Open Library text-search seed carries only a work id and
 *    a Google Books seed only a volume id, so no id can ever line them up.
 *
 * A *differing* isbn13 is deliberately not a veto: Google Books returns one
 * volume per edition, so the same work arrives several times with different
 * ISBNs, and an omnibox that lists "Dune" five times has failed. Rung 3
 * collapses those editions; the surviving seed keeps the highest-ranked
 * edition's identity.
 *
 * Rung 3 is the only rung that can fire on the Open Library path — the one
 * that is almost always live — so it carries two vetoes, following the rule
 * E2.3 was failed and fixed for (`podcasts.ts`: a known field is a VETO, not
 * a tiebreak):
 *
 * - **Subtitle.** `demoteSubtitle` splits every title at its first colon, so
 *   *The Years of Lyndon Johnson: Means of Ascent* and *…: The Path to Power*
 *   arrive sharing a title and an author, differing only here. Every volume
 *   of every series looks like this. Two subtitles that disagree are two
 *   books; a subtitle present on one side only stays permissive, because
 *   Open Library and Google Books disagree constantly about whether a
 *   subtitle exists at all.
 * - **Year, when the *work* ids also conflict.** Two Open Library works with
 *   different ids and publication years further apart than a reprint window
 *   are different books. Gated on `conflictingIds` — work-level ids only — so
 *   it can never fire between editions, whose years legitimately differ by
 *   decades (first publication vs. this printing) and whose differing ISBNs
 *   are the duplication rung 3 exists to collapse.
 *
 * Author agreement is required only when both sides name an author — Open
 * Library lists every contributor while Google Books often lists none, and
 * one shared name is enough to confirm a title match.
 */
export function isSameBook(a: BookSeed, b: BookSeed): boolean {
  if (
    a.ref.isbn13 !== undefined &&
    b.ref.isbn13 !== undefined &&
    a.ref.isbn13 === b.ref.isbn13
  ) {
    return true;
  }
  if (
    a.ref.openLibraryId !== undefined &&
    a.ref.openLibraryId === b.ref.openLibraryId
  ) {
    return true;
  }
  if (
    a.ref.googleBooksId !== undefined &&
    a.ref.googleBooksId === b.ref.googleBooksId
  ) {
    return true;
  }

  const title = normalizeName(a.title);
  // A title that normalizes to nothing can never match confidently — without
  // this guard it would "equal" every other degenerate title.
  if (title.length === 0 || title !== normalizeName(b.title)) return false;

  if (
    a.subtitle !== undefined &&
    b.subtitle !== undefined &&
    normalizeName(a.subtitle) !== normalizeName(b.subtitle)
  ) {
    return false;
  }

  if (
    a.year !== undefined &&
    b.year !== undefined &&
    Math.abs(a.year - b.year) > EDITION_YEAR_WINDOW &&
    conflictingIds(a, b)
  ) {
    return false;
  }

  const authorsA = normalizedCreators(a);
  const authorsB = normalizedCreators(b);
  if (authorsA.length === 0 || authorsB.length === 0) return true;
  return authorsA.some((name) => authorsB.includes(name));
}

function toBookSeed(candidate: unknown): BookSeed | undefined {
  const parsed = itemSeedSchema.safeParse(candidate);
  return parsed.success && parsed.data.medium === "book"
    ? parsed.data
    : undefined;
}

/**
 * Field-level merge of two seeds for the same book. `primary` is the
 * higher-ranked seed and owns the record's identity (title, subtitle,
 * position); `secondary` fills the gaps. One rule overrides "primary wins":
 *
 * - **The rating with a histogram wins.** Only Open Library exposes the
 *   1★→5★ distribution behind "this one splits people" (E3.3), so preferring
 *   the histogram carrier prefers Open Library's rating without sniffing
 *   sources.
 *
 * Everything else is `primary ?? secondary`, which is what backfills Google
 * Books' description onto an Open Library seed (OL's search API returns no
 * descriptions at all) and its edition `isbn13` onto a ref that had only a
 * work id.
 *
 * There is deliberately no source-aware preference for art or year — the
 * books provider is primary→fallback, so a single search returns Open
 * Library's seeds or Google's, never both, and such a rule could not fire.
 * It belongs here the day the provider gains a union mode (bead filed), and
 * not a day earlier.
 *
 * The result is re-validated against `itemSeedSchema`: a merge may never
 * emit something the rest of the app cannot parse.
 */
export function mergeBookSeeds(
  primary: BookSeed,
  secondary: BookSeed,
): BookSeed {
  const isbn13 = primary.ref.isbn13 ?? secondary.ref.isbn13;
  const openLibraryId =
    primary.ref.openLibraryId ?? secondary.ref.openLibraryId;
  const googleBooksId =
    primary.ref.googleBooksId ?? secondary.ref.googleBooksId;

  const subtitle = primary.subtitle ?? secondary.subtitle;
  const creators =
    primary.creators.length > 0 ? primary.creators : secondary.creators;
  const year = primary.year ?? secondary.year;
  const artUrl = primary.artUrl ?? secondary.artUrl;
  const description = primary.description ?? secondary.description;
  const pages = primary.pages ?? secondary.pages;
  const communityRating =
    primary.communityRating?.histogram !== undefined
      ? primary.communityRating
      : secondary.communityRating?.histogram !== undefined
        ? secondary.communityRating
        : (primary.communityRating ?? secondary.communityRating);

  const merged = toBookSeed({
    medium: "book",
    ref: {
      medium: "book",
      ...(isbn13 !== undefined && { isbn13 }),
      ...(openLibraryId !== undefined && { openLibraryId }),
      ...(googleBooksId !== undefined && { googleBooksId }),
    },
    title: primary.title,
    ...(subtitle !== undefined && { subtitle }),
    creators,
    ...(year !== undefined && { year }),
    ...(artUrl !== undefined && { artUrl }),
    ...(description !== undefined && { description }),
    ...(pages !== undefined && { pages }),
    ...(communityRating !== undefined && { communityRating }),
  });
  // Unreachable with well-formed inputs — both sides already parsed — but a
  // merge is never allowed to degrade a valid seed into an invalid one.
  return merged ?? primary;
}

/**
 * Collapses same-book seeds, preserving the provider's ranking: a merged
 * seed keeps the position of its highest-ranked member.
 */
export function dedupeBooks(seeds: readonly BookSeed[]): BookSeed[] {
  const kept: BookSeed[] = [];
  for (const seed of seeds) {
    const at = kept.findIndex((existing) => isSameBook(existing, seed));
    if (at === -1) kept.push(seed);
    else kept[at] = mergeBookSeeds(kept[at], seed);
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Video and podcasts                                                 */
/* ------------------------------------------------------------------ */

/**
 * TMDB is the sole movie/TV source (PLAN §8), so its id is the whole
 * identity — and the only safe one: search payloads carry no credits, so
 * every search seed has `creators: []` and a title+creator rule would fold
 * unrelated titles together. Movie and TV ids live in separate TMDB
 * namespaces, which is why this runs per group, never across the two.
 */
export function dedupeByTmdbId<T extends MovieSeed | TvSeed>(
  seeds: readonly T[],
): T[] {
  const seen = new Set<number>();
  return seeds.filter((seed) => {
    if (seen.has(seed.ref.tmdbId)) return false;
    seen.add(seed.ref.tmdbId);
    return true;
  });
}

/**
 * Apple's collection id is the podcast provider's primary key (every iTunes
 * seed carries one). A seed without one — only reachable if a future source
 * supplies Spotify-only shows — is never folded into another.
 */
export function dedupePodcasts(seeds: readonly PodcastSeed[]): PodcastSeed[] {
  const seen = new Set<number>();
  return seeds.filter((seed) => {
    const appleId = seed.ref.appleId;
    if (appleId === undefined) return true;
    if (seen.has(appleId)) return false;
    seen.add(appleId);
    return true;
  });
}
