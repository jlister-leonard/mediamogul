import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  availabilitySchema,
  comparisonSchema,
  entrySchema,
  itemIdSchema,
  itemSchema,
  portraitSchema,
  queueItemSchema,
  recSchema,
  situationIdSchema,
  situationSchema,
  type Availability,
  type Comparison,
  type Entry,
  type Item,
  type Portrait,
  type QueueItem,
  type Rec,
  type Situation,
} from "../types";
import { DB_NAME, NightstandDB, schemaV1 } from "./schema";

/**
 * Every fixture below goes through its contract schema's `.parse()` — the
 * suite round-trips only contract-valid records, so a schema/contract drift
 * fails here before it can fail in a feature bead.
 */

const bookId = itemIdSchema.parse("item-bad-blood");
const rivalBookId = itemIdSchema.parse("item-going-infinite");
const movieId = itemIdSchema.parse("item-the-social-network");
const tvId = itemIdSchema.parse("item-severance");
const podcastId = itemIdSchema.parse("item-acquired");
const bedtimeSituationId = situationIdSchema.parse("situation-before-bed");

const book: Item = itemSchema.parse({
  id: bookId,
  medium: "book",
  title: "Bad Blood",
  subtitle: "Secrets and Lies in a Silicon Valley Startup",
  creators: ["John Carreyrou"],
  year: 2018,
  artUrl: "https://covers.openlibrary.org/b/isbn/9781524731656-L.jpg",
  description:
    "The full inside story of the breathtaking rise and shocking collapse of Theranos.",
  communityRating: {
    average: 4.39,
    count: 271_204,
    histogram: [2_101, 4_876, 25_310, 98_412, 140_505],
  },
  genre: { genre: "money-markets", source: "auto" },
  ref: { medium: "book", isbn13: "9781524731656", googleBooksId: "H_KJDwAAQBAJ" },
  pages: 339,
});

const rivalBook: Item = itemSchema.parse({
  id: rivalBookId,
  medium: "book",
  title: "Going Infinite",
  creators: ["Michael Lewis"],
  year: 2023,
  genre: { genre: "money-markets", source: "auto" },
  ref: { medium: "book", isbn13: "9781324074335" },
  pages: 254,
});

const movie: Item = itemSchema.parse({
  id: movieId,
  medium: "movie",
  title: "The Social Network",
  creators: ["David Fincher"],
  year: 2010,
  genre: { genre: "ambition-institutions", source: "manual" },
  ref: { medium: "movie", tmdbId: 37799 },
  runtimeMinutes: 121,
});

const tv: Item = itemSchema.parse({
  id: tvId,
  medium: "tv",
  title: "Severance",
  creators: ["Dan Erickson"],
  year: 2022,
  ref: { medium: "tv", tmdbId: 95396 },
  runtimeMinutes: 55,
});

const podcast: Item = itemSchema.parse({
  id: podcastId,
  medium: "podcast",
  title: "Acquired",
  creators: ["Ben Gilbert", "David Rosenthal"],
  ref: {
    medium: "podcast",
    appleId: 1050462261,
    spotifyShowId: "7Fj0XffcRIhr9uhSKmdiaB",
  },
});

const allItems = [book, rivalBook, movie, tv, podcast];

const finishedEntry: Entry = entrySchema.parse({
  id: "entry-bad-blood",
  itemId: bookId,
  status: "finished",
  startedAt: "2026-06-02T21:10:00.000Z",
  finishedAt: "2026-06-19T22:41:03.512Z",
  gradient: "loved",
  mode: "admired",
  tags: ["voice", "pacing"],
  note: "Read the last hundred pages in one sitting.",
});

const inProgressEntry: Entry = entrySchema.parse({
  id: "entry-severance",
  itemId: tvId,
  status: "in-progress",
  startedAt: "2026-07-20T02:15:44.008Z",
  tags: [],
});

const earlierDuel: Comparison = comparisonSchema.parse({
  id: "comparison-1",
  genre: "money-markets",
  winnerId: bookId,
  loserId: rivalBookId,
  comparedAt: "2026-07-01T18:00:00.000Z",
});

