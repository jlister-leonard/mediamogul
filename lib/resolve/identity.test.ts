import { describe, expect, it } from "vitest";
import { demoteSubtitle } from "../providers/books";
import { itemSeedSchema } from "../types";
import {
  dedupeBooks,
  dedupeByTmdbId,
  dedupePodcasts,
  isSameBook,
  mergeBookSeeds,
  normalizeName,
  type BookSeed,
  type MovieSeed,
  type PodcastSeed,
  type TvSeed,
} from "./identity";

/**
 * Fixtures go through the shared contract on the way in, so a test can never
 * assert a merge over something the app would reject anyway.
 */
function book(candidate: unknown): BookSeed {
  const seed = itemSeedSchema.parse(candidate);
  if (seed.medium !== "book") throw new Error("expected a book seed");
  return seed;
}

function movie(tmdbId: number, title: string): MovieSeed {
  const seed = itemSeedSchema.parse({
    medium: "movie",
    ref: { medium: "movie", tmdbId },
    title,
    creators: [],
  });
  if (seed.medium !== "movie") throw new Error("expected a movie seed");
  return seed;
}

function tv(tmdbId: number, title: string): TvSeed {
  const seed = itemSeedSchema.parse({
    medium: "tv",
    ref: { medium: "tv", tmdbId },
    title,
    creators: [],
  });
  if (seed.medium !== "tv") throw new Error("expected a tv seed");
  return seed;
}

function podcast(appleId: number, title: string): PodcastSeed {
  const seed = itemSeedSchema.parse({
    medium: "podcast",
    ref: { medium: "podcast", appleId },
    title,
    creators: [],
  });
  if (seed.medium !== "podcast") throw new Error("expected a podcast seed");
  return seed;
}

/** An Open Library text-search seed: work id only, `-L` cover, histogram, no description. */
const olDune = book({
  medium: "book",
  ref: { medium: "book", openLibraryId: "OL893415W" },
  title: "Dune",
  creators: ["Frank Herbert"],
  year: 1965,
  artUrl: "https://covers.openlibrary.org/b/id/12345-L.jpg",
  pages: 577,
  communityRating: {
    average: 4.2,
    count: 900,
    histogram: [10, 20, 100, 300, 470],
  },
});

/** A Google Books seed for the same work: edition isbn13, description, no histogram. */
const gbDune = book({
  medium: "book",
  ref: {
    medium: "book",
    isbn13: "9780441013593",
    googleBooksId: "B1hSG45JCX4C",
  },
  title: "Dune",
  creators: ["Frank Herbert"],
  year: 2005,
  artUrl: "https://books.google.com/books/content?id=B1hSG45JCX4C&zoom=3",
  description: "Set on the desert planet Arrakis.",
  communityRating: { average: 4.5, count: 120 },
});

describe("normalizeName", () => {
  it("folds case, diacritics and punctuation", () => {
    expect(normalizeName("Les Misérables!")).toBe("les miserables");
    expect(normalizeName("  THE  Hobbit,   ")).toBe("the hobbit");
  });

  it("keeps non-Latin scripts instead of collapsing them to nothing", () => {
    expect(normalizeName("三体")).toBe("三体");
    // Diacritic folding applies to every script — Cyrillic й decomposes to и —
    // which is harmless because it applies to both sides of a comparison.
    expect(normalizeName("Война и мир")).toBe("воина и мир");
    expect(normalizeName("Война и мир")).toBe(normalizeName("ВОЙНА И МИР"));
  });

  it("returns the empty string only when there are no letters or numbers", () => {
    expect(normalizeName("🎧🎧")).toBe("");
  });
});

