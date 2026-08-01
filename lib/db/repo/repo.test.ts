// `fake-indexeddb/auto` MUST be the first import: it installs the in-memory
// IndexedDB on `globalThis` before Dexie's module init captures it, which is
// how the `db` singleton (imported at module scope, per E1.1's SSR-safe
// design) ends up talking to a fake store instead of a real browser one.
import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  providerIdSchema,
  type Availability,
  type Entry,
  type Item,
  type EntryId,
  type Genre,
  type GenreAssignment,
  type ItemId,
  type ItemSeed,
  type QueueItemId,
  type RecId,
  type Situation,
  type SituationId,
  type SubscriptionAvailability,
  type TheaterAvailability,
} from "../../types";
import { db } from "../index";
import type { EntryRating } from "./entries";
import {
  abandonEntry,
  addItem,
  addToQueue,
  appendComparison,
  appendPortraitVersion,
  availabilityByItemId,
  availabilityRefreshByItemId,
  availabilityStaleBefore,
  createSituation,
  deleteSituation,
  entriesByItemId,
  entriesByStatus,
  finishEntry,
  getItem,
  getSituation,
  itemsByGenre,
  itemsByMedium,
  latestPortrait,
  listEntries,
  listItems,
  listQueue,
  listSituations,
  markRecRejected,
  openEntryByItemId,
  queueItemByItemId,
  rateEntry,
  readSnapshot,
  recHistoryByRecency,
  recordRec,
  recsBySituationId,
  refreshAvailabilityForItem,
  refreshAvailabilityState,
  readAvailabilityState,
  removeFromQueue,
  RepoConflictError,
  RepoNotFoundError,
  RepoValidationError,
  replayComparisonsByGenre,
  restoreSnapshot,
  restoreSnapshotIfEmpty,
  setAutoItemGenreIfAllowed,
  setEntryScore,
  setItemGenre,
  startEntry,
  updateSituation,
} from "./index";

/**
 * Every repo function, happy path and edge. Time is faked (Date only — Dexie
 * and fake-indexeddb both drive real timers) so minted timestamps are exact
 * and ordering assertions cannot flake on two writes landing in one
 * millisecond.
 */

const T0 = "2026-07-28T12:00:00.000Z";
const at = (iso: string) => vi.setSystemTime(new Date(iso));

const bookSeed = {
  medium: "book",
  title: "Bad Blood",
  creators: ["John Carreyrou"],
  year: 2018,
  ref: { medium: "book", isbn13: "9781524731656" },
  pages: 339,
} satisfies ItemSeed;

const rivalSeed = {
  medium: "book",
  title: "Going Infinite",
  creators: ["Michael Lewis"],
  ref: { medium: "book", isbn13: "9781324074335" },
} satisfies ItemSeed;

const movieSeed = {
  medium: "movie",
  title: "The Social Network",
  creators: ["David Fincher"],
  ref: { medium: "movie", tmdbId: 37799 },
  runtimeMinutes: 121,
} satisfies ItemSeed;

const podcastSeed = {
  medium: "podcast",
  title: "Acquired",
  creators: ["Ben Gilbert", "David Rosenthal"],
  ref: { medium: "podcast", appleId: 1050462261 },
} satisfies ItemSeed;

/** A well-formed offer for `itemId`, varied by the caller as needed. */
const subscriptionOffer = (
  itemId: ItemId,
  fetchedAt: string,
): SubscriptionAvailability => ({
  itemId,
  region: "US",
  kind: "subscription",
  providerId: providerIdSchema.parse("netflix"),
  url: "https://www.netflix.com/title/70132721",
  fetchedAt,
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  db.close();
});

