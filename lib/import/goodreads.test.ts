import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, importBackupText, serializeBackup } from "../backup";
import { db } from "../db";
import { readSnapshot } from "../db/repo";
import type { BookQueryInput, BookSeed, BooksResult } from "../providers/books";
import {
  applyGoodreadsManualMatch,
  createGoodreadsBookLookup,
  importGoodreadsCsv,
  isNostalgiaCluster,
  modeFromRow,
  parseGoodreadsCsv,
  prepareGoodreadsImport,
  type GoodreadsBookLookup,
  type ParsedGoodreadsRow,
} from "./goodreads";

const csv = readFileSync(
  join(process.cwd(), "data/goodreads_library_export.csv"),
  "utf8",
);
const rows = parseGoodreadsCsv(csv);
const openLibraryAudit = JSON.parse(
  readFileSync(
    join(process.cwd(), "lib/import/fixtures/openlibrary-goodreads-audit.json"),
    "utf8",
  ),
) as {
  provenance: {
    provider: string;
    searchMode: string;
    requestedIsbnCount: number;
    upstreams: Array<{ provider: string; audited: boolean; status: number }>;
  };
  records: Array<{
    isbn: string;
    status: number;
    doc?: {
      key: string;
      title: string;
      subtitle?: string;
      author_name?: string[];
      first_publish_year?: number;
      cover_i?: number;
      number_of_pages_median?: number;
    };
  }>;
};

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterAll(() => db.close());

function ok(seeds: BookSeed[]): BooksResult {
  return { ok: true, source: "openlibrary", seeds };
}

function seedFor(row: ParsedGoodreadsRow, art = true): BookSeed {
  const [title, ...subtitleParts] = row.title.split(":");
  const subtitle = subtitleParts.join(":").trim();
  return {
    medium: "book",
    ref: {
      medium: "book",
      ...(row.isbn13 ? { isbn13: row.isbn13 } : {}),
      openLibraryId: `OL-${row.bookId}`,
    },
    title,
    ...(subtitle !== "" ? { subtitle } : {}),
    creators: [...row.authors],
    ...(art ? { artUrl: `https://covers.example/${row.bookId}.jpg` } : {}),
  };
}

function fixtureLookup(unresolvedIsbns = new Set<string>()): GoodreadsBookLookup {
  const byIsbn = new Map(
    rows.filter((row) => row.isbn13).map((row) => [row.isbn13!, row]),
  );
  const byTitle = new Map(rows.map((row) => [row.title, row]));
  return async (query: BookQueryInput) => {
    const row = query.isbn ? byIsbn.get(query.isbn) : query.title ? byTitle.get(query.title) : undefined;
    if (!row || (query.isbn && unresolvedIsbns.has(query.isbn))) return ok([]);
    // Deliberately keep the selected ISBN failures unresolved on title fallback too.
    if (row.isbn13 && unresolvedIsbns.has(row.isbn13)) return ok([]);
    return ok([seedFor(row)]);
  };
}

