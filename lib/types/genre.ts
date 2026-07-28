import { z } from "zod";

/**
 * Genres ARE the ladders (PLAN §4.2): every pairwise duel happens inside one
 * genre pool, never across — ladders are per-genre, not per-medium. The slugs
 * are the eight book ladders plus the four film seed ladders derived from the
 * real corpus (TASTE-BASELINE §Proposed genre ladders, Finding 7). Genre is
 * auto-assigned from metadata, never a taxonomy the user maintains
 * (Finding 5).
 */
export const genreSchema = z.enum([
  "business-strategy",
  "money-markets",
  "lives",
  "mind-mastery",
  "grit-wilderness",
  "literary-fiction",
  "genre-fiction",
  "comfort-childhood",
  "crime-tension",
  "ambition-institutions",
  "auteur-prestige",
  "comfort-rewatch",
]);
export type Genre = z.infer<typeof genreSchema>;

/**
 * The comfort pools — ranked on their own ladders and excluded from
 * recommendation signal unless a situation explicitly asks for comfort
 * (PLAN §4.2, TASTE-BASELINE Findings 3 and 7). Comfort titles stay fully
 * visible in the Library (PLAN §11).
 */
export const COMFORT_GENRES = [
  "comfort-childhood",
  "comfort-rewatch",
] as const satisfies readonly Genre[];

/**
 * A 'manual' assignment is a user override: it persists and is never
 * clobbered by re-import or re-derivation (E4.1).
 */
export const genreAssignmentSchema = z.object({
  genre: genreSchema,
  source: z.enum(["auto", "manual"]),
});
export type GenreAssignment = z.infer<typeof genreAssignmentSchema>;
