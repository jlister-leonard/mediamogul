"use client";

// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import { useLiveQuery } from "dexie-react-hooks";
import type {
  Availability,
  Entry,
  EntryStatus,
  Genre,
  Item,
  ItemId,
  Medium,
  QueueItem,
} from "../../types";
import { availabilityByItemId } from "./availability";
import { entriesByItemId, entriesByStatus, openEntryByItemId } from "./entries";
import { getItem, itemsByGenre, itemsByMedium, listItems } from "./items";
import { listQueue, queueItemByItemId } from "./queue";

/**
 * Reactive reads (E1.2). Every hook is a thin `useLiveQuery` wrapper over the
 * repo function of the same shape — the query logic lives in one place, and
 * the components get a value that re-renders the moment a write lands,
 * whichever surface made it. That is what lets E3.1 write optimistically from
 * a sheet while E3.2's grid behind it updates itself.
 *
 * `undefined` means "the first query has not resolved yet" — one tick on a
 * local database. The single-row hooks resolve to `null` for a row that is
 * genuinely absent, so the two states never collide: a component shows its
 * skeleton on `undefined` and its "no such item" copy on `null`, and E3.3 can
 * never spin forever on a deleted id. List hooks say the same thing with
 * `undefined` vs `[]`.
 *
 * Client-only by construction (`useLiveQuery` subscribes to IndexedDB), hence
 * the directive; the repo functions themselves stay environment-agnostic and
 * are not re-exported from `./index` alongside these.
 */

/** One title, live. Consumer: E3.3 detail page. */
export function useItem(id: ItemId): Item | null | undefined {
  return useLiveQuery(async () => (await getItem(id)) ?? null, [id]);
}

/**
 * The whole library, live. Consumers: E3.4 local search, E6.2 taste context
 * (a rating landing changes the briefing).
 */
export function useItems(): Item[] | undefined {
  return useLiveQuery(() => listItems(), []);
}

/** A medium's shelf, live. Consumer: E3.2 library filter by medium. */
export function useItemsByMedium(medium: Medium): Item[] | undefined {
  return useLiveQuery(() => itemsByMedium(medium), [medium]);
}

/** One ladder's pool, live. Consumers: E3.2 genre filter, E4.5 ladder screen. */
export function useItemsByGenre(genre: Genre): Item[] | undefined {
  return useLiveQuery(() => itemsByGenre(genre), [genre]);
}

/**
 * One segment of the library, live. Consumer: E3.2 — On the nightstand
 * (`in-progress`), The drawer (`finished`, `abandoned`).
 */
export function useEntriesByStatus(status: EntryStatus): Entry[] | undefined {
  return useLiveQuery(() => entriesByStatus(status), [status]);
}

/** Every log for one item, live. Consumer: E3.3's "your data" block. */
export function useEntriesByItemId(itemId: ItemId): Entry[] | undefined {
  return useLiveQuery(() => entriesByItemId(itemId), [itemId]);
}

/**
 * The open entry for an item, live — which verb the action row offers.
 * Consumers: E3.3 detail page, E3.1 log flow.
 */
export function useOpenEntry(itemId: ItemId): Entry | null | undefined {
  return useLiveQuery(
    async () => (await openEntryByItemId(itemId)) ?? null,
    [itemId],
  );
}

/**
 * One item's offers, live. Consumers: E3.3's Get-it row slot, E5.5 Get-it
 * row (a 24h refresh landing repaints the row without a reload).
 */
export function useAvailabilityByItemId(
  itemId: ItemId,
): Availability[] | undefined {
  return useLiveQuery(() => availabilityByItemId(itemId), [itemId]);
}

/** The whole stack, live. Consumers: E3.2's stack segment, E6.3 queue-first hand. */
export function useQueue(): QueueItem[] | undefined {
  return useLiveQuery(() => listQueue(), []);
}

/**
 * Whether one item is on the stack, live. Consumers: E3.1 dedupe ("already on
 * the stack"), E3.3 detail-page action row.
 */
export function useQueueItem(itemId: ItemId): QueueItem | null | undefined {
  return useLiveQuery(
    async () => (await queueItemByItemId(itemId)) ?? null,
    [itemId],
  );
}
