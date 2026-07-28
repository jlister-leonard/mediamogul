// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import {
  entryIdSchema,
  entrySchema,
  type Entry,
  type EntryId,
  type EntryStatus,
  type ItemId,
} from "../../types";
import { db } from "../index";
import { RepoConflictError, RepoNotFoundError, validate } from "./errors";
import { mintId, nowIso } from "./mint";
import { clearStackForItem } from "./queue";

/**
 * `entries` — my log for one item (E1.2 repo layer).
 *
 * The three transitions below are the only way an entry's status moves, and
 * each one guards the state it requires: you cannot finish what you never
 * started. `rateEntry` and `setEntryScore` cover the rest of the contract's
 * fields — storage only: which gradient, which mode and which tags is E4.4's
 * call, and what the score should be is E4.2's. An entry whose dates are
 * history rather than now (E1.4's imported reads) arrives whole through
 * `restoreSnapshot`, not through these transitions.
 *
 * Each transition also clears the item off the stack, in one transaction with
 * the entry write: an item belongs to exactly one of E3.2's segments — the
 * stack, the nightstand, the drawer — and a torn write would put it in two.
 */

/**
 * The verdict half of an entry (E4.4's output). An absent key leaves that
 * field as it was; a key present with `undefined` clears it — except `tags`,
 * which the contract requires, so un-tagging is `{ tags: [] }` and
 * `{ tags: undefined }` is a validation error.
 */
export type EntryRating = Partial<
  Pick<Entry, "gradient" | "mode" | "tags" | "note">
>;

/**
 * The open (in-progress) entry for an item, if there is one.
 *
 * Consumers: E3.1 log flow (which verb to offer), E3.3's detail-page action
 * row, E4.4 (the entry a finish hands to the rating flow).
 */
export async function openEntryByItemId(
  itemId: ItemId,
): Promise<Entry | undefined> {
  return db.entries
    .where("itemId")
    .equals(itemId)
    .filter((entry) => entry.status === "in-progress")
    .first();
}

/**
 * Every entry ever logged for an item — a re-read is a second entry, so this
 * is a list, not a row.
 *
 * Consumers: E3.3 "your data" block, E6.5's derived "what worked" join
 * (rec → entry).
 */
export async function entriesByItemId(itemId: ItemId): Promise<Entry[]> {
  return db.entries.where("itemId").equals(itemId).toArray();
}

/**
 * Every entry, whole-table. The statuses are a closed contract enum today,
 * but assembling "all of them" from one `entriesByStatus` call per status
 * silently drops a status the day the contract gains one — so the corpus
 * reads are their own verb.
 *
 * Consumers: E6.2 taste context (the library summary), E1.3 export,
 * E7.1 portrait synthesis.
 */
export async function listEntries(): Promise<Entry[]> {
  return db.entries.toArray();
}

/**
 * Every entry in one status, via the `status` index.
 *
 * Consumers: E3.2 segments — On the nightstand (`in-progress`) and The
 * drawer (`finished`, `abandoned`).
 */
export async function entriesByStatus(status: EntryStatus): Promise<Entry[]> {
  return db.entries.where("status").equals(status).toArray();
}

/**
 * Start reading/watching/listening: mints an entry, stamps `startedAt`, and
 * takes the item off the stack. A second open entry for the same item is a
 * conflict — you are reading it or you are not.
 *
 * Consumers: E3.1 log flow (start, ≤2 taps from search or detail).
 */
export async function startEntry(itemId: ItemId): Promise<Entry> {
  return db.transaction("rw", db.entries, db.queue, async () => {
    const open = await openEntryByItemId(itemId);
    if (open) {
      throw new RepoConflictError(
        "entries",
        `startEntry: ${itemId} already has an open entry (${open.id})`,
      );
    }
    const entry = validate(
      entrySchema,
      {
        id: mintId(entryIdSchema),
        itemId,
        status: "in-progress",
        startedAt: nowIso(),
        tags: [],
      },
      "entries",
      "startEntry",
    );
    await db.entries.add(entry);
    await clearStackForItem(itemId);
    return entry;
  });
}

