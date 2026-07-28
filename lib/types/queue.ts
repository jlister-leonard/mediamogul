import { z } from "zod";
import { isoTimestampSchema, itemIdSchema, queueItemIdSchema } from "./ids";

/**
 * One item on the stack — the shortlist (PLAN §12). `contextTags` replace
 * Goodreads' DATE ADDED as the thing worth knowing: why it's there ("flight",
 * "with M"), not when (PLAN §2). `addedAt` is provenance only — never the
 * primary order; ordering the stack is the recommender's job (PLAN §7).
 */
export const queueItemSchema = z.object({
  id: queueItemIdSchema,
  itemId: itemIdSchema,
  contextTags: z.array(z.string().min(1)),
  /** Free-text origin, e.g. "recommended off Bad Blood". */
  addedReason: z.string().min(1).optional(),
  addedAt: isoTimestampSchema,
});
export type QueueItem = z.infer<typeof queueItemSchema>;
