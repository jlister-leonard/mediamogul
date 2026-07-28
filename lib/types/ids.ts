import { z } from "zod";

/**
 * Every persisted entity id is a branded string — UUID by convention, minted
 * on-device at creation (the phone is the source of truth, PLAN §8). Brands
 * make it a type error to hand an `EntryId` where an `ItemId` is expected,
 * which matters in a store where every relation is a bare id reference.
 */
export const itemIdSchema = z.string().min(1).brand<"ItemId">();
export type ItemId = z.infer<typeof itemIdSchema>;

export const entryIdSchema = z.string().min(1).brand<"EntryId">();
export type EntryId = z.infer<typeof entryIdSchema>;

export const comparisonIdSchema = z.string().min(1).brand<"ComparisonId">();
export type ComparisonId = z.infer<typeof comparisonIdSchema>;

export const queueItemIdSchema = z.string().min(1).brand<"QueueItemId">();
export type QueueItemId = z.infer<typeof queueItemIdSchema>;

export const situationIdSchema = z.string().min(1).brand<"SituationId">();
export type SituationId = z.infer<typeof situationIdSchema>;

export const recIdSchema = z.string().min(1).brand<"RecId">();
export type RecId = z.infer<typeof recIdSchema>;

/**
 * Key into the service registry (E5.2) — "netflix", "kindle", "fandango"…
 * An open set by design: adding a service is one registry entry, not a
 * contract change (PLAN §5).
 */
export const providerIdSchema = z.string().min(1).brand<"ProviderId">();
export type ProviderId = z.infer<typeof providerIdSchema>;

/**
 * All timestamps at rest are ISO-8601 UTC strings in exactly the
 * `Date.prototype.toISOString()` form — millisecond precision, `Z` suffix,
 * no offsets. The schema enforces that form, which is what makes timestamps
 * lexicographically sortable: duel replay (E4.2) and IndexedDB indexes order
 * by string comparison, and mixed precision would break it.
 */
export const isoTimestampSchema = z.iso.datetime({ precision: 3 });
export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;