describe("items", () => {
  it("adds a seed, minting an ItemId, and reads it back identically", async () => {
    const item = await addItem(bookSeed);

    expect(item.id).toEqual(expect.any(String));
    expect(item).toMatchObject({ title: "Bad Blood", medium: "book" });
    expect(item.genre).toEqual({ genre: "money-markets", source: "auto" });
    expect(await getItem(item.id)).toEqual(item);
  });

  it("mints a distinct id per add — identity dedupe is E2.4's job, not the store's", async () => {
    const first = await addItem(bookSeed);
    const second = await addItem(bookSeed);

    expect(first.id).not.toEqual(second.id);
    expect(await db.items.count()).toBe(2);
  });

  it("rejects an invalid seed and writes nothing", async () => {
    await expect(
      addItem({ ...bookSeed, title: "" } as unknown as ItemSeed),
    ).rejects.toThrow(RepoValidationError);
    // The book ref's own refinement (at least one external id) also gates here.
    await expect(
      addItem({ ...bookSeed, ref: { medium: "book" } } as unknown as ItemSeed),
    ).rejects.toThrow(RepoValidationError);
    expect(await db.items.count()).toBe(0);
  });

  it("returns undefined for an unknown id", async () => {
    expect(await getItem("item-nope" as ItemId)).toBeUndefined();
  });

  it("lists the whole library, every medium (E3.4 search, E6.2 briefing)", async () => {
    expect(await listItems()).toEqual([]);
    const book = await addItem(bookSeed);
    const movie = await addItem(movieSeed);
    const podcast = await addItem(podcastSeed);

    expect((await listItems()).map((i) => i.id).sort()).toEqual(
      [book.id, movie.id, podcast.id].sort(),
    );
  });

  it("filters by medium (E3.2)", async () => {
    const book = await addItem(bookSeed);
    await addItem(movieSeed);
    const podcast = await addItem(podcastSeed);

    expect((await itemsByMedium("book")).map((i) => i.id)).toEqual([book.id]);
    expect((await itemsByMedium("podcast")).map((i) => i.id)).toEqual([
      podcast.id,
    ]);
    expect(await itemsByMedium("tv")).toEqual([]);
  });

  it("filters by genre, and unassigned items are absent from the index (E4.2 pools)", async () => {
    const book = await addItem(bookSeed);
    const rival = await addItem(rivalSeed);
    await addItem(movieSeed);
    await setItemGenre(book.id, { genre: "money-markets", source: "auto" });
    await setItemGenre(rival.id, { genre: "money-markets", source: "auto" });

    const pool = await itemsByGenre("money-markets");
    expect(pool.map((i) => i.id).sort()).toEqual([book.id, rival.id].sort());
    expect(await itemsByGenre("literary-fiction")).toEqual([]);
  });

  it("assigns and re-assigns a genre, keeping the rest of the record intact", async () => {
    const book = await addItem(bookSeed);

    const auto = await setItemGenre(book.id, {
      genre: "money-markets",
      source: "auto",
    });
    expect(auto.genre).toEqual({ genre: "money-markets", source: "auto" });

    const manual = await setItemGenre(book.id, {
      genre: "business-strategy",
      source: "manual",
    });
    expect(manual.genre).toEqual({
      genre: "business-strategy",
      source: "manual",
    });
    expect(await getItem(book.id)).toEqual(manual);
    expect(manual.title).toBe("Bad Blood");
    expect(await db.items.count()).toBe(1);
  });

  it("atomically protects manual genre overrides from auto reclassification", async () => {
    const book = await addItem(bookSeed);
    expect((await setAutoItemGenreIfAllowed(book.id, "money-markets")).genre)
      .toEqual({ genre: "money-markets", source: "auto" });

    const manual = await setItemGenre(book.id, {
      genre: "lives",
      source: "manual",
    });
    expect(await setAutoItemGenreIfAllowed(book.id, "business-strategy"))
      .toEqual(manual);
    expect((await getItem(book.id))?.genre).toEqual({
      genre: "lives",
      source: "manual",
    });

    const rival = await addItem(rivalSeed);
    await Promise.all([
      setAutoItemGenreIfAllowed(rival.id, "money-markets"),
      setItemGenre(rival.id, { genre: "lives", source: "manual" }),
    ]);
    expect((await getItem(rival.id))?.genre).toEqual({
      genre: "lives",
      source: "manual",
    });
  });

  it("refuses to assign a genre to a missing item", async () => {
    await expect(
      setItemGenre("item-nope" as ItemId, {
        genre: "lives",
        source: "auto",
      }),
    ).rejects.toThrow(RepoNotFoundError);
  });

  it("rejects an invalid assignment and leaves the item untouched", async () => {
    const book = await addItem(bookSeed);

    await expect(
      setItemGenre(book.id, {
        genre: "not-a-ladder",
        source: "auto",
      } as unknown as GenreAssignment),
    ).rejects.toThrow(RepoValidationError);
    expect((await getItem(book.id))?.genre).toEqual({
      genre: "money-markets",
      source: "auto",
    });
  });
});