describe("isSameBook", () => {
  it("matches on a shared isbn13", () => {
    const a = book({
      medium: "book",
      ref: { medium: "book", isbn13: "9780441013593", googleBooksId: "aaa" },
      title: "Dune",
      creators: ["Frank Herbert"],
    });
    const b = book({
      medium: "book",
      ref: { medium: "book", isbn13: "9780441013593", googleBooksId: "bbb" },
      title: "Dune (Deluxe Edition)",
      creators: ["Herbert, Frank"],
    });
    expect(isSameBook(a, b)).toBe(true);
  });

  it("matches on a shared openLibraryId and on a shared googleBooksId", () => {
    const ol = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL893415W" },
      title: "Dune",
      creators: [],
    });
    const olAgain = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL893415W" },
      title: "Completely Different Cataloguing",
      creators: ["Someone Else"],
    });
    expect(isSameBook(ol, olAgain)).toBe(true);

    const gb = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "B1hSG45JCX4C" },
      title: "Dune",
      creators: [],
    });
    const gbAgain = book({
      medium: "book",
      ref: {
        medium: "book",
        isbn13: "9780441013593",
        googleBooksId: "B1hSG45JCX4C",
      },
      title: "Dune",
      creators: [],
    });
    expect(isSameBook(gb, gbAgain)).toBe(true);
  });

  it("matches an Open Library work to a Google Books volume on title + author", () => {
    // The cross-provider case: no id in common, ever.
    expect(isSameBook(olDune, gbDune)).toBe(true);
  });

  it("ignores case, diacritics and punctuation in the title", () => {
    const a = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL1W" },
      title: "Les Misérables",
      creators: ["Victor Hugo"],
    });
    const b = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-1" },
      title: "les miserables",
      creators: ["victor hugo"],
    });
    expect(isSameBook(a, b)).toBe(true);
  });

  it("keeps same-title books by different authors apart", () => {
    const a = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL1W" },
      title: "Blindness",
      creators: ["José Saramago"],
    });
    const b = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-1" },
      title: "Blindness",
      creators: ["Henry Green"],
    });
    expect(isSameBook(a, b)).toBe(false);
  });

  it("accepts a title match when one side names no author", () => {
    const anonymous = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-1" },
      title: "Dune",
      creators: [],
    });
    expect(isSameBook(olDune, anonymous)).toBe(true);
  });

  /**
   * Regression (E2.4 review F1): `demoteSubtitle` splits every title at its
   * first colon, so a series arrives as N seeds sharing one title and one
   * author. Collapsing them deletes books — the failure mode dedupe must
   * never have.
   */
  describe("series volumes stay distinct", () => {
    /**
     * Built through the provider's own `demoteSubtitle`, so these fixtures
     * carry exactly the title/subtitle split a real Open Library doc gets —
     * the split that caused the collapse.
     */
    const shelf = (
      openLibraryId: string,
      rawTitle: string,
      author: string,
      year?: number,
    ): BookSeed =>
      book({
        medium: "book",
        ref: { medium: "book", openLibraryId },
        ...demoteSubtitle(rawTitle),
        creators: [author],
        ...(year === undefined ? {} : { year }),
      });

    it("keeps all four volumes of The Years of Lyndon Johnson apart", () => {
      const caro = "Robert A. Caro";
      const volumes = [
        shelf("OL2W", "The Years of Lyndon Johnson: The Path to Power", caro, 1982),
        shelf("OL3W", "The Years of Lyndon Johnson: Means of Ascent", caro, 1990),
        shelf("OL4W", "The Years of Lyndon Johnson: Master of the Senate", caro, 2002),
        shelf("OL5W", "The Years of Lyndon Johnson: The Passage of Power", caro, 2012),
      ];
      // Every volume shares a title and an author after the split.
      expect(new Set(volumes.map((v) => v.title)).size).toBe(1);
      expect(dedupeBooks(volumes)).toHaveLength(4);
      expect(isSameBook(volumes[0], volumes[1])).toBe(false);
    });

    it("keeps My Struggle's volumes apart even when they share a year", () => {
      // The subtitle veto has to stand on its own: the year veto cannot fire
      // when two volumes were published in the same year.
      const knausgaard = "Karl Ove Knausgaard";
      const one = shelf("OL10W", "My Struggle: Book One", knausgaard, 2009);
      const two = shelf("OL11W", "My Struggle: Book Two", knausgaard, 2009);
      expect(one.year).toBe(two.year);
      expect(isSameBook(one, two)).toBe(false);
      expect(dedupeBooks([one, two])).toHaveLength(2);
    });

    it("keeps a book and its graphic adaptation apart", () => {
      const harari = "Yuval Noah Harari";
      const sapiens = shelf(
        "OL20W",
        "Sapiens: A Brief History of Humankind",
        harari,
      );
      const graphic = shelf("OL21W", "Sapiens: A Graphic History", harari);
      expect(dedupeBooks([sapiens, graphic])).toHaveLength(2);
    });

    it("keeps same-title records from one catalogue that are years apart", () => {
      // No subtitles at all: the year veto is the only thing standing between
      // two different works and a silent deletion.
      const earlier = book({
        medium: "book",
        ref: { medium: "book", openLibraryId: "OL30W" },
        title: "Selected Poems",
        creators: ["Robert Frost"],
        year: 1963,
      });
      const later = book({
        medium: "book",
        ref: { medium: "book", openLibraryId: "OL31W" },
        title: "Selected Poems",
        creators: ["Robert Frost"],
        year: 2011,
      });
      expect(dedupeBooks([earlier, later])).toHaveLength(2);
    });
  });

  /**
   * Regression (E2.4 delta-verify N1/N2): `isbn13` and `googleBooksId` are
   * EDITION-level ids, so differing values are what edition duplicates are
   * made of — never evidence of different works. Every earlier isbn13 fixture
   * used one shared value, which is exactly why nothing caught this.
   */
  describe("edition duplicates still collapse", () => {
    const edition = (
      googleBooksId: string,
      isbn13: string,
      year: number,
    ): BookSeed =>
      book({
        medium: "book",
        ref: { medium: "book", isbn13, googleBooksId },
        title: "Dune",
        creators: ["Frank Herbert"],
        year,
      });

    it("merges two editions whose ISBNs differ", () => {
      const first = edition("gb-a", "9780441013593", 1965);
      const second = edition("gb-b", "9780441172719", 1965);
      expect(first.ref.isbn13).not.toBe(second.ref.isbn13);
      expect(isSameBook(first, second)).toBe(true);
    });

    it("collapses Google's spread-year editions of one book to a single card", () => {
      // Google Books supplies publishedDate for most volumes, so the same
      // work routinely arrives with printing years decades apart.
      const editions = [
        edition("gb-a", "9780441013593", 1965),
        edition("gb-b", "9780441172719", 2005),
        edition("gb-c", "9780593099322", 2019),
      ];
      const merged = dedupeBooks(editions);
      expect(merged).toHaveLength(1);
      expect(itemSeedSchema.parse(merged[0])).toEqual(merged[0]);
      // The highest-ranked edition keeps the record's identity.
      expect(merged[0].ref.isbn13).toBe("9780441013593");
      expect(merged[0].year).toBe(1965);
    });
  });

  it("still merges a subtitle carried by only one source", () => {
    // Open Library and Google Books disagree constantly about whether a
    // subtitle exists, so absence must stay permissive.
    const bare = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL40W" },
      title: "Sapiens",
      creators: ["Yuval Noah Harari"],
    });
    const subtitled = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-40" },
      title: "Sapiens",
      subtitle: "A Brief History of Humankind",
      creators: ["Yuval Noah Harari"],
    });
    expect(isSameBook(bare, subtitled)).toBe(true);
  });

  it("still merges an Open Library work with a Google edition decades apart", () => {
    // The year veto is gated on conflicting ids so it can never fire here:
    // 1965 is Dune's first publication, 2005 is the printing Google matched.
    expect(olDune.year).toBe(1965);
    expect(gbDune.year).toBe(2005);
    expect(isSameBook(olDune, gbDune)).toBe(true);
  });

  it("never matches titles that normalize to nothing", () => {
    const a = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL1W" },
      title: "🎧",
      creators: [],
    });
    const b = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-1" },
      title: "★",
      creators: [],
    });
    expect(isSameBook(a, b)).toBe(false);
  });
});

