/**
 * Recorded-response fixtures for E2.1 provider-books.
 *
 * PROVENANCE — hand-built to spec, 2026-07-28. openlibrary.org is not
 * reachable from this build environment (egress allowlist; see EPICS.md
 * status board), and www.googleapis.com was reachable but rate-limited
 * (HTTP 429, daily quota) at recording time. These payloads were therefore
 * constructed faithfully from the documented API shapes rather than piped
 * from live responses:
 *
 *   - Open Library search: https://openlibrary.org/dev/docs/api/search
 *     (`GET /search.json?q=…&fields=…` → { numFound, start, docs: [...] }),
 *     field set matching `OPEN_LIBRARY_FIELDS` in ../books.ts.
 *   - Google Books volumes: https://developers.google.com/books/docs/v1/reference/volumes
 *     (`GET /books/v1/volumes?q=…` → { kind, totalItems, items: [...] }).
 *
 * The live smoke tests in ../books.smoke.test.ts re-validate these shapes
 * against the real endpoints whenever the host is reachable, so drift
 * between fixture and reality is caught in environments with open egress.
 *
 * Everything is exported as `unknown`: production code must Zod-parse these
 * exactly as it would a live payload.
 */

/**
 * `GET https://openlibrary.org/search.json?q=money+psychology&fields=…&limit=10`
 * Three docs exercising the normalization matrix: a colon-jammed title with
 * no subtitle field (must be demoted), a separate-subtitle doc with a full
 * ratings histogram and duplicate author spellings, and a purely-numeric
 * colon head ("2001: A Space Odyssey") that must NOT be split.
 */
export const openLibrarySearchFixture: unknown = {
  numFound: 3,
  start: 0,
  numFoundExact: true,
  docs: [
    {
      key: "/works/OL17930368W",
      title: "The Psychology of Money: Timeless Lessons on Wealth, Greed, and Happiness",
      author_name: ["Morgan Housel"],
      first_publish_year: 2020,
      cover_i: 10520611,
      isbn: ["0857197681", "9780857197689", "9780857199096"],
      number_of_pages_median: 252,
      ratings_average: 4.24,
      ratings_count: 342,
      ratings_count_1: 6,
      ratings_count_2: 11,
      ratings_count_3: 47,
      ratings_count_4: 110,
      ratings_count_5: 168,
    },
    {
      key: "/works/OL16239762W",
      title: "Debt",
      subtitle: "The First 5,000 Years",
      author_name: ["David Graeber", "David  Graeber", "DAVID GRAEBER"],
      first_publish_year: 2011,
      cover_i: 12300758,
      isbn: ["1933633867", "9781933633862"],
      number_of_pages_median: 534,
      ratings_average: 4.05,
      ratings_count: 88,
      ratings_count_1: 2,
      ratings_count_2: 5,
      ratings_count_3: 14,
      ratings_count_4: 33,
      ratings_count_5: 34,
    },
    {
      key: "/works/OL64583W",
      title: "2001: A Space Odyssey",
      author_name: ["Arthur C. Clarke"],
      first_publish_year: 1968,
      isbn: ["9780451457998"],
      number_of_pages_median: 297,
    },
  ],
};

/**
 * `GET https://openlibrary.org/search.json?q=isbn:9780857197689&fields=…&limit=1`
 * — the E1.4 importer's hit path. The doc's own isbn list (all editions,
 * unordered — ISBN-10s and other editions' 13s mixed) is deliberately
 * untrusted; the provider must stamp the *queried* ISBN into the ref.
 */
export const openLibraryIsbnHitFixture: unknown = {
  numFound: 1,
  start: 0,
  numFoundExact: true,
  docs: [
    {
      key: "/works/OL17930368W",
      title: "The Psychology of Money",
      subtitle: "Timeless Lessons on Wealth, Greed, and Happiness",
      author_name: ["Morgan Housel"],
      first_publish_year: 2020,
      cover_i: 10520611,
      isbn: ["0857197681", "9780857199096", "9780857197689"],
      number_of_pages_median: 252,
      ratings_average: 4.24,
      ratings_count: 342,
    },
  ],
};

/** An ISBN that matches nothing: Open Library returns an empty doc set. */
export const openLibraryIsbnMissFixture: unknown = {
  numFound: 0,
  start: 0,
  numFoundExact: true,
  docs: [],
};

/**
 * Structurally broken payload — the shape an outage page or API change can
 * produce. Valid JSON, wrong shape: `docs` is an object, `numFound` a string.
 */
export const openLibraryMalformedFixture: unknown = {
  numFound: "lots",
  docs: { oops: true },
};

