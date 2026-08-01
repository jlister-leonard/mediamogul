// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import {
  availabilitySchema,
  availabilityRefreshSchema,
  isoTimestampSchema,
  itemIdSchema,
  type Availability,
  type AvailabilityRefresh,
  type IsoTimestamp,
  type ItemId,
} from "../../types";
import { db } from "../index";
import { validate } from "./errors";

/**
 * `availability` — how you can get a title tonight (E1.2 repo layer).
 *
 * The one table with no id in its records: `lib/db/schema.ts` keys it on a
 * hidden outbound auto-increment so stored rows stay byte-identical to the
 * contract. That shapes the write verb — see `refreshAvailabilityForItem`.
 */

/**
 * Replace everything known about one item's offers, atomically.
 *
 * Delete-then-add, deliberately: with an outbound key, `put` without an
 * explicit key inserts a *new* row rather than replacing one, so an
 * update-shaped refresh would silently pile duplicate offers up on every
 * 24-hour re-fetch. Deleting the item's rows first is the only refresh that
 * converges, and the transaction means a failed re-add can never leave the
 * Get-it row empty when it used to be full.
 *
 * An empty `offers` array is a legitimate refresh — it records "nothing is
 * available right now" (E5.5's honest empty state), not a no-op.
 *
 * One row per (kind, providerId): a TMDB payload can list the same service
 * twice (the storefront fold E2.2's review flagged), and two identical rows
 * would render as two identical buttons in E5.5's Get-it row. The first
 * occurrence wins, so the caller's ordering decides which price survives.
 *
 * Consumers: E5.1 availability (24h cache refresh), E5.4 theaters.
 */
export async function refreshAvailabilityForItem(
  itemId: ItemId,
  offers: readonly Availability[],
): Promise<void> {
  // Validated even when there are no offers: a purge is a write too, and it
  // must not run against a malformed id.
  const target = validate(
    itemIdSchema,
    itemId,
    "availability",
    "refreshAvailabilityForItem",
  );
  // The offers must be about the item whose rows we are about to delete;
  // otherwise a caller could wipe one item's offers and store another's.
  const offerForItem = availabilitySchema.refine((o) => o.itemId === target, {
    message: `every offer must carry itemId ${target}`,
  });
  const deduped = new Map<string, Availability>();
  for (const offer of offers) {
    const validated = validate(
      offerForItem,
      offer,
      "availability",
      "refreshAvailabilityForItem",
    );
    const key = `${validated.kind}|${"providerId" in validated ? validated.providerId : ""}`;
    if (!deduped.has(key)) deduped.set(key, validated);
  }
  const rows = [...deduped.values()];

  await db.transaction("rw", db.availability, async () => {
    await db.availability.where("itemId").equals(target).delete();
    if (rows.length > 0) await db.availability.bulkAdd(rows);
  });
}

/** The last successful complete check, including a check with zero offers. */
export async function availabilityRefreshByItemId(
  itemId: ItemId,
): Promise<AvailabilityRefresh | undefined> {
  const target = validate(
    itemIdSchema,
    itemId,
    "availabilityRefreshes",
    "availabilityRefreshByItemId",
  );
  return db.availabilityRefreshes.get(target);
}

export interface AvailabilityState {
  offers: Availability[];
  refresh?: AvailabilityRefresh;
}

/** Read rows and marker from one IndexedDB snapshot, validating stored data. */
export async function readAvailabilityState(
  itemId: ItemId,
): Promise<AvailabilityState> {
  const target = validate(
    itemIdSchema,
    itemId,
    "availability",
    "readAvailabilityState",
  );
  return db.transaction(
    "r",
    [db.availability, db.availabilityRefreshes],
    async () => {
      const [rawOffers, rawRefresh] = await Promise.all([
        db.availability.where("itemId").equals(target).toArray(),
        db.availabilityRefreshes.get(target),
      ]);
      const offerForItem = availabilitySchema.refine(
        (offer) => offer.itemId === target,
        { message: `every stored offer must carry itemId ${target}` },
      );
      const offers = rawOffers.map((offer) =>
        validate(
          offerForItem,
          offer,
          "availability",
          "readAvailabilityState",
        ),
      );
      const refresh =
        rawRefresh === undefined
          ? undefined
          : validate(
              availabilityRefreshSchema.refine(
                (marker) => marker.itemId === target,
                { message: `stored marker must carry itemId ${target}` },
              ),
              rawRefresh,
              "availabilityRefreshes",
              "readAvailabilityState",
            );
      return { offers, ...(refresh !== undefined && { refresh }) };
    },
  );
}

/**
 * Replace offers and their successful-refresh marker atomically. The marker
 * is what makes an empty result a durable 24-hour cache entry.
 */
export async function refreshAvailabilityState(
  itemId: ItemId,
  offers: readonly Availability[],
  fetchedAt: IsoTimestamp,
): Promise<boolean> {
  const target = validate(
    itemIdSchema,
    itemId,
    "availability",
    "refreshAvailabilityState",
  );
  const marker = validate(
    availabilityRefreshSchema,
    { itemId: target, fetchedAt },
    "availabilityRefreshes",
    "refreshAvailabilityState",
  );
  const offerForItem = availabilitySchema.refine((offer) => offer.itemId === target, {
    message: `every offer must carry itemId ${target}`,
  });
  const deduped = new Map<string, Availability>();
  for (const offer of offers) {
    const validated = validate(
      offerForItem,
      offer,
      "availability",
      "refreshAvailabilityState",
    );
    const key = `${validated.kind}|${"providerId" in validated ? validated.providerId : ""}`;
    if (!deduped.has(key)) deduped.set(key, validated);
  }

  return db.transaction(
    "rw",
    [db.availability, db.availabilityRefreshes],
    async () => {
      const current = await db.availabilityRefreshes.get(target);
      if (current !== undefined && current.fetchedAt >= marker.fetchedAt) {
        return false;
      }
      await db.availability.where("itemId").equals(target).delete();
      const rows = [...deduped.values()];
      if (rows.length > 0) await db.availability.bulkAdd(rows);
      await db.availabilityRefreshes.put(marker);
      return true;
    },
  );
}

/**
 * Every known offer for one item, via the `itemId` index.
 *
 * Consumers: E5.5 Get-it row, E3.3 detail page, E6.3's "on something I
 * already pay for" constraint.
 */
export async function availabilityByItemId(
  itemId: ItemId,
): Promise<Availability[]> {
  return db.availability.where("itemId").equals(itemId).toArray();
}

/**
 * Offers fetched before a cutoff — the 24h staleness sweep, as a range query
 * on the `fetchedAt` index instead of a full scan. The cutoff is validated
 * against the timestamp contract because the range only orders correctly for
 * millisecond-precision ISO strings.
 *
 * Consumers: E5.1 (find what needs re-fetching; the refresh itself goes
 * through `refreshAvailabilityForItem`), E5.5's visible-staleness marker.
 */
export async function availabilityStaleBefore(
  cutoff: IsoTimestamp,
): Promise<Availability[]> {
  const bound = validate(
    isoTimestampSchema,
    cutoff,
    "availability",
    "availabilityStaleBefore",
  );
  return db.availability.where("fetchedAt").below(bound).toArray();
}