describe("entries", () => {
  it("starts an entry: in-progress, stamped, findable as the open one", async () => {
    const book = await addItem(bookSeed);
    const entry = await startEntry(book.id);

    expect(entry).toMatchObject({
      itemId: book.id,
      status: "in-progress",
      startedAt: T0,
      tags: [],
    });
    expect(await openEntryByItemId(book.id)).toEqual(entry);
  });

  it("refuses a second open entry for the same item", async () => {
    const book = await addItem(bookSeed);
    await startEntry(book.id);

    await expect(startEntry(book.id)).rejects.toThrow(RepoConflictError);
    expect(await db.entries.count()).toBe(1);
  });

  it("rejects an invalid write (empty itemId) before it reaches the store", async () => {
    await expect(startEntry("" as ItemId)).rejects.toThrow(RepoValidationError);
    expect(await db.entries.count()).toBe(0);
  });

  it("starting takes the item off the stack, in one transaction", async () => {
    const book = await addItem(bookSeed);
    await addToQueue({ itemId: book.id, contextTags: ["flight"] });

    await startEntry(book.id);

    expect(await queueItemByItemId(book.id)).toBeUndefined();
  });

  it("finishing sets finishedAt and clears the stack atomically (the E3.1 → E3.2 move)", async () => {
    const book = await addItem(bookSeed);
    const started = await startEntry(book.id);
    // Re-added to the stack while in progress: finishing must still clear it.
    await addToQueue({ itemId: book.id, contextTags: [] });

    at("2026-07-29T09:30:00.000Z");
    const finished = await finishEntry(started.id);

    expect(finished).toMatchObject({
      id: started.id,
      status: "finished",
      startedAt: T0,
      finishedAt: "2026-07-29T09:30:00.000Z",
    });
    expect(await db.entries.get(started.id)).toEqual(finished);
    expect(await listQueue()).toEqual([]);
  });

  it("abandoning records the stop without inventing a finish date", async () => {
    const book = await addItem(bookSeed);
    const started = await startEntry(book.id);

    const abandoned = await abandonEntry(started.id);

    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.finishedAt).toBeUndefined();
  });

  it("cannot finish or abandon what was never started", async () => {
    const book = await addItem(bookSeed);
    const started = await startEntry(book.id);
    await finishEntry(started.id);

    // A finished entry is no longer in-progress: a second close is a conflict.
    await expect(finishEntry(started.id)).rejects.toThrow(RepoConflictError);
    await expect(abandonEntry(started.id)).rejects.toThrow(RepoConflictError);
    // And an entry that does not exist at all is a not-found.
    await expect(
      finishEntry("entry-nope" as EntryId),
    ).rejects.toThrow(RepoNotFoundError);
    await expect(
      abandonEntry("entry-nope" as EntryId),
    ).rejects.toThrow(RepoNotFoundError);
  });

  it("lists every entry for an item — a re-read is a second entry", async () => {
    const book = await addItem(bookSeed);
    const first = await startEntry(book.id);
    await finishEntry(first.id);
    const second = await startEntry(book.id);

    const all = await entriesByItemId(book.id);
    expect(all.map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
    expect(await entriesByItemId("item-nope" as ItemId)).toEqual([]);
    // Only the live one is "open".
    expect((await openEntryByItemId(book.id))?.id).toBe(second.id);
  });

  it("segments by status (E3.2: nightstand vs drawer)", async () => {
    const book = await addItem(bookSeed);
    const movie = await addItem(movieSeed);
    const podcast = await addItem(podcastSeed);
    const finishedOne = await startEntry(book.id);
    await finishEntry(finishedOne.id);
    const abandonedOne = await startEntry(movie.id);
    await abandonEntry(abandonedOne.id);
    const openOne = await startEntry(podcast.id);

    expect((await entriesByStatus("finished")).map((e) => e.id)).toEqual([
      finishedOne.id,
    ]);
    expect((await entriesByStatus("abandoned")).map((e) => e.id)).toEqual([
      abandonedOne.id,
    ]);
    expect((await entriesByStatus("in-progress")).map((e) => e.id)).toEqual([
      openOne.id,
    ]);
  });

  it("lists every entry whatever its status (E6.2's corpus read)", async () => {
    const book = await addItem(bookSeed);
    const movie = await addItem(movieSeed);
    expect(await listEntries()).toEqual([]);
    const finishedOne = await startEntry(book.id);
    await finishEntry(finishedOne.id);
    const openOne = await startEntry(movie.id);

    expect((await listEntries()).map((e) => e.id).sort()).toEqual(
      [finishedOne.id, openOne.id].sort(),
    );
  });

  it("writes the verdict fields — gradient, mode, tags, note (E4.4)", async () => {
    const book = await addItem(bookSeed);
    const started = await startEntry(book.id);
    const entry = await finishEntry(started.id);

    const rated = await rateEntry(entry.id, {
      gradient: "loved",
      mode: "admired",
      tags: ["voice", "pacing"],
      note: "Read the last hundred pages in one sitting.",
    });

    expect(rated).toMatchObject({
      id: entry.id,
      status: "finished",
      gradient: "loved",
      mode: "admired",
      tags: ["voice", "pacing"],
      note: "Read the last hundred pages in one sitting.",
    });
    // Status and dates are untouched by a rating.
    expect(rated.startedAt).toBe(entry.startedAt);
    expect(rated.finishedAt).toBe(entry.finishedAt);
    expect(await db.entries.get(entry.id)).toEqual(rated);
  });

  it("applies only the keys the patch carries, and clears the ones set undefined", async () => {
    const book = await addItem(bookSeed);
    const entry = await startEntry(book.id);
    await rateEntry(entry.id, {
      gradient: "fine",
      mode: "enjoyed",
      note: "Slow middle.",
    });

    // A mode correction must not wipe the note...
    const corrected = await rateEntry(entry.id, { mode: "comfort" });
    expect(corrected).toMatchObject({
      gradient: "fine",
      mode: "comfort",
      note: "Slow middle.",
    });

    // ...but an explicit undefined clears the field.
    const cleared = await rateEntry(entry.id, { note: undefined });
    expect(cleared.note).toBeUndefined();
    expect(cleared.gradient).toBe("fine");
  });

  it("rates what was abandoned — you can love something you did not finish", async () => {
    const book = await addItem(bookSeed);
    const started = await startEntry(book.id);
    const abandoned = await abandonEntry(started.id);

    const rated = await rateEntry(abandoned.id, {
      gradient: "no",
      tags: ["pacing"],
    });

    expect(rated.status).toBe("abandoned");
    expect(rated.gradient).toBe("no");
  });

  it("refuses an invalid rating and an unknown entry", async () => {
    const book = await addItem(bookSeed);
    const entry = await startEntry(book.id);

    await expect(
      rateEntry(entry.id, { gradient: "five-stars" as EntryRating["gradient"] }),
    ).rejects.toThrow(RepoValidationError);
    await expect(rateEntry(entry.id, { tags: [""] })).rejects.toThrow(
      RepoValidationError,
    );
    await expect(
      rateEntry("entry-nope" as EntryId, { gradient: "loved" }),
    ).rejects.toThrow(RepoNotFoundError);
    expect(await db.entries.get(entry.id)).toEqual(entry);
  });

  it("writes back a ladder score (E4.2), and refuses a non-number", async () => {
    const book = await addItem(bookSeed);
    const entry = await startEntry(book.id);

    const scored = await setEntryScore(entry.id, 1523.5);
    expect(scored.score).toBe(1523.5);
    expect(await db.entries.get(entry.id)).toEqual(scored);

    await expect(setEntryScore(entry.id, Number.NaN)).rejects.toThrow(
      RepoValidationError,
    );
    await expect(setEntryScore("entry-nope" as EntryId, 1500)).rejects.toThrow(
      RepoNotFoundError,
    );
    expect((await db.entries.get(entry.id))?.score).toBe(1523.5);
  });

  it("has no open entry once everything is closed", async () => {
    const book = await addItem(bookSeed);
    const entry = await startEntry(book.id);
    await finishEntry(entry.id);

    expect(await openEntryByItemId(book.id)).toBeUndefined();
  });
});

