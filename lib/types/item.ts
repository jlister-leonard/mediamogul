import { z } from "zod";
import { itemIdSchema } from "./ids";
import { genreAssignmentSchema } from "./genre";
import {
  bookRefSchema,
  movieRefSchema,
  podcastRefSchema,
  tvRefSchema,
} from "./media";

/**
 * The community's verdict, kept secondary to yours (PLAN §2, E3.3).
 * `average` is on the source's native scale; `histogram` is the 1★→5★
 * distribution counts where the source exposes one — the signal behind the
 * one-line verdict "this one splits people": a flat 3.98 and a bimodal 3.98
 * are completely different books.
 */
export const communityRatingSchema = z.object({
  average: z.number(),
  count: z.number().int().nonnegative(),
  histogram: z
    .tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ])
    .optional(),
});
export type CommunityRating = z.infer<typeof communityRatingSchema>;

const itemBaseSchema = z.object({
  id: itemIdSchema,
  title: z.string().min(1),
  /** Demoted by design (PLAN §2): small, grey, one line — or hidden. */
  subtitle: z.string().min(1).optional(),
  /** Authors / directors / hosts — needed for title+creator resolution (E2.4) and the detail page. */
  creators: z.array(z.string().min(1)),
  /** First publication/release year; an input to rating-mode inference (TASTE-BASELINE Finding 3). */
  year: z.number().int().optional(),
  /** Cover / poster / show art — the hero of every surface (PLAN §3). */
  artUrl: z.url().optional(),
  /** Provider blurb for the detail page — below your data, never above it (E3.3). */
  description: z.string().min(1).optional(),
  communityRating: communityRatingSchema.optional(),
  /** The ladder this item fights on; absent until assigned (E4.1). */
  genre: genreAssignmentSchema.optional(),
});

/**
 * A canonical title. `medium` mirrors `ref.medium` at the top level so the
 * union discriminates directly and IndexedDB can index it; the matching ref
 * schema per variant makes disagreement unrepresentable.
 */
export const bookItemSchema = itemBaseSchema.extend({
  medium: z.literal("book"),
  ref: bookRefSchema,
  /** Length constraint for situations — "reject 3 long books → nothing >400 pages" (E6.6). */
  pages: z.number().int().positive().optional(),
});
export type BookItem = z.infer<typeof bookItemSchema>;

export const movieItemSchema = itemBaseSchema.extend({
  medium: z.literal("movie"),
  ref: movieRefSchema,
  /** Time constraint for situations — "45 minutes, on something I already pay for" (PLAN §5). */
  runtimeMinutes: z.number().int().positive().optional(),
});
export type MovieItem = z.infer<typeof movieItemSchema>;

export const tvItemSchema = itemBaseSchema.extend({
  medium: z.literal("tv"),
  ref: tvRefSchema,
  /** Typical episode runtime — the unit that fits a situation's time budget. */
  runtimeMinutes: z.number().int().positive().optional(),
});
export type TvItem = z.infer<typeof tvItemSchema>;

/** Show-level only (decision #2) — a show has no single length, so none is stored. */
export const podcastItemSchema = itemBaseSchema.extend({
  medium: z.literal("podcast"),
  ref: podcastRefSchema,
});
export type PodcastItem = z.infer<typeof podcastItemSchema>;

export const itemSchema = z.discriminatedUnion("medium", [
  bookItemSchema,
  movieItemSchema,
  tvItemSchema,
  podcastItemSchema,
]);
export type Item = z.infer<typeof itemSchema>;

const seedFields = { id: true, genre: true } as const;

/**
 * A provider-normalized search result that is not in the library yet: an
 * `Item` minus `id` and `genre`. E2.1–2.3 normalize into this single shape
 * and E2.4 dedupes over it; on add, the app mints the `ItemId` and E4.1
 * assigns the genre.
 */
export const itemSeedSchema = z.discriminatedUnion("medium", [
  bookItemSchema.omit(seedFields),
  movieItemSchema.omit(seedFields),
  tvItemSchema.omit(seedFields),
  podcastItemSchema.omit(seedFields),
]);
export type ItemSeed = z.infer<typeof itemSeedSchema>;
