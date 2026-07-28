import { z } from "zod";
import { comparisonIdSchema, isoTimestampSchema, itemIdSchema } from "./ids";
import { genreSchema } from "./genre";

/**
 * One pairwise duel — "which one stays?" (PLAN §4.2). The pool key is the
 * genre ladder, not the medium: cross-genre duels never happen (E4.2), so the
 * app never asks *Meditations* vs *Green Eggs and Ham*. (The §8 sketch's
 * `medium` field predates decision #5; genre supersedes it.) `comparedAt`
 * orders the duels, which sequential Elo updates depend on.
 */
export const comparisonSchema = z
  .object({
    id: comparisonIdSchema,
    genre: genreSchema,
    winnerId: itemIdSchema,
    loserId: itemIdSchema,
    comparedAt: isoTimestampSchema,
  })
  .refine((c) => c.winnerId !== c.loserId, {
    message: "an item cannot duel itself",
  });
export type Comparison = z.infer<typeof comparisonSchema>;