describe("comparisons", () => {
  it("appends a duel, minting id and comparedAt", async () => {
    const winner = await addItem(bookSeed);
    const loser = await addItem(rivalSeed);

    const duel = await appendComparison({
      genre: "money-markets",
      winnerId: winner.id,
      loserId: loser.id,
    });

    expect(duel).toMatchObject({
      genre: "money-markets",
      winnerId: winner.id,
      loserId: loser.id,
      comparedAt: T0,
    });
    expect(await db.comparisons.get(duel.id)).toEqual(duel);
  });

  it("rejects an item duelling itself, and an unknown ladder", async () => {
    const book = await addItem(bookSeed);

    await expect(
      appendComparison({
        genre: "money-markets",
        winnerId: book.id,
        loserId: book.id,
      }),
    ).rejects.toThrow(RepoValidationError);
    await expect(
      appendComparison({
        genre: "not-a-ladder" as Genre,
        winnerId: book.id,
        loserId: book.id,
      }),
    ).rejects.toThrow(RepoValidationError);
    expect(await db.comparisons.count()).toBe(0);
  });

  it("replays one ladder chronologically, isolated from the others (prefix range)", async () => {
    const book = await addItem(bookSeed);
    const rival = await addItem(rivalSeed);
    const movie = await addItem(movieSeed);
    const podcast = await addItem(podcastSeed);

    at("2026-07-14T18:30:12.250Z");
    const later = await appendComparison({
      genre: "money-markets",
      winnerId: rival.id,
      loserId: book.id,
    });
    at("2026-07-02T18:05:00.000Z");
    const otherLadder = await appendComparison({
      genre: "ambition-institutions",
      winnerId: movie.id,
      loserId: podcast.id,
    });
    at("2026-07-01T18:00:00.000Z");
    const earlier = await appendComparison({
      genre: "money-markets",
      winnerId: book.id,
      loserId: rival.id,
    });

    // Inserted newest-first; the prefix range hands them back oldest-first.
    expect(await replayComparisonsByGenre("money-markets")).toEqual([
      earlier,
      later,
    ]);
    expect(await replayComparisonsByGenre("ambition-institutions")).toEqual([
      otherLadder,
    ]);
    expect(await replayComparisonsByGenre("comfort-rewatch")).toEqual([]);
  });
});

describe("comparisons — index usage", () => {
  it("reads through the [genre+comparedAt] index rather than scanning the table", async () => {
    const book = await addItem(bookSeed);
    const rival = await addItem(rivalSeed);
    await appendComparison({
      genre: "money-markets",
      winnerId: book.id,
      loserId: rival.id,
    });

    // A filter-and-sort implementation would return the same rows, so the
    // only way to pin the compound index down is to watch for it being
    // opened. `IDBObjectStore.index()` is where Dexie asks for it.
    const opened: string[] = [];
    const openIndex = IDBObjectStore.prototype.index;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "index")
      .mockImplementation(function (this: IDBObjectStore, name: string) {
        opened.push(name);
        return openIndex.call(this, name);
      });
    try {
      await replayComparisonsByGenre("money-markets");
    } finally {
      spy.mockRestore();
    }

    expect(opened).toContain("[genre+comparedAt]");
  });
});

describe("queue", () => {
  it("adds to the stack, minting id and addedAt", async () => {
    const book = await addItem(bookSeed);

    const row = await addToQueue({
      itemId: book.id,
      contextTags: ["flight"],
      addedReason: "recommended off Bad Blood",
    });

    expect(row).toMatchObject({
      itemId: book.id,
      contextTags: ["flight"],
      addedAt: T0,
    });
    expect(await queueItemByItemId(book.id)).toEqual(row);
    expect(await listQueue()).toEqual([row]);
  });

  it("refuses a duplicate stack add and keeps one row", async () => {
    const book = await addItem(bookSeed);
    await addToQueue({ itemId: book.id, contextTags: [] });

    await expect(
      addToQueue({ itemId: book.id, contextTags: ["again"] }),
    ).rejects.toThrow(RepoConflictError);
    expect(await db.queue.count()).toBe(1);
  });

  it("rejects an invalid write (empty context tag)", async () => {
    const book = await addItem(bookSeed);

    await expect(
      addToQueue({ itemId: book.id, contextTags: [""] }),
    ).rejects.toThrow(RepoValidationError);
    expect(await db.queue.count()).toBe(0);
  });

  it("removes a row, and refuses to remove one that is not there", async () => {
    const book = await addItem(bookSeed);
    const row = await addToQueue({ itemId: book.id, contextTags: [] });

    await removeFromQueue(row.id);
    expect(await queueItemByItemId(book.id)).toBeUndefined();
    expect(await listQueue()).toEqual([]);
    await expect(removeFromQueue(row.id)).rejects.toThrow(RepoNotFoundError);
    await expect(
      removeFromQueue("queue-nope" as QueueItemId),
    ).rejects.toThrow(RepoNotFoundError);
  });

  it("serializes two racing stack adds for one item into exactly one row", async () => {
    const book = await addItem(bookSeed);

    const outcomes = await Promise.allSettled([
      addToQueue({ itemId: book.id, contextTags: ["a"] }),
      addToQueue({ itemId: book.id, contextTags: ["b"] }),
    ]);

    // Without the transaction around check-then-add, both reads miss and both
    // rows land.
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(RepoConflictError);
    expect(await db.queue.count()).toBe(1);
  });

  it("reports no stack row for an item that is not on the stack", async () => {
    expect(await queueItemByItemId("item-nope" as ItemId)).toBeUndefined();
    expect(await listQueue()).toEqual([]);
  });
});