const laterDuel: Comparison = comparisonSchema.parse({
  id: "comparison-2",
  genre: "money-markets",
  winnerId: rivalBookId,
  loserId: bookId,
  comparedAt: "2026-07-14T18:30:12.250Z",
});

const otherLadderDuel: Comparison = comparisonSchema.parse({
  id: "comparison-3",
  genre: "ambition-institutions",
  winnerId: movieId,
  loserId: tvId,
  comparedAt: "2026-07-02T18:05:00.000Z",
});

const queuedMovie: QueueItem = queueItemSchema.parse({
  id: "queue-social-network",
  itemId: movieId,
  contextTags: ["with M"],
  addedReason: "recommended off Bad Blood",
  addedAt: "2026-07-10T04:20:19.771Z",
});

const bedtimeSituation: Situation = situationSchema.parse({
  id: bedtimeSituationId,
  label: "45 min before bed",
  prompt:
    "It is late; something absorbing but under 45 minutes, nothing that will keep me up.",
  source: "built-in",
  createdAt: "2026-07-05T03:00:00.000Z",
});

const freshOffer: Availability = availabilitySchema.parse({
  itemId: movieId,
  region: "US",
  kind: "subscription",
  providerId: "netflix",
  url: "https://www.netflix.com/title/70132721",
  fetchedAt: "2026-07-28T08:00:00.000Z",
});

const staleOffer: Availability = availabilitySchema.parse({
  itemId: movieId,
  region: "US",
  kind: "rent",
  providerId: "apple-tv",
  priceUsd: 3.99,
  fetchedAt: "2026-07-26T07:59:59.999Z",
});

const theaterOffer: Availability = availabilitySchema.parse({
  itemId: tvId,
  region: "US",
  kind: "theater",
  fandangoUrl: "https://www.fandango.com/severance-the-movie/movie-times",
  fetchedAt: "2026-07-28T08:00:00.000Z",
});

const handRec: Rec = recSchema.parse({
  id: "rec-hand-movie",
  itemId: movieId,
  reason:
    "You ranked Bad Blood top of Money & Markets; same appetite for ambition curdling.",
  source: { entry: "hand" },
  dealtAt: "2026-07-27T01:00:00.000Z",
});

const situationRec: Rec = recSchema.parse({
  id: "rec-situation-podcast",
  itemId: podcastId,
  reason: "One Acquired episode fits your before-bed window and your ladder's top genre.",
  source: { entry: "situation", situationId: bedtimeSituationId },
  dealtAt: "2026-07-27T02:30:00.000Z",
});

const rejectedChatRec: Rec = recSchema.parse({
  id: "rec-chat-book",
  itemId: rivalBookId,
  reason: "Same reporter-in-the-room texture as Bad Blood, fresher subject.",
  source: { entry: "chat" },
  dealtAt: "2026-07-27T03:45:10.101Z",
  rejection: { reason: "too-long", at: "2026-07-27T03:46:02.404Z" },
});

const allRecs = [handRec, situationRec, rejectedChatRec];

const portraitV1: Portrait = portraitSchema.parse({
  version: 1,
  synthesizedAt: "2026-07-21T05:00:00.000Z",
  claims: [
    { kind: "axis", left: "plot-driven", right: "vibe-driven", position: -0.4 },
    { kind: "obsession", text: "Institutional collapse told by insiders." },
  ],
  corrections: [
    {
      claim: { kind: "blind-spot", text: "You avoid poetry." },
      note: "Not avoidance — just untracked.",
      at: "2026-07-22T05:10:00.000Z",
    },
  ],
  assignedCanon: "the-circumstance",
});

const portraitV2: Portrait = portraitSchema.parse({
  ...portraitV1,
  version: 2,
  synthesizedAt: "2026-07-28T05:00:00.000Z",
});

/** Each test gets its own IDBFactory — full isolation, no name juggling. */
function openDb(): NightstandDB {
  return new NightstandDB({ indexedDB: new IDBFactory(), IDBKeyRange });
}

let db: Dexie;
afterEach(() => db.close());

