// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import type { z } from "zod";
import {
  availabilitySchema,
  comparisonSchema,
  entrySchema,
  itemSchema,
  portraitSchema,
  queueItemSchema,
  recSchema,
  situationSchema,
  type Availability,
  type Comparison,
  type Entry,
  type Item,
  type Portrait,
  type QueueItem,
  type Rec,
  type Situation,
} from "../../types";
import { db } from "../index";
import { RepoConflictError, validate, type RepoTable } from "./errors";

/**
 * Whole-database read and write (E1.2), for the two beads that move records
 * rather than create them.
 *
 * Every other verb in this layer mints its own ids and timestamps, which is
 * right for a title you just found and fatal for a record you already have:
 * re-minting an `ItemId` on import breaks every `itemId` reference in the
 * backup, and re-stamping `comparedAt` destroys the ordering E4.2's replay
 * depends on. So these two verbs take records whole — ids, timestamps and
 * all — and validate them in full. That is what makes E1.3's "restores a
 * fresh install to identical state" round-trip achievable *through* the
 * validation gate rather than around it.
 */
export interface RepoSnapshot {
  items: readonly Item[];
  entries: readonly Entry[];
  comparisons: readonly Comparison[];
  queue: readonly QueueItem[];
  situations: readonly Situation[];
  availability: readonly Availability[];
  recs: readonly Rec[];
  portrait: readonly Portrait[];
}

/**
 * Every record in the database, read inside one transaction so the export is
 * a consistent point in time rather than eight racing reads.
 *
 * Availability rows come back exactly as stored: the table's primary key is
 * outbound (`lib/db/schema.ts`), so nothing about it leaks into the backup —
 * a restore simply re-keys them.
 *
 * Consumers: E1.3 export (versioned JSON via the share sheet), E8.5's
 * offline-hardening pass.
 */
export async function readSnapshot(): Promise<RepoSnapshot> {
  // `db.tables` is literally the scope here: a snapshot is every table.
  return db.transaction("r", db.tables, async () => ({
    items: await db.items.toArray(),
    entries: await db.entries.toArray(),
    comparisons: await db.comparisons.toArray(),
    queue: await db.queue.toArray(),
    situations: await db.situations.toArray(),
    availability: await db.availability.toArray(),
    recs: await db.recs.toArray(),
    portrait: await db.portrait.toArray(),
  }));
}

/**
 * Insert whole records as they stand, in one transaction across every table
 * given: a half-applied import is worse than a refused one, so a single bad
 * record anywhere aborts the lot (validation runs first, before anything is
 * written).
 *
 * `add` semantics, not `put`: a colliding id means the caller is restoring
 * over an existing library, which is a different operation from the one E1.3
 * ships, and failing loudly beats silently merging two histories. The
 * collision surfaces as a `RepoConflictError` naming the table, so E1.3 can
 * tell "this backup is for a library you already have" from a genuine
 * IndexedDB fault and say so in human words.
 *
 * ONE EXCEPTION to that guarantee: `availability` is keyed by a hidden
 * outbound auto-increment (`lib/db/schema.ts`), so its rows carry no id to
 * collide on — restoring a snapshot that contains only availability rows
 * appends duplicates instead of failing. A whole-snapshot restore trips on
 * `items` long before that matters, and E5.1's next refresh converges the
 * table anyway (delete-then-add), but a caller restoring that table alone
 * should clear it first.
 *
 * NO referential-integrity check: this layer validates record shape, not the
 * graph between records. An entry whose `itemId` matches no item, or a rec
 * citing a deleted situation, restores cleanly. Verifying that a backup's
 * cross-references resolve is E1.3's job, on the whole snapshot, before it
 * calls this.
 *
 * Consumers: E1.3 import (the whole snapshot), E1.4 Goodreads import (items
 * and their finished entries — historical `startedAt`/`finishedAt`, gradients
 * and modes, which the `startEntry`/`finishEntry` transitions cannot express
 * because they stamp the present).
 */
export async function restoreSnapshot(
  snapshot: Partial<RepoSnapshot>,
): Promise<void> {
  const verb = "restoreSnapshot";
  const items = validateAll(itemSchema, snapshot.items, "items", verb);
  const entries = validateAll(entrySchema, snapshot.entries, "entries", verb);
  const comparisons = validateAll(
    comparisonSchema,
    snapshot.comparisons,
    "comparisons",
    verb,
  );
  const queue = validateAll(queueItemSchema, snapshot.queue, "queue", verb);
  const situations = validateAll(
    situationSchema,
    snapshot.situations,
    "situations",
    verb,
  );
  const availability = validateAll(
    availabilitySchema,
    snapshot.availability,
    "availability",
    verb,
  );
  const recs = validateAll(recSchema, snapshot.recs, "recs", verb);
  const portrait = validateAll(
    portraitSchema,
    snapshot.portrait,
    "portrait",
    verb,
  );

  await db.transaction("rw", db.tables, async () => {
    await insertAll("items", items, db.items);
    await insertAll("entries", entries, db.entries);
    await insertAll("comparisons", comparisons, db.comparisons);
    await insertAll("queue", queue, db.queue);
    await insertAll("situations", situations, db.situations);
    await insertAll("availability", availability, db.availability);
    await insertAll("recs", recs, db.recs);
    await insertAll("portrait", portrait, db.portrait);
  });
}

/** Same gate as every other write, applied record by record. */
function validateAll<S extends z.ZodType>(
  schema: S,
  values: readonly unknown[] | undefined,
  table: RepoTable,
  verb: string,
): z.output<S>[] {
  return (values ?? []).map((value) => validate(schema, value, table, verb));
}

/**
 * Insert one table's rows, translating a key collision into this layer's own
 * vocabulary. Dexie reports it as a `BulkError` (or a bare `ConstraintError`),
 * which carries no `code` and no `table` — an untyped infrastructure error
 * escaping here would leave E1.3 unable to tell a non-empty database from a
 * failing disk. Throwing inside the transaction still aborts the whole
 * restore, which matters because `bulkAdd` keeps going past a failed row.
 */
async function insertAll<T>(
  table: RepoTable,
  rows: readonly T[],
  store: { bulkAdd(rows: T[]): PromiseLike<unknown> },
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await store.bulkAdd([...rows]);
  } catch (cause) {
    if (isKeyCollision(cause)) {
      throw new RepoConflictError(
        table,
        `restoreSnapshot: ${table} already holds a record with one of these ids — a restore targets a fresh install`,
      );
    }
    throw cause;
  }
}

/** Dexie names both flavours of "that key is taken" on the error itself. */
function isKeyCollision(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === "BulkError" || cause.name === "ConstraintError")
  );
}
