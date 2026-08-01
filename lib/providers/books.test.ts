import { describe, expect, it } from "vitest";
import { dedupeBooks } from "../resolve/identity";
import { itemSeedSchema } from "../types";
import {
  booksErrorSchema,
  booksResultSchema,
  createBooksProvider,
  demoteSubtitle,
  googleBooksUrl,
  isbn10To13,
  openLibraryUrl,
  bookQuerySchema,
  type BooksProvider,
  type BooksResult,
} from "./books";
import {
  googleBooksIsbnHitFixture,
  googleBooksIsbnMissFixture,
  googleBooksMalformedFixture,
  googleBooksSearchFixture,
  openLibraryIsbnHitFixture,
  openLibraryIsbnMissFixture,
  openLibraryMalformedFixture,
  openLibraryPartiallyMalformedFixture,
  openLibrarySearchFixture,
} from "./fixtures/books";

/**
 * A fake upstream: routes openlibrary.org and googleapis.com requests to
 * canned bodies (or failures) and counts hits per host.
 */
function fakeUpstreams(handlers: {
  openlibrary?: () => Response | Promise<Response>;
  googlebooks?: () => Response | Promise<Response>;
}) {
  const hits = { openlibrary: 0, googlebooks: 0 };
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://openlibrary.org/")) {
      hits.openlibrary += 1;
      if (handlers.openlibrary === undefined) {
        throw new TypeError("fetch failed: openlibrary unreachable");
      }
      return handlers.openlibrary();
    }
    if (url.startsWith("https://www.googleapis.com/")) {
      hits.googlebooks += 1;
      if (handlers.googlebooks === undefined) {
        throw new TypeError("fetch failed: googleapis unreachable");
      }
      return handlers.googlebooks();
    }
    throw new Error(`unexpected upstream: ${url}`);
  };
  return { fetchFn, hits };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function providerWith(
  handlers: Parameters<typeof fakeUpstreams>[0],
  options: Parameters<typeof createBooksProvider>[0] = {},
): { provider: BooksProvider; hits: { openlibrary: number; googlebooks: number } } {
  const { fetchFn, hits } = fakeUpstreams(handlers);
  return { provider: createBooksProvider({ fetchFn, ...options }), hits };
}

function expectOk(result: BooksResult): Extract<BooksResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
  return result;
}

describe("demoteSubtitle (PLAN §2: short title, demoted subtitle)", () => {
  it("keeps a provider-supplied subtitle separate, never concatenated", () => {
    expect(demoteSubtitle("Debt", "The First 5,000 Years")).toEqual({
      title: "Debt",
      subtitle: "The First 5,000 Years",
    });
  });

  it("splits a colon-jammed title into title + demoted subtitle", () => {
    expect(
      demoteSubtitle(
        "The Psychology of Money: Timeless Lessons on Wealth, Greed, and Happiness",
      ),
    ).toEqual({
      title: "The Psychology of Money",
      subtitle: "Timeless Lessons on Wealth, Greed, and Happiness",
    });
  });

  it("never splits a purely numeric head — '2001: A Space Odyssey' is one title", () => {
    expect(demoteSubtitle("2001: A Space Odyssey")).toEqual({
      title: "2001: A Space Odyssey",
    });
  });

  it("never splits a single-character head — 'V: The Original Miniseries' is one title", () => {
    expect(demoteSubtitle("V: The Original Miniseries")).toEqual({
      title: "V: The Original Miniseries",
    });
  });

  it("collapses runaway whitespace in both fields", () => {
    expect(demoteSubtitle("  Debt \n", " The  First   5,000 Years ")).toEqual({
      title: "Debt",
      subtitle: "The First 5,000 Years",
    });
  });
});