describe("situations", () => {
  const input = {
    label: "45 min before bed",
    prompt: "Something absorbing but short; nothing that will keep me up.",
    source: "built-in",
  } as const;

  it("creates, reads, and lists", async () => {
    const situation = await createSituation(input);

    expect(situation).toMatchObject({ ...input, createdAt: T0 });
    expect(await getSituation(situation.id)).toEqual(situation);
    expect(await listSituations()).toEqual([situation]);
  });

  it("rejects an invalid create", async () => {
    await expect(
      createSituation({ ...input, label: "" }),
    ).rejects.toThrow(RepoValidationError);
    await expect(
      createSituation({
        ...input,
        source: "telepathy",
      } as unknown as typeof input),
    ).rejects.toThrow(RepoValidationError);
    expect(await db.situations.count()).toBe(0);
  });

  it("updates the editable half and leaves provenance alone", async () => {
    const situation = await createSituation(input);

    const updated = await updateSituation(situation.id, { label: "before bed" });

    expect(updated).toMatchObject({
      id: situation.id,
      label: "before bed",
      prompt: input.prompt,
      source: "built-in",
      createdAt: T0,
    });
    expect(await getSituation(situation.id)).toEqual(updated);
  });

  it("rejects an invalid update and leaves the row untouched", async () => {
    const situation = await createSituation(input);

    await expect(
      updateSituation(situation.id, { prompt: "" }),
    ).rejects.toThrow(RepoValidationError);
    expect(await getSituation(situation.id)).toEqual(situation);
  });

  it("deletes, and refuses unknown ids on read, update and delete", async () => {
    const situation = await createSituation(input);
    await deleteSituation(situation.id);

    expect(await getSituation(situation.id)).toBeUndefined();
    expect(await listSituations()).toEqual([]);
    await expect(deleteSituation(situation.id)).rejects.toThrow(
      RepoNotFoundError,
    );
    await expect(
      updateSituation("situation-nope" as SituationId, { label: "x" }),
    ).rejects.toThrow(RepoNotFoundError);
    expect(await getSituation("situation-nope" as SituationId)).toBeUndefined();
  });
});