describe("mergeBookSeeds", () => {
  it("unions the ids and backfills what the higher-ranked seed lacks", () => {
    const merged = mergeBookSeeds(olDune, gbDune);
    expect(itemSeedSchema.parse(merged)).toEqual(merged);

    // The primary keeps its own art and year…
    expect(merged.artUrl).toBe("https://covers.openlibrary.org/b/id/12345-L.jpg");
    expect(merged.year).toBe(1965);
    // …and the secondary fills the holes: Open Library search carries no
    // description, and a work-id-only ref carries no edition isbn13.
    expect(merged.description).toBe("Set on the desert planet Arrakis.");
    expect(merged.ref).toEqual({
      medium: "book",
      isbn13: "9780441013593",
      openLibraryId: "OL893415W",
      googleBooksId: "B1hSG45JCX4C",
    });
    expect(merged.pages).toBe(577);
  });

  it("prefers the rating carrying a histogram, whichever seed ranked first", () => {
    const merged = mergeBookSeeds(gbDune, olDune);
    expect(itemSeedSchema.parse(merged)).toEqual(merged);

    // Only Open Library exposes the 1★→5★ distribution, so it wins even
    // though Google's seed is the primary.
    expect(merged.communityRating?.histogram).toEqual([10, 20, 100, 300, 470]);
    // Everything else still comes from the higher-ranked seed.
    expect(merged.artUrl).toBe(
      "https://books.google.com/books/content?id=B1hSG45JCX4C&zoom=3",
    );
    expect(merged.year).toBe(2005);
  });

  it("keeps the primary's title and subtitle, and backfills a missing subtitle", () => {
    const withSubtitle = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-1" },
      title: "Debt",
      subtitle: "The First 5,000 Years",
      creators: ["David Graeber"],
    });
    const withoutSubtitle = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL2W" },
      title: "Debt",
      creators: ["David Graeber"],
    });
    expect(mergeBookSeeds(withoutSubtitle, withSubtitle).subtitle).toBe(
      "The First 5,000 Years",
    );
    expect(mergeBookSeeds(withSubtitle, withoutSubtitle).subtitle).toBe(
      "The First 5,000 Years",
    );
  });

  it("takes the other side's authors when the primary lists none", () => {
    const anonymous = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-1" },
      title: "Dune",
      creators: [],
    });
    expect(mergeBookSeeds(anonymous, olDune).creators).toEqual([
      "Frank Herbert",
    ]);
  });

  it("keeps a rating without a histogram when it is the only one", () => {
    const noHistogram = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL2W" },
      title: "Dune",
      creators: ["Frank Herbert"],
    });
    const merged = mergeBookSeeds(noHistogram, gbDune);
    expect(itemSeedSchema.parse(merged)).toEqual(merged);
    expect(merged.communityRating).toEqual({ average: 4.5, count: 120 });
  });
});

