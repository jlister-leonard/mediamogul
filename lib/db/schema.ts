import Dexie, { type DexieOptions, type EntityTable, type Table } from "dexie";
import type {
  Availability,
  AvailabilityRefresh,
  Comparison,
  Entry,
  GoodreadsManualMatch,
  Item,
  Portrait,
  QueueItem,
  Rec,
  Situation,
} from "../types";

export const DB_NAME = "nightstand";

/**
 * Version 1 — the shipped schema. Dexie stores strings list ONLY the primary
 * key and the indexed properties; every other contract field is stored as-is,
 * unlisted. Future schema changes append `this.version(2).stores(...)` blocks
 * in `NightstandDB` below — Dexie diffs the declarations and upgrades
 * in-place, the path proven by the v1→v2 test in `schema.test.ts`.
 *
 * Index policy: every index below maps to a query pattern a named bead ships;
 * nothing speculative. `comparedAt`/`fetchedAt`/`dealtAt` are ms-precision
 * ISO strings by contract (`isoTimestampSchema`), which is what makes their
 * IndexedDB string ordering chronological.
 */
export const schemaV1: Record<string, string> = {
  // PK `id` (ItemId, minted on-device).
  //   medium      → E3.2 library filter by medium; E2.5 "Your library" scope
  //                 grouped by medium; E6.3 hand spanning media types.
  //   genre.genre → E3.2 library filter by genre; E4.1/E4.2 fetching one
  //                 genre's pool for duel selection. Dotted keypath into the
  //                 optional GenreAssignment: unassigned items are simply
  //                 absent from the index, which is the wanted semantics.
  items: "id, medium, genre.genre",

  // PK `id` (EntryId).
  //   itemId → E3.1 find the open entry when logging; E3.3 your data on the
  //            detail page; E6.5 derived "what worked" join (rec → entry).
  //   status → E3.2 segments: On the nightstand (in-progress) / The drawer
  //            (finished, abandoned).
  entries: "id, itemId, status",

  // PK `id` (ComparisonId).
  //   [genre+comparedAt] → E4.2 ladder replay: one genre pool's duels in
  //     chronological order (sequential Elo updates depend on it). Duels are
  //     never cross-genre, so no bead queries comparedAt across genres; the
  //     compound serves genre-equality via a prefix range
  //     (`between([g, minKey], [g, maxKey])`) and chronological order inside
  //     it — one index, both halves of the pattern.
  comparisons: "id, [genre+comparedAt]",

  // PK `id` (QueueItemId).
  //   itemId → E3.1 dedupe ("already on the stack"); E6.3 queue-first hand;
  //            E6.5 derived "what worked" join (rec → queue add).
  queue: "id, itemId",

  // PK `id` (SituationId). No secondary indexes: the chip row (E6.5)
  // enumerates the whole table, which stays chip-sized by construction.
  situations: "id",

  // PK: hidden auto-increment (`++`). The Availability contract has no id
  // field and no natural key — theater rows carry no providerId, so a
  // compound like [itemId+kind+providerId] cannot key every variant. An
  // outbound key keeps stored records byte-identical to the contract (no
  // shadow key property).
  //   itemId    → E5.1/E5.5 the Get-it row for one item; E6 "on something I
  //               already pay for" constraint.
  //   fetchedAt → E5.1 24h staleness: find/purge stale rows with a range
  //               query instead of a full scan.
  availability: "++, itemId, fetchedAt",

  // PK `id` (RecId).
  //   itemId             → E6.6 rejection history per item feeding
  //                        taste-context; E6.3 "already dealt" dedupe.
  //   source.situationId → E6.5 "what worked" per situation, derived by
  //     joining a situation's recs against later entries/queue adds. Dotted
  //     keypath rather than multiEntry or a denormalized column: RecSource is
  //     a discriminated union and only the "situation" variant carries the
  //     path, so hand/chat recs are simply absent from the index — exactly
  //     the wanted semantics, with no schema drift from the contract.
  //   dealtAt            → E6.3 last hand cached for instant open (most
  //                        recent deal); E6.2 recency-ordered rejection
  //                        history for the briefing.
  recs: "id, itemId, source.situationId, dealtAt",

  // PK `version` — the contract says "version is the key": monotonically
  // increasing, one row per synthesis (E7.1). Latest = orderBy PK, last();
  // no secondary indexes.
  portrait: "version",
};

/** Version 2 persists Goodreads rows that still need a human catalog choice. */
export const schemaV2: Record<string, string> = {
  manualMatches: "id",
};

/** Version 3 records successful availability checks even when offers are empty. */
export const schemaV3: Record<string, string> = {
  availabilityRefreshes: "itemId, fetchedAt",
};

/**
 * The Nightstand database (PLAN §8: the phone is the source of truth).
 *
 * Tables are typed straight off the `lib/types` contracts — no shadow types,
 * no renamed fields. The third `EntityTable` parameter pins the insert type
 * to the full entity: primary keys are minted on-device before insert, never
 * auto-generated, so nothing is optional on the way in (and it keeps Item's
 * discriminated union intact, which the default `Omit`-based insert type
 * would collapse).
 *
 * Validation boundary: Zod does NOT run here. This layer is shape + indexes
 * only; the repo layer (E1.2) owns write-time validation with the same
 * `lib/types` schemas, so every record passes exactly one gate on its way in.
 */
export class NightstandDB extends Dexie {
  items!: EntityTable<Item, "id", Item>;
  entries!: EntityTable<Entry, "id", Entry>;
  comparisons!: EntityTable<Comparison, "id", Comparison>;
  queue!: EntityTable<QueueItem, "id", QueueItem>;
  situations!: EntityTable<Situation, "id", Situation>;
  /** Outbound numeric key (see `schemaV1.availability`) — plain `Table`, since `EntityTable` requires an in-record key. */
  availability!: Table<Availability, number, Availability>;
  recs!: EntityTable<Rec, "id", Rec>;
  portrait!: EntityTable<Portrait, "version", Portrait>;
  manualMatches!: EntityTable<GoodreadsManualMatch, "id", GoodreadsManualMatch>;
  availabilityRefreshes!: EntityTable<
    AvailabilityRefresh,
    "itemId",
    AvailabilityRefresh
  >;

  /** `options` lets tests inject fake-indexeddb; production uses the browser's. */
  constructor(options?: DexieOptions) {
    super(DB_NAME, options);
    this.version(1).stores(schemaV1);
    this.version(2).stores(schemaV2);
    this.version(3).stores(schemaV3);
  }
}
