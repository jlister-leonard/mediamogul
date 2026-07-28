import { z } from "zod";
import { entryIdSchema, isoTimestampSchema, itemIdSchema } from "./ids";

/**
 * The one-tap verdict (PLAN §4.2). Deliberately not stars: 71% of the seed
 * ratings were a 4 or a 5 — the gradient captures the reaction fast, and the
 * ladder recovers the order stars never could.
 */
export const gradientSchema = z.enum(["loved", "liked", "fine", "no"]);
export type Gradient = z.infer<typeof gradientSchema>;

/**
 * Why the gradient says what it says (TASTE-BASELINE Finding 3): 'comfort'
 * marks loved-since-childhood titles, which rank on their own ladder and are
 * excluded from recommendation signal unless a situation asks for comfort.
 * Inferred by default, always correctable (E4.4).
 */
export const ratingModeSchema = z.enum(["admired", "enjoyed", "comfort"]);
export type RatingMode = z.infer<typeof ratingModeSchema>;

/**
 * "On the nightstand" / "The drawer" / abandoned (PLAN §12, E3.1). The
 * to-read shelf is not an entry — it lives in the queue.
 */
export const entryStatusSchema = z.enum([
  "in-progress",
  "finished",
  "abandoned",
]);
export type EntryStatus = z.infer<typeof entryStatusSchema>;

/**
 * My log for one item. Dates are optional even when finished: only 43% of the
 * seed corpus has a Date Read, so no feature may depend on them
 * (TASTE-BASELINE Finding 5).
 */
export const entrySchema = z.object({
  id: entryIdSchema,
  itemId: itemIdSchema,
  status: entryStatusSchema,
  startedAt: isoTimestampSchema.optional(),
  finishedAt: isoTimestampSchema.optional(),
  /** Absent = unrated. */
  gradient: gradientSchema.optional(),
  mode: ratingModeSchema.optional(),
  /**
   * Elo-style standing on this item's genre ladder, derived from
   * comparisons (E4.2); absent until the item has fought a duel. Only
   * comparable within one genre pool.
   */
  score: z.number().optional(),
  /**
   * Taste tags — the one-tap "because" chips (pacing / ending / density /
   * voice / world / performances…). The curated set is contextual per medium
   * (E4.4), so the contract keeps them open strings.
   */
  tags: z.array(z.string().min(1)),
  /** Free text is optional and rare by evidence — 1 review in 225 books (Finding 5). */
  note: z.string().min(1).optional(),
});
export type Entry = z.infer<typeof entrySchema>;