describe("Open Library normalization", () => {
  it("normalizes the search fixture into contract-valid book seeds", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
    });
    const result = expectOk(await provider.search({ q: "money psychology" }));

    expect(result.source).toBe("openlibrary");
    expect(result.seeds).toHaveLength(3);
    for (const seed of result.seeds) {
      expect(itemSeedSchema.safeParse(seed).success).toBe(true);
      expect(seed.medium).toBe("book");
    }

    const [psychology, debt, odyssey] = result.seeds;
    // Colon-jammed upstream title arrives demoted.
    expect(psychology).toMatchObject({
      title: "The Psychology of Money",
      subtitle: "Timeless Lessons on Wealth, Greed, and Happiness",
      creators: ["Morgan Housel"],
      year: 2020,
      pages: 252,
      // Largest rendition (-L), and the bare work id without "/works/".
      artUrl: "https://covers.openlibrary.org/b/id/10520611-L.jpg",
      // No isbn13: a work doc's isbn list spans all editions unordered, so
      // text-search seeds carry the work id only (catalog identity).
      ref: { medium: "book", openLibraryId: "OL17930368W" },
    });
    expect(psychology.ref.isbn13).toBeUndefined();
    // Histogram carried through for the "splits people" verdict (E3.3).
    expect(psychology.communityRating).toEqual({
      average: 4.24,
      count: 342,
      histogram: [6, 11, 47, 110, 168],
    });
    // Duplicate author spellings dedupe case-insensitively, first kept.
    expect(debt.creators).toEqual(["David Graeber"]);
    expect(debt).toMatchObject({ title: "Debt", subtitle: "The First 5,000 Years" });
    // Numeric-head colon title survives unsplit; no cover_i → no artUrl.
    expect(odyssey.title).toBe("2001: A Space Odyssey");
    expect(odyssey.subtitle).toBeUndefined();
    expect(odyssey.artUrl).toBeUndefined();
    // Open Library search results carry no description.
    expect(psychology.description).toBeUndefined();
  });

  it("drops a malformed doc but keeps the sound docs around it", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryPartiallyMalformedFixture),
    });
    const result = expectOk(await provider.search({ q: "resilience" }));
    expect(result.source).toBe("openlibrary");
    expect(result.seeds.map((seed) => seed.title)).toEqual([
      "Debt",
      "2001: A Space Odyssey",
    ]);
  });
});

describe("Google Books normalization", () => {
  it("normalizes the volumes fixture into contract-valid book seeds", async () => {
    const { provider } = providerWith({
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });
    const result = expectOk(await provider.search({ q: "money psychology" }));

    expect(result.source).toBe("googlebooks");
    expect(result.seeds).toHaveLength(2);
    for (const seed of result.seeds) {
      expect(itemSeedSchema.safeParse(seed).success).toBe(true);
    }

    const [full, minimal] = result.seeds;
    expect(full).toMatchObject({
      title: "The Psychology of Money",
      subtitle: "Timeless Lessons on Wealth, Greed, and Happiness",
      creators: ["Morgan Housel"],
      year: 2020, // from "2020-09-08"
      pages: 252,
      description:
        "Doing well with money isn't necessarily about what you know. It's about how you behave.",
      communityRating: { average: 4.5, count: 128 },
      ref: {
        medium: "book",
        isbn13: "9780857197689",
        googleBooksId: "TnMFDAAAQBAJ",
      },
    });
    // List responses only offer thumbnails: the zoom=1 thumbnail is
    // upgraded to https and rewritten to zoom=3 (detail-page size, not a
    // postage stamp).
    expect(full.artUrl).toBe(
      "https://books.google.com/books/content?id=TnMFDAAAQBAJ&printsec=frontcover&img=1&zoom=3&source=gbs_api",
    );
    // Minimal volume: year from bare "2019", ref has only the Google id.
    expect(minimal).toMatchObject({
      title: "Money Psychology Workbook",
      year: 2019,
      ref: { medium: "book", googleBooksId: "kD4KzQEACAAJ" },
    });
    expect(minimal.artUrl).toBeUndefined();
    expect(minimal.ref.isbn13).toBeUndefined();
  });
});