/**
 * Finish it: `finished` + `finishedAt`, and off the stack in the same
 * transaction.
 *
 * Consumers: E3.1 finish (which then triggers E4.4's rating flow).
 */
export async function finishEntry(id: EntryId): Promise<Entry> {
  return closeEntry(id, "finished", "finishEntry");
}

/**
 * Abandon it: `abandoned`, no `finishedAt` — the drawer records that you
 * stopped, and pretending you finished would poison E6.2's taste context.
 *
 * Consumers: E3.1 abandon.
 */
export async function abandonEntry(id: EntryId): Promise<Entry> {
  return closeEntry(id, "abandoned", "abandonEntry");
}

/**
 * The verdict fields, written together because they are captured together.
 * Keys present in `rating` win — including a key present with `undefined`,
 * which clears that optional field (deleting a note). Absent keys are left
 * alone, so a mode correction cannot wipe a note. `tags` is required by the
 * contract: clear it with `[]`.
 *
 * Storage only: the gradient is the user's tap, the mode is E4.4's inference
 * (always correctable), the tags are E4.4's contextual chip set. Ratable in
 * any status — you can love something you abandoned.
 *
 * Consumers: E4.4 rating flow (gradient, mode chip, taste tags, note),
 * E3.3's edit affordances, E1.4's imported Goodreads ratings.
 */
export async function rateEntry(id: EntryId, rating: EntryRating): Promise<Entry> {
  return db.transaction("rw", db.entries, async () => {
    const existing = await db.entries.get(id);
    if (!existing) {
      throw new RepoNotFoundError("entries", `rateEntry: no entry ${id}`);
    }
    const updated = validate(
      entrySchema,
      { ...existing, ...rating },
      "entries",
      "rateEntry",
    );
    await db.entries.put(updated);
    return updated;
  });
}

/**
 * Write back an entry's standing on its genre ladder. Separate from
 * `rateEntry` because the two have different authors: the gradient is yours,
 * the score is the engine's, derived by replaying comparisons — and E4.2
 * rewrites it for a whole pool at once after every duel.
 *
 * Consumers: E4.2 ladder engine (replay writeback), E4.5 ladder screen
 * (drag-to-correct re-scores the pool).
 */
export async function setEntryScore(id: EntryId, score: number): Promise<Entry> {
  return db.transaction("rw", db.entries, async () => {
    const existing = await db.entries.get(id);
    if (!existing) {
      throw new RepoNotFoundError("entries", `setEntryScore: no entry ${id}`);
    }
    const updated = validate(
      entrySchema,
      { ...existing, score },
      "entries",
      "setEntryScore",
    );
    await db.entries.put(updated);
    return updated;
  });
}

/**
 * The shared terminal transition. Both closers require an open entry, so
 * "finish without start" fails loudly instead of inventing history.
 */
function closeEntry(
  id: EntryId,
  status: Extract<EntryStatus, "finished" | "abandoned">,
  verb: string,
): Promise<Entry> {
  return db.transaction("rw", db.entries, db.queue, async () => {
    const existing = await db.entries.get(id);
    if (!existing) {
      throw new RepoNotFoundError("entries", `${verb}: no entry ${id}`);
    }
    if (existing.status !== "in-progress") {
      throw new RepoConflictError(
        "entries",
        `${verb}: entry ${id} is ${existing.status}, not in-progress`,
      );
    }
    const updated = validate(
      entrySchema,
      status === "finished"
        ? { ...existing, status, finishedAt: nowIso() }
        : { ...existing, status },
      "entries",
      verb,
    );
    await db.entries.put(updated);
    await clearStackForItem(existing.itemId);
    return updated;
  });
}