/**
 * A sound envelope with one rotten doc in the middle (missing `key`, title
 * as a number) — per-doc resilience: the good docs around it must survive.
 */
export const openLibraryPartiallyMalformedFixture: unknown = {
  numFound: 3,
  start: 0,
  numFoundExact: true,
  docs: [
    {
      key: "/works/OL16239762W",
      title: "Debt",
      subtitle: "The First 5,000 Years",
      author_name: ["David Graeber"],
      first_publish_year: 2011,
    },
    {
      title: 4041,
      author_name: "not-an-array",
    },
    {
      key: "/works/OL64583W",
      title: "2001: A Space Odyssey",
      author_name: ["Arthur C. Clarke"],
      first_publish_year: 1968,
    },
  ],
};

/**
 * `GET https://www.googleapis.com/books/v1/volumes?q=money+psychology&country=US&…`
 * Two volumes: one fully-populated (separate subtitle, description, http
 * imageLinks needing https upgrade) and one minimal (no imageLinks, no
 * identifiers, year-only date). List responses carry only
 * smallThumbnail/thumbnail — the larger renditions (small…extraLarge)
 * appear on single-volume GETs only — so the provider must upscale the
 * zoom=1 thumbnail rather than expect a bigger link here.
 */
export const googleBooksSearchFixture: unknown = {
  kind: "books#volumes",
  totalItems: 2,
  items: [
    {
      kind: "books#volume",
      id: "TnMFDAAAQBAJ",
      etag: "8FSs3aaeXPk",
      selfLink: "https://www.googleapis.com/books/v1/volumes/TnMFDAAAQBAJ",
      volumeInfo: {
        title: "The Psychology of Money",
        subtitle: "Timeless Lessons on Wealth, Greed, and Happiness",
        authors: ["Morgan Housel"],
        publisher: "Harriman House Limited",
        publishedDate: "2020-09-08",
        description:
          "Doing well with money isn't necessarily about what you know. It's about how you behave.",
        industryIdentifiers: [
          { type: "ISBN_10", identifier: "0857197681" },
          { type: "ISBN_13", identifier: "9780857197689" },
        ],
        pageCount: 252,
        printType: "BOOK",
        categories: ["Business & Economics"],
        averageRating: 4.5,
        ratingsCount: 128,
        imageLinks: {
          smallThumbnail:
            "http://books.google.com/books/content?id=TnMFDAAAQBAJ&printsec=frontcover&img=1&zoom=5&source=gbs_api",
          thumbnail:
            "http://books.google.com/books/content?id=TnMFDAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api",
        },
        language: "en",
      },
    },
    {
      kind: "books#volume",
      id: "kD4KzQEACAAJ",
      etag: "u1QniQZuLqw",
      selfLink: "https://www.googleapis.com/books/v1/volumes/kD4KzQEACAAJ",
      volumeInfo: {
        title: "Money Psychology Workbook",
        authors: ["Jane Example"],
        publishedDate: "2019",
        printType: "BOOK",
        language: "en",
      },
    },
  ],
};

/**
 * `GET https://www.googleapis.com/books/v1/volumes?q=isbn:9780857197689&country=US&…`
 * — Google's ISBN hit path, used when Open Library is down.
 */
export const googleBooksIsbnHitFixture: unknown = {
  kind: "books#volumes",
  totalItems: 1,
  items: [
    {
      kind: "books#volume",
      id: "TnMFDAAAQBAJ",
      etag: "8FSs3aaeXPk",
      selfLink: "https://www.googleapis.com/books/v1/volumes/TnMFDAAAQBAJ",
      volumeInfo: {
        title: "The Psychology of Money: Timeless Lessons on Wealth, Greed, and Happiness",
        authors: ["Morgan Housel"],
        publishedDate: "2020-09-08",
        description:
          "Doing well with money isn't necessarily about what you know. It's about how you behave.",
        industryIdentifiers: [
          { type: "ISBN_13", identifier: "9780857197689" },
          { type: "ISBN_10", identifier: "0857197681" },
        ],
        pageCount: 252,
        printType: "BOOK",
        imageLinks: {
          thumbnail:
            "http://books.google.com/books/content?id=TnMFDAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api",
        },
        language: "en",
      },
    },
  ],
};

/** Google's miss shape: `items` is simply absent when totalItems is 0. */
export const googleBooksIsbnMissFixture: unknown = {
  kind: "books#volumes",
  totalItems: 0,
};

/** Wrong-shaped Google payload: `items` not an array. */
export const googleBooksMalformedFixture: unknown = {
  kind: "books#volumes",
  totalItems: 1,
  items: "unexpectedly-a-string",
};