describe("primary → fallback degradation", () => {
  it("still short-circuits after an Open Library success", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });

    const result = expectOk(await provider.search({ q: "money" }));

    expect(result.source).toBe("openlibrary");
    expect(hits).toEqual({ openlibrary: 1, googlebooks: 0 });
  });

  it("falls back to Google Books when Open Library is unreachable", async () => {
    const { provider, hits } = providerWith({
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });
    const result = expectOk(await provider.search({ q: "money" }));
    expect(result.source).toBe("googlebooks");
    expect(hits).toEqual({ openlibrary: 1, googlebooks: 1 });
  });

  it("falls back when Open Library answers with an HTTP error", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse({ error: "nope" }, 503),
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });
    expect(expectOk(await provider.search({ q: "money" })).source).toBe(
      "googlebooks",
    );
  });

  it("falls back when Open Library returns a wrong-shaped payload", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryMalformedFixture),
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });
    expect(expectOk(await provider.search({ q: "money" })).source).toBe(
      "googlebooks",
    );
  });

  it("both upstreams down → typed upstream_unavailable envelope, per-source reasons", async () => {
    const { provider } = providerWith({});
    const result = await provider.search({ q: "money" });
    expect(booksErrorSchema.safeParse(result).success).toBe(true);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("upstream_unavailable");
    expect(result.error.upstream?.map((u) => u.source)).toEqual([
      "openlibrary",
      "googlebooks",
    ]);
  });

  it("both upstreams malformed → upstream_malformed", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryMalformedFixture),
      googlebooks: () => jsonResponse(googleBooksMalformedFixture),
    });
    const result = await provider.search({ q: "money" });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("upstream_malformed");
  });

  it("non-JSON body (an HTML outage page) degrades to the envelope, never a throw", async () => {
    const { provider } = providerWith({
      openlibrary: () =>
        new Response("<html>503 Service Unavailable</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      googlebooks: () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const result = await provider.search({ q: "money" });
    expect(booksResultSchema.safeParse(result).success).toBe(true);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("upstream_malformed");
  });
});

describe("union mode (E2.6)", () => {
  it("queries both sources concurrently and the resolver builds one enriched card", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider, hits } = providerWith({
      openlibrary: async () => {
        await gate;
        return jsonResponse(openLibrarySearchFixture);
      },
      googlebooks: async () => {
        await gate;
        return jsonResponse(googleBooksSearchFixture);
      },
    });

    const pending = provider.search(
      { q: "money psychology" },
      { mode: "union" },
    );
    expect(hits).toEqual({ openlibrary: 1, googlebooks: 1 });
    release();
    const result = expectOk(await pending);

    expect(result.source).toBe("union");
    expect(result.degraded).toBeUndefined();
    expect(result.seeds).toHaveLength(5);
    const merged = dedupeBooks(result.seeds);
    expect(merged).toHaveLength(4);
    const psychology = merged.find(
      (seed) => seed.title === "The Psychology of Money",
    );
    expect(psychology).toMatchObject({
      year: 2020,
      artUrl: "https://covers.openlibrary.org/b/id/10520611-L.jpg",
      description:
        "Doing well with money isn't necessarily about what you know. It's about how you behave.",
      communityRating: {
        average: 4.24,
        count: 342,
        histogram: [6, 11, 47, 110, 168],
      },
      ref: {
        medium: "book",
        openLibraryId: "OL17930368W",
        googleBooksId: "TnMFDAAAQBAJ",
        isbn13: "9780857197689",
      },
    });
  });

  it("keeps either successful result set and reports the failed source", async () => {
    const googleOnly = providerWith({
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });
    const fromGoogle = expectOk(
      await googleOnly.provider.search({ q: "money" }, { mode: "union" }),
    );
    expect(fromGoogle).toMatchObject({
      source: "googlebooks",
      degraded: ["openlibrary"],
    });
    expect(fromGoogle.seeds).toHaveLength(2);
    expect(googleOnly.hits).toEqual({ openlibrary: 1, googlebooks: 1 });

    const openLibraryOnly = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
    });
    const fromOpenLibrary = expectOk(
      await openLibraryOnly.provider.search(
        { q: "money" },
        { mode: "union" },
      ),
    );
    expect(fromOpenLibrary).toMatchObject({
      source: "openlibrary",
      degraded: ["googlebooks"],
    });
    expect(fromOpenLibrary.seeds).toHaveLength(3);
  });

  it("refetches a degraded union after recovery, then caches the complete result", async () => {
    let googleHealthy = false;
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
      googlebooks: () => {
        if (!googleHealthy) throw new TypeError("temporary Google outage");
        return jsonResponse(googleBooksSearchFixture);
      },
    });

    const partial = expectOk(
      await provider.search({ q: "money" }, { mode: "union" }),
    );
    expect(partial).toMatchObject({
      source: "openlibrary",
      degraded: ["googlebooks"],
    });
    expect(hits).toEqual({ openlibrary: 1, googlebooks: 1 });

    googleHealthy = true;
    const recovered = expectOk(
      await provider.search({ q: "money" }, { mode: "union" }),
    );
    expect(recovered.source).toBe("union");
    expect(recovered.degraded).toBeUndefined();
    expect(recovered.seeds).toHaveLength(5);
    expect(hits).toEqual({ openlibrary: 2, googlebooks: 2 });

    const cached = expectOk(
      await provider.search({ q: "money" }, { mode: "union" }),
    );
    expect(cached).toEqual(recovered);
    expect(hits).toEqual({ openlibrary: 2, googlebooks: 2 });
  });

  it("returns a typed failure when both union sources fail", async () => {
    const { provider, hits } = providerWith({});

    const result = await provider.search({ q: "money" }, { mode: "union" });

    expect(booksErrorSchema.safeParse(result).success).toBe(true);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("upstream_unavailable");
    expect(result.error.upstream?.map(({ source }) => source)).toEqual([
      "openlibrary",
      "googlebooks",
    ]);
    expect(hits).toEqual({ openlibrary: 1, googlebooks: 1 });
  });

  it("keeps sound results when the other union payload is malformed", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryMalformedFixture),
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });

    const result = expectOk(
      await provider.search({ q: "money" }, { mode: "union" }),
    );

    expect(result).toMatchObject({
      source: "googlebooks",
      degraded: ["openlibrary"],
    });
    expect(result.seeds).toHaveLength(2);
  });

  it("treats an empty source as a valid half of the union", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryIsbnMissFixture),
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });

    const result = expectOk(
      await provider.search({ q: "money" }, { mode: "union" }),
    );

    expect(result.source).toBe("union");
    expect(result.degraded).toBeUndefined();
    expect(result.seeds).toHaveLength(2);
  });

  it("keeps fallback and union caches isolated", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
      googlebooks: () => jsonResponse(googleBooksSearchFixture),
    });

    await provider.search({ q: "money" });
    await provider.search({ q: "money" }, { mode: "union" });

    expect(hits).toEqual({ openlibrary: 2, googlebooks: 1 });
  });
});