describe("NightstandDB shape", () => {
  it("opens at version 1 with exactly the eight contract tables", async () => {
    const ndb = (db = openDb());
    await ndb.open();
    expect(ndb.verno).toBe(1);
    expect(ndb.tables.map((t) => t.name).sort()).toEqual([
      "availability",
      "comparisons",
      "entries",
      "items",
      "portrait",
      "queue",
      "recs",
      "situations",
    ]);
  });
});

describe("round-trips (contract-valid fixtures in, identical records out)", () => {
  it("items — one per medium, plus the compared pair", async () => {
    const ndb = (db = openDb());
    await ndb.items.bulkAdd(allItems);
    for (const item of allItems) {
      expect(await ndb.items.get(item.id)).toEqual(item);
    }
  });

  it("entries", async () => {
    const ndb = (db = openDb());
    await ndb.entries.bulkAdd([finishedEntry, inProgressEntry]);
    expect(await ndb.entries.get(finishedEntry.id)).toEqual(finishedEntry);
    expect(await ndb.entries.get(inProgressEntry.id)).toEqual(inProgressEntry);
  });

  it("comparisons", async () => {
    const ndb = (db = openDb());
    await ndb.comparisons.add(earlierDuel);
    expect(await ndb.comparisons.get(earlierDuel.id)).toEqual(earlierDuel);
  });

  it("queue", async () => {
    const ndb = (db = openDb());
    await ndb.queue.add(queuedMovie);
    expect(await ndb.queue.get(queuedMovie.id)).toEqual(queuedMovie);
  });

  it("situations", async () => {
    const ndb = (db = openDb());
    await ndb.situations.add(bedtimeSituation);
    expect(await ndb.situations.get(bedtimeSituation.id)).toEqual(
      bedtimeSituation,
    );
  });

  it("availability — outbound key leaves records contract-identical", async () => {
    const ndb = (db = openDb());
    const key = await ndb.availability.add(freshOffer);
    const stored = await ndb.availability.get(key);
    expect(stored).toEqual(freshOffer);
    // The hidden primary key never leaks into the record itself.
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      Object.keys(freshOffer).sort(),
    );
  });

  it("recs — all three sources, including a rejection", async () => {
    const ndb = (db = openDb());
    await ndb.recs.bulkAdd(allRecs);
    for (const rec of allRecs) {
      expect(await ndb.recs.get(rec.id)).toEqual(rec);
    }
  });

  it("portrait — keyed by version, latest wins by primary-key order", async () => {
    const ndb = (db = openDb());
    await ndb.portrait.bulkAdd([portraitV2, portraitV1]);
    expect(await ndb.portrait.get(1)).toEqual(portraitV1);
    expect(await ndb.portrait.toCollection().last()).toEqual(portraitV2);
  });
});

