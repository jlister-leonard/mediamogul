// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import {
  queueItemIdSchema,
  queueItemSchema,
  type ItemId,
  type QueueItem,
  type QueueItemId,
} from "../../types";
import { db } from "../index";
import { RepoConflictError, RepoNotFoundError, validate } from "./errors";
import { mintId, nowIso } from "./mint";

/**
 * `queue` — the stack, i.e. the shortlist (E1.2 repo layer).
 *
 * `addedAt` is provenance only: ordering the stack is the recommender's job
 * (PLAN §7), so nothing here sorts by it.
 */

/** What a caller supplies; the id and `addedAt` are minted here. */
export type QueueAddInput = Omit<QueueItem, "id" | "addedAt">;

/**
 * Put a title on the stack. One row per item by construction — a second add
 * is a conflict, not a duplicate row, which is what makes E3.1's "already on
 * the stack" state trustworthy and E6.3's queue-first hand unambiguous.
 *
 * Consumers: E3.1 add-to-stack, E2.5 long-press quick-add, E6.3 (a dealt rec
 * accepted onto the stack).
 */
export async function addToQueue(input: QueueAddInput): Promise<QueueItem> {
  return db.transaction("rw", db.queue, async () => {
    const existing = await db.queue.where("itemId").equals(input.itemId).first();
    if (existing) {
      throw new RepoConflictError(
        "queue",
        `addToQueue: ${input.itemId} is already on the stack`,
      );
    }
    const row = validate(
      queueItemSchema,
      { ...input, id: mintId(queueItemIdSchema), addedAt: nowIso() },
      "queue",
      "addToQueue",
    );
    await db.queue.add(row);
    return row;
  });
}

/**
 * Take a title off the stack by hand. Removing a row that is not there is an
 * error rather than a silent no-op: it means the caller's view of the stack
 * is stale.
 *
 * Consumers: E3.1 (remove from stack), E3.2's stack segment.
 */
export async function removeFromQueue(id: QueueItemId): Promise<void> {
  await db.transaction("rw", db.queue, async () => {
    const existing = await db.queue.get(id);
    if (!existing) {
      throw new RepoNotFoundError("queue", `removeFromQueue: no queue row ${id}`);
    }
    await db.queue.delete(id);
  });
}

/**
 * The stack row for one item, via the `itemId` index — absent means "not on
 * the stack".
 *
 * Consumers: E3.1 dedupe, E3.3's detail-page action row, E6.5's derived
 * "what worked" join (rec → queue add).
 */
export async function queueItemByItemId(
  itemId: ItemId,
): Promise<QueueItem | undefined> {
  return db.queue.where("itemId").equals(itemId).first();
}

/**
 * The whole stack, in insertion order. Deliberately unordered by any product
 * meaning — ranking the stack belongs to the recommender (PLAN §7).
 *
 * Consumers: E6.3 queue-first hand, E3.2's stack segment.
 */
export async function listQueue(): Promise<QueueItem[]> {
  return db.queue.toArray();
}

/**
 * Clear an item off the stack, if it is on it. Internal to the repo layer:
 * the entry transitions in `entries.ts` call this inside their own
 * transaction, so an item is never on the stack and on the nightstand (or in
 * the drawer) at once. Not part of the public verb set — callers use
 * `removeFromQueue`.
 */
export async function clearStackForItem(itemId: ItemId): Promise<void> {
  await db.queue.where("itemId").equals(itemId).delete();
}