describe("ISBN-13 lookup (E1.4 importer path)", () => {
  it("hit → exactly one seed, queried ISBN stamped into the ref", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryIsbnHitFixture),
    });
    const result = expectOk(await provider.search({ isbn: "9780857197689" }));
    expect(result.seeds).toHaveLength(1);
    // Fixture's isbn list leads with an ISBN-10 and another edition's 13 —
    // the ref must still carry the ISBN that was actually asked for.
    expect(result.seeds[0].ref.isbn13).toBe("9780857197689");
    expect(result.seeds[0].title).toBe("The Psychology of Money");
  });

  it("miss → ok with zero seeds, not an error", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryIsbnMissFixture),
    });
    const result = expectOk(await provider.search({ isbn: "9799999999990" }));
    expect(result.seeds).toEqual([]);
  });

  it("hit via the Google fallback when Open Library is down", async () => {
    const { provider } = providerWith({
      googlebooks: () => jsonResponse(googleBooksIsbnHitFixture),
    });
    const result = expectOk(await provider.search({ isbn: "9780857197689" }));
    expect(result.source).toBe("googlebooks");
    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0].ref.googleBooksId).toBe("TnMFDAAAQBAJ");
  });

  it("miss via Google (items absent entirely) → ok with zero seeds", async () => {
    const { provider } = providerWith({
      googlebooks: () => jsonResponse(googleBooksIsbnMissFixture),
    });
    const result = expectOk(await provider.search({ isbn: "9799999999990" }));
    expect(result.seeds).toEqual([]);
  });

  it("accepts a hyphenated ISBN-13", async () => {
    const { provider } = providerWith({
      openlibrary: () => jsonResponse(openLibraryIsbnHitFixture),
    });
    const hyphenated = expectOk(
      await provider.search({ isbn: "978-0-85719-768-9" }),
    );
    expect(hyphenated.seeds[0].ref.isbn13).toBe("9780857197689");
  });

  it("converts an ISBN-10 to ISBN-13 and looks that up (E1.4's ISBN-10-only rows)", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibraryIsbnHitFixture),
    });
    const result = expectOk(await provider.search({ isbn: "0857197681" }));
    expect(result.seeds[0].ref.isbn13).toBe("9780857197689");
    expect(hits.openlibrary).toBe(1);
  });

  it("rejects an ISBN-10 with a bad check digit as bad_request", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibraryIsbnHitFixture),
    });
    const rejected = await provider.search({ isbn: "0857197682" });
    if (rejected.ok) throw new Error("expected bad_request");
    expect(rejected.error.code).toBe("bad_request");
    expect(hits.openlibrary).toBe(0);
  });
});

describe("isbn10To13", () => {
  it("converts valid ISBN-10s, recomputing the EAN-13 check digit", () => {
    expect(isbn10To13("0857197681")).toBe("9780857197689");
    // "X" (=10) check digit, lowercase accepted via query normalization.
    expect(isbn10To13("123456789X")).toBe("9781234567897");
  });

  it("returns undefined for a failed ISBN-10 checksum or wrong shape", () => {
    expect(isbn10To13("0857197682")).toBeUndefined();
    expect(isbn10To13("123456789")).toBeUndefined();
    expect(isbn10To13("X23456789X")).toBeUndefined();
  });

  it("bookQuerySchema folds a hyphenated lowercase-x ISBN-10 into ISBN-13", () => {
    expect(bookQuerySchema.parse({ isbn: "1-2345-6789-x" }).isbn).toBe(
      "9781234567897",
    );
  });
});