/** Replay only facts captured from Open Library, including genuine misses. */
function auditLookup(): GoodreadsBookLookup {
  const byIsbn = new Map(openLibraryAudit.records.map((record) => [record.isbn, record]));
  const isbnByTitle = new Map(rows.map((row) => [row.title, row.isbn13]));
  return async (query) => {
    const isbn = query.isbn ?? (query.title ? isbnByTitle.get(query.title) : undefined);
    const record = isbn ? byIsbn.get(isbn) : undefined;
    if (!record?.doc || record.status !== 200) {
      return { ok: true, source: "union", seeds: [], degraded: ["googlebooks"] };
    }
    const doc = record.doc;
    return { ok: true, source: "union", degraded: ["googlebooks"], seeds: [{
      medium: "book",
      ref: { medium: "book", isbn13: record.isbn, openLibraryId: doc.key.replace(/^\/works\//, "") },
      title: doc.title,
      ...(doc.subtitle ? { subtitle: doc.subtitle } : {}),
      creators: doc.author_name ?? [],
      ...(doc.first_publish_year ? { year: doc.first_publish_year } : {}),
      ...(doc.number_of_pages_median ? { pages: doc.number_of_pages_median } : {}),
      ...(doc.cover_i ? { artUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` } : {}),
    }] };
  };
}

const createId = (kind: string, row: ParsedGoodreadsRow) =>
  `goodreads-${kind}-${row.bookId}`;

describe("Goodreads CSV parsing", () => {
  it("parses and preserves all 225 source rows with mapped fields", () => {
    expect(rows).toHaveLength(225);
    expect(new Set(rows.map((row) => row.bookId)).size).toBe(225);
    const brevity = rows.find((row) => row.title.startsWith("Smart Brevity"))!;
    expect(brevity).toMatchObject({
      isbn10: "1523516976",
      isbn13: "9781523516971",
      pages: 224,
      originalPublicationYear: 2022,
    });
    const prometheus = rows.find((row) => row.title.startsWith("American Prometheus"))!;
    expect(prometheus).toMatchObject({
      pages: 721,
      originalPublicationYear: 2005,
      dateAdded: "2024-02-25T00:00:00.000Z",
      shelves: ["to-read"],
      shelfPositions: { "to-read": 3 },
      exclusiveShelf: "to-read",
      readCount: 0,
    });
    const prince = rows.find((row) => row.title === "The Prince")!;
    expect(prince).toMatchObject({
      rating: 4,
      dateRead: "2017-04-30T00:00:00.000Z",
      exclusiveShelf: "to-read",
      readCount: 1,
    });
    expect(rows.filter((row) => row.isbn13)).toHaveLength(179);
  });

  it("handles quoted newlines and rejects structural/data mutations loudly", () => {
    const tiny = csv.split(/\r?\n/).slice(0, 2).join("\n");
    const withQuotedNewline = tiny.replace(
      ",read,,,,1,0",
      ',read,"first line\nsecond line",,,1,0',
    );
    expect(parseGoodreadsCsv(withQuotedNewline)[0].review).toBe(
      "first line\nsecond line",
    );
    expect(() => parseGoodreadsCsv(tiny.replace("Date Added", "Added"))).toThrow(
      "missing required column: Date Added",
    );
    expect(() => parseGoodreadsCsv(tiny.replace(",0,Plume", ",6,Plume"))).toThrow(
      "invalid My Rating",
    );
    expect(() => parseGoodreadsCsv(`${tiny}\n${tiny.split("\n")[1]}`)).toThrow(
      "repeats Book Id",
    );
    expect(() => parseGoodreadsCsv(`${tiny}\n\"unterminated`)).toThrow(
      "unterminated quoted field",
    );
    expect(() => parseGoodreadsCsv(tiny.replace('"Young, Jeffrey E."', '"Young, Jeffrey E."garbage'))).toThrow(
      "unexpected character after a closing quote",
    );
    expect(() => parseGoodreadsCsv(tiny.replace("Reinventing Your Life", 'Reinventing "Your" Life'))).toThrow(
      "quote inside an unquoted field",
    );
    const badIsbns = tiny
      .replace("1101667095", "1101667096")
      .replace("9781101667095", "9781101667094");
    expect(parseGoodreadsCsv(badIsbns)[0]).toMatchObject({
      invalidIsbns: ["1101667096", "9781101667094"],
    });
    expect(parseGoodreadsCsv(badIsbns)[0].isbn13).toBeUndefined();
  });
});

describe("Goodreads import planning", () => {
  it("uses combined-provider union mode by default so an Open Library miss cannot suppress Google", async () => {
    const search = vi.fn(async () => ok([]));
    const lookup = createGoodreadsBookLookup({ search });
    const query = { isbn: "9781101667095", limit: 1 } as const;

    await lookup(query);

    expect(search).toHaveBeenCalledWith(query, { mode: "union" });
  });

  it("audits the corpus against captured Open Library responses without inventing cover successes", async () => {
    const plan = await prepareGoodreadsImport(csv, {
      lookup: auditLookup(),
      createId,
      concurrency: 7,
    });

    expect(openLibraryAudit.provenance).toMatchObject({
      provider: "Open Library Search API",
      searchMode: "union",
      requestedIsbnCount: 179,
    });
    expect(openLibraryAudit.provenance.upstreams).toEqual([
      { provider: "openlibrary", audited: true, status: 200 },
      { provider: "googlebooks", audited: false, status: 429 },
    ]);
    expect(plan.stats.sourceRows).toBe(225);
    expect(plan.stats.validIsbn13Rows).toBe(179);
    // This is the real captured Open Library-only result: 156/179, not a
    // self-fulfilling >=95% mock. Google Books still needs a quota-enabled audit.
    expect(plan.stats.validIsbn13ResolvedWithCover).toBe(156);
    expect(plan.stats.isbn13CoverResolutionRate).toBeCloseTo(156 / 179, 10);
    expect(plan.resolved.length + plan.manualMatches.length).toBe(225);
    expect(plan.snapshot.items.every((item) => item.genre?.source === "auto")).toBe(
      true,
    );
    expect(new Set(plan.resolved.map(({ source }) => source.bookId)).size).toBe(
      plan.resolved.length,
    );
    expect(JSON.parse(JSON.stringify(plan.manualMatches))).toEqual(plan.manualMatches);

    // Shelf/status mapping: 199 read rows plus The Prince's historical read;
    // 3 currently-reading rows; 17 to-read + 6 learning-plan queue rows.
    const resolvedFinished = plan.resolved.filter(
      ({ source }) =>
        source.exclusiveShelf !== "currently-reading" &&
        (source.exclusiveShelf === "read" ||
          source.readCount > 0 ||
          source.rating !== undefined ||
          source.dateRead !== undefined),
    ).length;
    const resolvedInProgress = plan.resolved.filter(
      ({ source }) => source.exclusiveShelf === "currently-reading",
    ).length;
    expect(plan.snapshot.entries.filter((entry) => entry.status === "finished")).toHaveLength(resolvedFinished);
    expect(plan.snapshot.entries.filter((entry) => entry.status === "in-progress")).toHaveLength(resolvedInProgress);
    const resolvedQueued = plan.resolved.filter(
      ({ source }) =>
        source.exclusiveShelf === "to-read" || source.exclusiveShelf === "learning-plan",
    ).length;
    expect(plan.snapshot.queue).toHaveLength(resolvedQueued);
  });

  it("rejects an ISBN response with no ISBN when its title and author identify a different book", async () => {
    const sample = csv.split(/\r?\n/).slice(0, 2).join("\n");
    const plan = await prepareGoodreadsImport(sample, {
      createId,
      lookup: async () => ok([{
        medium: "book",
        ref: { medium: "book", openLibraryId: "OL-WRONG" },
        title: "An Entirely Different Book",
        creators: ["Someone Else"],
        artUrl: "https://covers.example/wrong.jpg",
      }]),
    });
    expect(plan.resolved).toEqual([]);
    expect(plan.manualMatches).toHaveLength(1);
    expect(plan.manualMatches[0].reason).toBe("no-match");
  });

  it("marks exactly the evidence-backed five-star nostalgia cluster as comfort", async () => {
    const plan = await prepareGoodreadsImport(csv, {
      lookup: fixtureLookup(),
      createId,
    });
    const comfort = plan.resolved.filter(({ entry }) => entry?.mode === "comfort");
    expect(plan.snapshot.entries).toHaveLength(203);
    expect(plan.snapshot.queue).toHaveLength(23);
    expect(comfort).toHaveLength(16);
    expect(comfort.filter(({ source }) => source.authors.includes("Anthony Horowitz"))).toHaveLength(7);
    expect(comfort.filter(({ source }) => source.authors.includes("J.K. Rowling"))).toHaveLength(6);
    expect(comfort.filter(({ source }) => source.authors.includes("Dr. Seuss"))).toHaveLength(2);
    expect(comfort.some(({ source }) => source.title === "Samurai Shortstop")).toBe(true);
    const ohPlaces = plan.resolved.find(
      ({ source }) => source.title === "Oh, the Places You’ll Go!",
    );
    expect(ohPlaces?.entry?.mode).toBe("enjoyed");
    expect(ohPlaces?.item.genre).toEqual({
      genre: "genre-fiction",
      source: "auto",
    });
    expect(isNostalgiaCluster("Samurai Shortstop", ["Alan Gratz"])).toBe(true);
    expect(modeFromRow({ title: "The House of Morgan", authors: ["Ron Chernow"], rating: 5 })).toBe("admired");
    expect(
      plan.resolved.find(({ source }) => source.title.startsWith("Catch-22"))?.entry,
    ).toMatchObject({ gradient: "no", mode: "enjoyed" });
    expect(
      plan.resolved.find(({ source }) => source.title.startsWith("Going Infinite"))
        ?.entry,
    ).toMatchObject({ gradient: "fine", mode: "enjoyed" });
    expect(
      plan.resolved.find(({ source }) => source.title.startsWith("The House of Morgan"))
        ?.entry,
    ).toMatchObject({ gradient: "loved", mode: "admired" });
  });

  it("queues no-match, ambiguous, coverless and provider failures without dropping rows", async () => {
    const sample = csv.split(/\r?\n/).slice(0, 5).join("\n");
    const sampleRows = parseGoodreadsCsv(sample);
    const lookup: GoodreadsBookLookup = async (query) => {
      const row = sampleRows.find(
        (candidate) => candidate.isbn13 === query.isbn || candidate.title === query.title,
      )!;
      const index = sampleRows.indexOf(row);
      if (index === 0) return ok([]);
      if (index === 1) return ok([seedFor(row, false)]);
      if (index === 2) {
        return ok([
          seedFor(row),
          { ...seedFor(row), ref: { medium: "book", openLibraryId: "other" } },
        ]);
      }
      throw new Error("catalog offline");
    };
    const plan = await prepareGoodreadsImport(sample, {
      lookup,
      createId,
      concurrency: 1,
    });
    expect(plan.resolved).toHaveLength(0);
    expect(plan.manualMatches).toHaveLength(4);
    expect(plan.manualMatches.map(({ reason }) => reason)).toEqual([
      "no-match",
      "missing-cover",
      "ambiguous-match",
      "provider-error",
    ]);
    expect(plan.manualMatches.map(({ source }) => source.bookId)).toEqual(
      sampleRows.map(({ bookId }) => bookId),
    );
  });

  it("persists manual work through reload and backup, then resolves it atomically", async () => {
    const restore = vi.fn(async () => undefined);
    const firstIsbn = rows.find((row) => row.isbn13)!.isbn13!;
    const plan = await importGoodreadsCsv(csv, {
      lookup: fixtureLookup(new Set([firstIsbn])),
      createId,
      restore,
    });
    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(plan.snapshot);
    expect(plan.snapshot.items).toHaveLength(224);
    expect(plan.manualMatches).toHaveLength(1);
    expect(plan.snapshot.manualMatches).toEqual(plan.manualMatches);

    // Apply for real: unresolved work survives a database close/reopen and a
    // complete backup/restore before the user chooses a catalog result.
    await importGoodreadsCsv(csv, {
      lookup: fixtureLookup(new Set([firstIsbn])),
      createId,
    });
    db.close();
    await db.open();
    expect((await readSnapshot()).manualMatches).toHaveLength(1);
    const backup = await createBackup(new Date("2026-08-01T20:00:00.000Z"));
    await Promise.all(db.tables.map((table) => table.clear()));
    await importBackupText(serializeBackup(backup));

    const source = plan.manualMatches[0].source;
    const beforeFailedResolve = await readSnapshot();
    const collidingItemId = beforeFailedResolve.items[0].id;
    await expect(
      applyGoodreadsManualMatch(plan.manualMatches[0], seedFor(source), {
        createId: (kind, row) =>
          kind === "item" ? collidingItemId : createId(kind, row),
      }),
    ).rejects.toThrow();
    const afterFailedResolve = await readSnapshot();
    expect(afterFailedResolve.manualMatches).toEqual(beforeFailedResolve.manualMatches);
    expect(afterFailedResolve.items).toEqual(beforeFailedResolve.items);
    expect(afterFailedResolve.entries).toEqual(beforeFailedResolve.entries);
    expect(afterFailedResolve.queue).toEqual(beforeFailedResolve.queue);

    const completed = await applyGoodreadsManualMatch(
      plan.manualMatches[0],
      seedFor(source),
      { createId },
    );
    const after = await readSnapshot();
    expect(after.manualMatches).toEqual([]);
    expect(after.items).toContainEqual(completed.item);
    expect(completed.item.genre?.source).toBe("auto");
    if (completed.entry) expect(after.entries).toContainEqual(completed.entry);
    if (completed.queueItem) expect(after.queue).toContainEqual(completed.queueItem);
    await expect(
      applyGoodreadsManualMatch(plan.manualMatches[0], seedFor(source, false), {
        createId,
      }),
    ).rejects.toThrow("needs canonical cover art");
  });
});