describe("availability", () => {
  it("persists a successful empty refresh marker atomically", async () => {
    const movie = await addItem(movieSeed);

    await refreshAvailabilityState(movie.id, [], T0);

    expect(await availabilityByItemId(movie.id)).toEqual([]);
    expect(await availabilityRefreshByItemId(movie.id)).toEqual({
      itemId: movie.id,
      fetchedAt: T0,
    });
  });

  it("prevents a delayed older refresh from overwriting newer rows", async () => {
    const movie = await addItem(movieSeed);
    const newerAt = "2026-08-01T16:00:00.000Z";
    const olderAt = "2026-08-01T15:00:00.000Z";
    const newer = subscriptionOffer(movie.id, newerAt);
    const older = {
      ...subscriptionOffer(movie.id, olderAt),
      providerId: providerIdSchema.parse("hulu"),
    };
    let releaseOlder!: () => void;
    const gate = new Promise<void>((resolve) => { releaseOlder = resolve; });
    const delayedOlder = (async () => {
      await gate;
      return refreshAvailabilityState(movie.id, [older], olderAt);
    })();

    expect(await refreshAvailabilityState(movie.id, [newer], newerAt)).toBe(true);
    releaseOlder();
    expect(await delayedOlder).toBe(false);
    expect(await readAvailabilityState(movie.id)).toEqual({
      offers: [newer],
      refresh: { itemId: movie.id, fetchedAt: newerAt },
    });
  });

  it("rejects corrupted stored marker and offer state on transactional read", async () => {
    const movie = await addItem(movieSeed);
    await db.availabilityRefreshes.put({
      itemId: movie.id,
      fetchedAt: "not-a-timestamp",
    } as never);
    await expect(readAvailabilityState(movie.id)).rejects.toThrow(
      RepoValidationError,
    );

    await db.availabilityRefreshes.clear();
    await db.availability.add({
      ...subscriptionOffer(movie.id, T0),
      kind: "borrow",
    } as never);
    await expect(readAvailabilityState(movie.id)).rejects.toThrow(
      RepoValidationError,
    );
  });

  it("stores an item's offers and reads them back", async () => {
    const movie = await addItem(movieSeed);
    const offer = subscriptionOffer(movie.id, T0);

    await refreshAvailabilityForItem(movie.id, [offer]);

    expect(await availabilityByItemId(movie.id)).toEqual([offer]);
  });

  it("refresh replaces rather than piles up — delete-then-add, not put", async () => {
    const movie = await addItem(movieSeed);
    const first = subscriptionOffer(movie.id, T0);

    await refreshAvailabilityForItem(movie.id, [first]);
    // The same offer content again: a put-shaped refresh would insert a second
    // row here, because the table's primary key is a hidden outbound one.
    await refreshAvailabilityForItem(movie.id, [first]);
    expect(await availabilityByItemId(movie.id)).toEqual([first]);

    const fresher = {
      ...subscriptionOffer(movie.id, "2026-07-29T12:00:00.000Z"),
      kind: "rent",
      priceUsd: 3.99,
    } as Availability;
    await refreshAvailabilityForItem(movie.id, [fresher]);

    expect(await availabilityByItemId(movie.id)).toEqual([fresher]);
    expect(await db.availability.count()).toBe(1);
  });

  it("an empty refresh purges — 'nothing available right now' is a real answer", async () => {
    const movie = await addItem(movieSeed);
    await refreshAvailabilityForItem(movie.id, [subscriptionOffer(movie.id, T0)]);

    await refreshAvailabilityForItem(movie.id, []);

    expect(await availabilityByItemId(movie.id)).toEqual([]);
    expect(await db.availability.count()).toBe(0);
  });

  it("only touches the item it was given", async () => {
    const movie = await addItem(movieSeed);
    const book = await addItem(bookSeed);
    const movieOffer = subscriptionOffer(movie.id, T0);
    const bookOffer = subscriptionOffer(book.id, T0);
    await refreshAvailabilityForItem(movie.id, [movieOffer]);
    await refreshAvailabilityForItem(book.id, [bookOffer]);

    await refreshAvailabilityForItem(movie.id, []);

    expect(await availabilityByItemId(book.id)).toEqual([bookOffer]);
  });

  it("rejects an invalid offer, and one belonging to another item, without purging", async () => {
    const movie = await addItem(movieSeed);
    const book = await addItem(bookSeed);
    const existing = subscriptionOffer(movie.id, T0);
    await refreshAvailabilityForItem(movie.id, [existing]);

    await expect(
      refreshAvailabilityForItem(movie.id, [
        { ...existing, kind: "borrow" } as unknown as Availability,
      ]),
    ).rejects.toThrow(RepoValidationError);
    await expect(
      refreshAvailabilityForItem(movie.id, [subscriptionOffer(book.id, T0)]),
    ).rejects.toThrow(RepoValidationError);
    // Both refreshes were refused, and the stored offer is still there —
    // a rejected refresh is not a purge.
    expect(await availabilityByItemId(movie.id)).toEqual([existing]);
  });

  it("stores one row per (kind, providerId), first occurrence winning", async () => {
    const movie = await addItem(movieSeed);
    const netflix = subscriptionOffer(movie.id, T0);
    const hulu: SubscriptionAvailability = {
      ...netflix,
      providerId: providerIdSchema.parse("hulu"),
      url: "https://www.hulu.com/watch/social-network",
    };
    const theater: TheaterAvailability = {
      itemId: movie.id,
      region: "US",
      kind: "theater",
      fetchedAt: T0,
      fandangoUrl: "https://www.fandango.com/the-social-network/movie-times",
    };

    await refreshAvailabilityForItem(movie.id, [
      netflix,
      // Same service, same kind, different payload — TMDB's storefront fold.
      { ...netflix, url: "https://www.netflix.com/title/duplicate" },
      hulu,
      theater,
      // Theater rows carry no providerId, so they key on kind alone.
      { ...theater, fandangoUrl: "https://www.fandango.com/duplicate" },
      { ...netflix, url: "https://www.netflix.com/title/third" },
    ]);

    // Six offers in, three rows out — and the survivors are the FIRST of each
    // key, not the last, so the caller's ordering decides.
    expect(await availabilityByItemId(movie.id)).toEqual([
      netflix,
      hulu,
      theater,
    ]);
  });

  it("finds rows fetched before a cutoff (E5.1's 24h sweep)", async () => {
    const movie = await addItem(movieSeed);
    const book = await addItem(bookSeed);
    const stale = subscriptionOffer(book.id, "2026-07-26T07:59:59.999Z");
    const fresh = subscriptionOffer(movie.id, T0);
    await refreshAvailabilityForItem(book.id, [stale]);
    await refreshAvailabilityForItem(movie.id, [fresh]);

    expect(await availabilityStaleBefore("2026-07-27T12:00:00.000Z")).toEqual([
      stale,
    ]);
    expect(await availabilityStaleBefore("2026-07-01T00:00:00.000Z")).toEqual(
      [],
    );
  });

  it("rejects a cutoff that is not a millisecond-precision ISO timestamp", async () => {
    await expect(availabilityStaleBefore("2026-07-27")).rejects.toThrow(
      RepoValidationError,
    );
    await expect(
      availabilityStaleBefore("2026-07-27T12:00:00Z"),
    ).rejects.toThrow(RepoValidationError);
  });
});