describe("index queries (one per consuming bead's pattern)", () => {
  it("items by medium and by genre (E3.2 filters, E4.2 pools)", async () => {
    const ndb = (db = openDb());
    await ndb.items.bulkAdd(allItems);

    const books = await ndb.items.where("medium").equals("book").toArray();
    expect(books.map((i) => i.id).sort()).toEqual([rivalBookId, bookId].sort());

    const pool = await ndb.items
      .where("genre.genre")
      .equals("money-markets")
      .toArray();
    expect(pool.map((i) => i.id).sort()).toEqual([rivalBookId, bookId].sort());

    // Unassigned items (tv, podcast fixtures) are absent from the genre index.
    const assigned = await ndb.items.orderBy("genre.genre").toArray();
    expect(assigned).toHaveLength(3);
  });

  it("entries by itemId and by status (E3.1 log flow, E3.2 segments)", async () => {
    const ndb = (db = openDb());
    await ndb.entries.bulkAdd([finishedEntry, inProgressEntry]);

    expect(await ndb.entries.where("itemId").equals(bookId).toArray()).toEqual([
      finishedEntry,
    ]);
    expect(
      await ndb.entries.where("status").equals("in-progress").toArray(),
    ).toEqual([inProgressEntry]);
  });

  it("comparisons by [genre+comparedAt]: one pool, chronological (E4.2 replay)", async () => {
    const ndb = (db = openDb());
    // Inserted out of chronological order on purpose.
    await ndb.comparisons.bulkAdd([laterDuel, otherLadderDuel, earlierDuel]);

    const replay = await ndb.comparisons
      .where("[genre+comparedAt]")
      .between(
        ["money-markets", Dexie.minKey],
        ["money-markets", Dexie.maxKey],
      )
      .toArray();

    // Genre-scoped, and chronological because ms-ISO strings sort
    // lexicographically (contract invariant on isoTimestampSchema).
    expect(replay).toEqual([earlierDuel, laterDuel]);
  });

  it("queue by itemId (E3.1 dedupe, E6.3 queue-first)", async () => {
    const ndb = (db = openDb());
    await ndb.queue.add(queuedMovie);
    expect(await ndb.queue.where("itemId").equals(movieId).count()).toBe(1);
    expect(await ndb.queue.where("itemId").equals(bookId).count()).toBe(0);
  });

  it("availability by itemId, staleness by fetchedAt range (E5.1/E5.5)", async () => {
    const ndb = (db = openDb());
    await ndb.availability.bulkAdd([freshOffer, staleOffer, theaterOffer]);

    const offers = await ndb.availability
      .where("itemId")
      .equals(movieId)
      .toArray();
    expect(offers.map((o) => o.kind).sort()).toEqual(["rent", "subscription"]);

    // 24h staleness cutoff, expressed as an ISO string range on the index.
    const cutoff = "2026-07-27T08:00:00.000Z";
    const stale = await ndb.availability
      .where("fetchedAt")
      .below(cutoff)
      .toArray();
    expect(stale).toEqual([staleOffer]);
  });

  it("recs by itemId, by source.situationId, by dealtAt (E6.3/E6.5/E6.6)", async () => {
    const ndb = (db = openDb());
    await ndb.recs.bulkAdd(allRecs);

    expect(
      await ndb.recs.where("itemId").equals(rivalBookId).toArray(),
    ).toEqual([rejectedChatRec]);

    // Dotted-keypath index: only situation-sourced recs carry the path, so
    // hand and chat recs are simply absent — no multiEntry, no denormalized
    // column.
    expect(
      await ndb.recs
        .where("source.situationId")
        .equals(bedtimeSituationId)
        .toArray(),
    ).toEqual([situationRec]);
    expect(await ndb.recs.orderBy("source.situationId").count()).toBe(1);

    const newestFirst = await ndb.recs.orderBy("dealtAt").reverse().toArray();
    expect(newestFirst.map((r) => r.id)).toEqual([
      rejectedChatRec.id,
      situationRec.id,
      handRec.id,
    ]);
  });
});

describe("versioned migrations", () => {
  it("v1 data survives reopening at v2 with an added index, and the new index queries", async () => {
    // One factory shared by both opens — same underlying "browser" storage.
    const indexedDB = new IDBFactory();

    // ---- v1: the shipped schema, some real writes, then close. ----
    const v1 = new Dexie(DB_NAME, { indexedDB, IDBKeyRange });
    v1.version(1).stores(schemaV1);
    await v1.table("items").bulkAdd(allItems);
    await v1.table("entries").bulkAdd([finishedEntry, inProgressEntry]);
    expect(v1.verno).toBe(1);
    v1.close();

    // ---- v2: same declaration pattern NightstandDB will use for its next
    // version — v1 kept verbatim, v2 adding an `entries.finishedAt` index. ----
    const v2 = new Dexie(DB_NAME, { indexedDB, IDBKeyRange });
    v2.version(1).stores(schemaV1);
    v2.version(2).stores({ entries: "id, itemId, status, finishedAt" });
    await v2.open();
    expect(v2.verno).toBe(2);

    // Data written under v1 is intact, byte for byte.
    expect(await v2.table("items").get(bookId)).toEqual(book);
    expect(await v2.table("entries").get(finishedEntry.id)).toEqual(
      finishedEntry,
    );
    expect(await v2.table("entries").count()).toBe(2);

    // The index added in v2 was built over the pre-existing rows.
    expect(
      await v2
        .table("entries")
        .where("finishedAt")
        .above("2026-01-01T00:00:00.000Z")
        .toArray(),
    ).toEqual([finishedEntry]);

    // Untouched tables carried over with their v1 indexes still working.
    expect(
      await v2.table("items").where("medium").equals("podcast").count(),
    ).toBe(1);
    v2.close();
  });
});