describe("caching", () => {
  it("identical queries don't re-hit upstream; distinct ones do", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
    });
    const first = expectOk(await provider.search({ q: "money psychology" }));
    const second = expectOk(await provider.search({ q: "money psychology" }));
    expect(hits.openlibrary).toBe(1);
    expect(second).toEqual(first);

    await provider.search({ q: "something else" });
    expect(hits.openlibrary).toBe(2);
  });

  it("cache key folds case and whitespace", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
    });
    await provider.search({ q: "Money  Psychology" });
    await provider.search({ q: "money psychology " });
    expect(hits.openlibrary).toBe(1);
  });

  it("failures are never cached — a recovered upstream serves the next call", async () => {
    let healthy = false;
    const { provider, hits } = providerWith({
      openlibrary: () => {
        if (!healthy) throw new TypeError("fetch failed");
        return jsonResponse(openLibrarySearchFixture);
      },
      googlebooks: () => {
        throw new TypeError("fetch failed");
      },
    });
    const down = await provider.search({ q: "money" });
    expect(down.ok).toBe(false);

    healthy = true;
    const up = expectOk(await provider.search({ q: "money" }));
    expect(up.source).toBe("openlibrary");
    expect(hits.openlibrary).toBe(2);
  });

  it("entries expire after the TTL", async () => {
    let clock = 0;
    const { provider, hits } = providerWith(
      { openlibrary: () => jsonResponse(openLibrarySearchFixture) },
      { now: () => clock, cacheTtlMs: 1000 },
    );
    await provider.search({ q: "money" });
    clock = 999;
    await provider.search({ q: "money" });
    expect(hits.openlibrary).toBe(1);
    clock = 1001;
    await provider.search({ q: "money" });
    expect(hits.openlibrary).toBe(2);
  });

  it("evicts least-recently-used entries beyond the size bound", async () => {
    const { provider, hits } = providerWith(
      { openlibrary: () => jsonResponse(openLibrarySearchFixture) },
      { cacheSize: 2 },
    );
    await provider.search({ q: "a" });
    await provider.search({ q: "b" });
    await provider.search({ q: "a" }); // refresh a
    await provider.search({ q: "c" }); // evicts b
    expect(hits.openlibrary).toBe(3);
    await provider.search({ q: "a" }); // still cached
    expect(hits.openlibrary).toBe(3);
    await provider.search({ q: "b" }); // evicted → refetch
    expect(hits.openlibrary).toBe(4);
  });
});

describe("query validation and upstream URLs", () => {
  it("rejects an empty query with bad_request, no upstream hit", async () => {
    const { provider, hits } = providerWith({
      openlibrary: () => jsonResponse(openLibrarySearchFixture),
    });
    const result = await provider.search({});
    if (result.ok) throw new Error("expected bad_request");
    expect(result.error.code).toBe("bad_request");
    expect(hits.openlibrary).toBe(0);
  });

  it("builds fielded title/author queries for both upstreams", () => {
    const query = bookQuerySchema.parse({ title: "Debt", author: "Graeber" });
    const ol = new URL(openLibraryUrl(query));
    expect(ol.searchParams.get("title")).toBe("Debt");
    expect(ol.searchParams.get("author")).toBe("Graeber");
    expect(ol.searchParams.get("limit")).toBe("10");

    const gb = new URL(googleBooksUrl(query));
    expect(gb.searchParams.get("q")).toBe('intitle:"Debt" inauthor:"Graeber"');
    expect(gb.searchParams.get("country")).toBe("US");
  });

  it("strips embedded double quotes from intitle:/inauthor: phrases", () => {
    const query = bookQuerySchema.parse({
      title: 'Say "Hello"',
      author: '"Jane" Doe',
    });
    expect(new URL(googleBooksUrl(query)).searchParams.get("q")).toBe(
      'intitle:"Say Hello" inauthor:"Jane Doe"',
    );
  });

  it("routes an ISBN lookup as an isbn: query with limit 1", () => {
    const query = bookQuerySchema.parse({ isbn: "9780857197689" });
    expect(new URL(openLibraryUrl(query)).searchParams.get("q")).toBe(
      "isbn:9780857197689",
    );
    expect(new URL(openLibraryUrl(query)).searchParams.get("limit")).toBe("1");
    expect(new URL(googleBooksUrl(query)).searchParams.get("q")).toBe(
      "isbn:9780857197689",
    );
  });

  it("caps limit at 20", () => {
    expect(bookQuerySchema.safeParse({ q: "x", limit: "21" }).success).toBe(
      false,
    );
    expect(bookQuerySchema.parse({ q: "x", limit: "20" }).limit).toBe(20);
  });
});