describe("recs", () => {
  it("records a dealt rec, minting id and dealtAt", async () => {
    const movie = await addItem(movieSeed);

    const rec = await recordRec({
      itemId: movie.id,
      reason: "You ranked Bad Blood top of Money & Markets.",
      source: { entry: "hand" },
    });

    expect(rec).toMatchObject({ itemId: movie.id, dealtAt: T0 });
    expect(await db.recs.get(rec.id)).toEqual(rec);
  });

  it("rejects a rec with no reason — a rec must cite your history", async () => {
    const movie = await addItem(movieSeed);

    await expect(
      recordRec({
        itemId: movie.id,
        reason: "",
        source: { entry: "hand" },
      }),
    ).rejects.toThrow(RepoValidationError);
    expect(await db.recs.count()).toBe(0);
  });

  it("marks a rejection once, with its reason and time", async () => {
    const movie = await addItem(movieSeed);
    const rec = await recordRec({
      itemId: movie.id,
      reason: "Same appetite for ambition curdling.",
      source: { entry: "hand" },
    });

    at("2026-07-28T12:00:05.400Z");
    const rejected = await markRecRejected(rec.id, "too-long");

    expect(rejected.rejection).toEqual({
      reason: "too-long",
      at: "2026-07-28T12:00:05.400Z",
    });
    expect(await db.recs.get(rec.id)).toEqual(rejected);
    // The first rejection is the one that dated the signal.
    await expect(markRecRejected(rec.id, "seen-it")).rejects.toThrow(
      RepoConflictError,
    );
    await expect(
      markRecRejected("rec-nope" as RecId, "seen-it"),
    ).rejects.toThrow(RepoNotFoundError);
  });

  it("returns history newest-first (E6.2's briefing, E6.3's cached hand)", async () => {
    const movie = await addItem(movieSeed);
    const book = await addItem(bookSeed);

    at("2026-07-27T01:00:00.000Z");
    const older = await recordRec({
      itemId: movie.id,
      reason: "One.",
      source: { entry: "hand" },
    });
    at("2026-07-27T03:45:10.101Z");
    const newer = await recordRec({
      itemId: book.id,
      reason: "Two.",
      source: { entry: "chat" },
    });

    expect((await recHistoryByRecency()).map((r) => r.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it("filters by situation; hand and chat recs are absent from that index", async () => {
    const movie = await addItem(movieSeed);
    const book = await addItem(bookSeed);
    const situation = await createSituation({
      label: "long flight",
      prompt: "Six hours, no wifi.",
      source: "chat",
    });

    const forSituation = await recordRec({
      itemId: movie.id,
      reason: "Fits the flight.",
      source: { entry: "situation", situationId: situation.id },
    });
    await recordRec({
      itemId: book.id,
      reason: "Off the cuff.",
      source: { entry: "hand" },
    });

    expect(await recsBySituationId(situation.id)).toEqual([forSituation]);
    expect(await recsBySituationId("situation-nope" as SituationId)).toEqual([]);
  });
});

describe("portrait", () => {
  const claims = [
    { kind: "axis", left: "plot-driven", right: "vibe-driven", position: -0.4 },
  ] as const;

  it("has no latest version on a fresh install", async () => {
    expect(await latestPortrait()).toBeUndefined();
  });

  it("appends monotonic versions and hands back the latest", async () => {
    const first = await appendPortraitVersion({
      claims: [...claims],
      corrections: [],
      assignedCanon: "the-circumstance",
    });
    expect(first.version).toBe(1);

    at("2026-08-04T12:00:00.000Z");
    const second = await appendPortraitVersion({
      claims: [...claims],
      corrections: [
        {
          claim: { kind: "blind-spot", text: "You avoid poetry." },
          note: "Not avoidance — just untracked.",
          at: T0,
        },
      ],
    });

    expect(second.version).toBe(2);
    expect(second.synthesizedAt).toBe("2026-08-04T12:00:00.000Z");
    expect(await latestPortrait()).toEqual(second);
    // The predecessor is still readable — a synthesis never edits history.
    expect(await db.portrait.get(1)).toEqual(first);
  });

  it("mints distinct versions for syntheses that race on app-open", async () => {
    const three = await Promise.all([
      appendPortraitVersion({ claims: [...claims], corrections: [] }),
      appendPortraitVersion({ claims: [...claims], corrections: [] }),
      appendPortraitVersion({ claims: [...claims], corrections: [] }),
    ]);

    // Without the transaction around read-latest-then-append, all three read
    // version 0 and only one row survives.
    expect(three.map((p) => p.version).sort()).toEqual([1, 2, 3]);
    expect(await db.portrait.count()).toBe(3);
    expect((await latestPortrait())?.version).toBe(3);
  });

  it("rejects an out-of-range axis claim and writes nothing", async () => {
    await expect(
      appendPortraitVersion({
        claims: [
          { kind: "axis", left: "plot-driven", right: "vibe-driven", position: 2 },
        ],
        corrections: [],
      }),
    ).rejects.toThrow(RepoValidationError);
    expect(await db.portrait.count()).toBe(0);
  });
});

describe("transaction rollback", () => {
  it("rolls the entry back to in-progress when the stack write fails", async () => {
    const book = await addItem(bookSeed);
    const started = await startEntry(book.id);
    const row = await addToQueue({ itemId: book.id, contextTags: [] });

    // Fail the queue half of the transaction from inside IndexedDB itself.
    const explode = () => {
      throw new Error("stack write failed");
    };
    db.queue.hook("deleting", explode);
    try {
      await expect(finishEntry(started.id)).rejects.toThrow();
    } finally {
      db.queue.hook("deleting").unsubscribe(explode);
    }

    // Both halves are back where they were: no entry marked finished while the
    // item still sits on the stack.
    expect(await db.entries.get(started.id)).toEqual(started);
    expect(await queueItemByItemId(book.id)).toEqual(row);
  });
});

describe("snapshot (E1.3 export/import, E1.4 seed)", () => {
  /** A library with something in every table. */
  async function populate() {
    const book = await addItem(bookSeed);
    const rival = await addItem(rivalSeed);
    const movie = await addItem(movieSeed);
    await setItemGenre(book.id, { genre: "money-markets", source: "auto" });
    await setItemGenre(rival.id, { genre: "money-markets", source: "manual" });
    const entry = await startEntry(book.id);
    await rateEntry(entry.id, { gradient: "loved", tags: ["voice"] });
    await finishEntry(entry.id);
    await appendComparison({
      genre: "money-markets",
      winnerId: book.id,
      loserId: rival.id,
    });
    await addToQueue({ itemId: movie.id, contextTags: ["with M"] });
    const situation = await createSituation({
      label: "long flight",
      prompt: "Six hours, no wifi.",
      source: "chat",
    });
    await refreshAvailabilityForItem(movie.id, [subscriptionOffer(movie.id, T0)]);
    const rec = await recordRec({
      itemId: movie.id,
      reason: "Fits the flight.",
      source: { entry: "situation", situationId: situation.id },
    });
    await markRecRejected(rec.id, "seen-it");
    await appendPortraitVersion({
      claims: [
        { kind: "axis", left: "plot-driven", right: "vibe-driven", position: -0.4 },
      ],
      corrections: [],
    });
  }

  it("reads every table in one consistent pass", async () => {
    await populate();

    const snapshot = await readSnapshot();

    expect(Object.keys(snapshot).sort()).toEqual([
      "availability",
      "availabilityRefreshes",
      "comparisons",
      "entries",
      "items",
      "manualMatches",
      "portrait",
      "queue",
      "recs",
      "situations",
    ]);
    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.availability).toHaveLength(1);
    expect(snapshot.portrait).toHaveLength(1);
  });

  it("round-trips a whole library back to an identical state", async () => {
    await populate();
    const before = await readSnapshot();

    // A fresh install…
    await Promise.all(db.tables.map((table) => table.clear()));
    expect(await readSnapshot()).toMatchObject({ items: [], entries: [] });

    // …restored from the backup.
    await restoreSnapshot(before);

    expect(await readSnapshot()).toEqual(before);
  });

  it("preserves supplied ids and timestamps — the 2013 read the transitions cannot express", async () => {
    const book = await addItem(bookSeed);
    const historical: Entry = {
      id: "entry-2013-bad-blood" as EntryId,
      itemId: book.id,
      status: "finished",
      startedAt: "2013-04-02T18:00:00.000Z",
      finishedAt: "2013-04-19T21:15:30.500Z",
      gradient: "loved",
      mode: "comfort",
      tags: ["voice"],
      note: "Read it on the train.",
    };

    await restoreSnapshot({ entries: [historical] });

    // Byte-identical: no re-minted id, no now() anywhere near it.
    expect(await db.entries.get(historical.id)).toEqual(historical);
    expect((await entriesByItemId(book.id))[0]).toEqual(historical);
  });

  it("refuses a bad record and writes nothing at all, across tables", async () => {
    const book = await addItem(bookSeed);
    const valid = await readSnapshot();

    await expect(
      restoreSnapshot({
        situations: [
          {
            id: "situation-ok" as SituationId,
            label: "before bed",
            prompt: "Something short.",
            source: "built-in",
            createdAt: T0,
          },
        ],
        entries: [
          {
            id: "entry-bad" as EntryId,
            itemId: book.id,
            status: "finished",
            tags: [],
            gradient: "five-stars",
          } as unknown as Entry,
        ],
      }),
    ).rejects.toThrow(RepoValidationError);

    // The good table's rows never landed either — one bad record aborts the lot.
    expect(await db.situations.count()).toBe(0);
    expect(await readSnapshot()).toEqual(valid);
  });

  it("refuses to restore over records that are already there, in this layer's own vocabulary", async () => {
    await populate();
    const snapshot = await readSnapshot();

    // Not a raw Dexie BulkError: E1.3 has to tell "you already have this
    // library" from a failing disk, and can only branch on `code`.
    const failure = await restoreSnapshot(snapshot).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RepoConflictError);
    expect(failure).toMatchObject({ code: "conflict", table: "items" });
  });

  it("aborts the whole restore on a collision — bulkAdd's survivors do not land", async () => {
    const existing = await addItem(bookSeed);
    const fresh: Item = { ...existing, id: "item-brand-new" as ItemId };
    const situation: Situation = {
      id: "situation-fresh" as SituationId,
      label: "before bed",
      prompt: "Something short.",
      source: "built-in",
      createdAt: T0,
    };

    // Dexie's bulkAdd keeps going past a failed row, so the colliding record
    // is deliberately first: everything after it must still be rolled back.
    await expect(
      restoreSnapshot({ items: [existing, fresh], situations: [situation] }),
    ).rejects.toThrow(RepoConflictError);

    expect(await db.items.count()).toBe(1);
    expect(await getItem(fresh.id)).toBeUndefined();
    expect(await db.situations.count()).toBe(0);
  });

  it("atomically refuses a fresh-install restore when any table has data", async () => {
    const movie = await addItem(movieSeed);
    const offer = subscriptionOffer(movie.id, T0);
    await Promise.all(db.tables.map((table) => table.clear()));
    await restoreSnapshot({ availability: [offer] });

    await expect(
      restoreSnapshotIfEmpty({ items: [movie] }),
    ).rejects.toThrow(RepoConflictError);
    expect(await db.items.count()).toBe(0);
    expect(await db.availability.count()).toBe(1);
  });
});