describe("dedupeBooks", () => {
  it("collapses every identity rung and re-validates each merge", () => {
    const sameIsbn = book({
      medium: "book",
      ref: { medium: "book", isbn13: "9780441013593", googleBooksId: "other" },
      title: "Dune",
      creators: ["Frank Herbert"],
      description: "Another edition listing.",
    });
    const sameWorkId = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL893415W" },
      title: "Dune",
      creators: ["Frank Herbert"],
    });

    const merged = dedupeBooks([olDune, gbDune, sameIsbn, sameWorkId]);
    expect(merged).toHaveLength(1);
    for (const seed of merged) {
      expect(itemSeedSchema.parse(seed)).toEqual(seed);
    }
    expect(merged[0].ref).toEqual({
      medium: "book",
      isbn13: "9780441013593",
      openLibraryId: "OL893415W",
      googleBooksId: "B1hSG45JCX4C",
    });
  });

  it("keeps the provider's ranking, merging into the highest-ranked position", () => {
    const other = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL999W" },
      title: "Dune Messiah",
      creators: ["Frank Herbert"],
    });
    const deduped = dedupeBooks([olDune, other, gbDune]);
    expect(deduped.map((seed) => seed.title)).toEqual(["Dune", "Dune Messiah"]);
    expect(deduped[0].description).toBe("Set on the desert planet Arrakis.");
  });

  it("leaves genuinely different books alone", () => {
    const saramago = book({
      medium: "book",
      ref: { medium: "book", openLibraryId: "OL3W" },
      title: "Blindness",
      creators: ["José Saramago"],
    });
    const green = book({
      medium: "book",
      ref: { medium: "book", googleBooksId: "gb-9" },
      title: "Blindness",
      creators: ["Henry Green"],
    });
    expect(dedupeBooks([saramago, green])).toHaveLength(2);
  });
});

describe("dedupeByTmdbId", () => {
  it("keeps the first occurrence and preserves order", () => {
    const deduped = dedupeByTmdbId([
      movie(438631, "Dune"),
      movie(841, "Dune"),
      movie(438631, "Dune"),
    ]);
    expect(deduped.map((seed) => seed.ref.tmdbId)).toEqual([438631, 841]);
  });

  it("does not confuse a movie id with a TV id of the same number", () => {
    // Movies and TV are separate TMDB namespaces, and separate groups.
    expect(dedupeByTmdbId([movie(1, "Dune")])).toHaveLength(1);
    expect(dedupeByTmdbId([tv(1, "Dune")])).toHaveLength(1);
  });
});

describe("dedupePodcasts", () => {
  it("dedupes on appleId, preserving order", () => {
    const deduped = dedupePodcasts([
      podcast(1, "Gastropod"),
      podcast(2, "Dune Pod"),
      podcast(1, "Gastropod"),
    ]);
    expect(deduped.map((seed) => seed.ref.appleId)).toEqual([1, 2]);
  });

  it("never folds a show that carries no appleId", () => {
    const spotifyOnly = itemSeedSchema.parse({
      medium: "podcast",
      ref: { medium: "podcast", spotifyShowId: "abc" },
      title: "Gastropod",
      creators: [],
    });
    if (spotifyOnly.medium !== "podcast") throw new Error("expected a podcast");
    expect(dedupePodcasts([spotifyOnly, spotifyOnly])).toHaveLength(2);
  });
});
