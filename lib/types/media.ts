import { z } from "zod";

/**
 * The four media Nightstand tracks. Podcasts are tracked at SHOW level, never
 * per-episode (decision #2).
 */
export const mediumSchema = z.enum(["book", "movie", "tv", "podcast"]);
export type Medium = z.infer<typeof mediumSchema>;

/**
 * Book identity across Open Library and Google Books. 80% of the seed corpus
 * carries an ISBN13 (TASTE-BASELINE Finding 5); the rest resolve by
 * title + author, but a canonical item always ends up with at least one
 * external id — unresolved rows queue for manual match instead (E1.4).
 */
export const bookRefSchema = z
  .object({
    medium: z.literal("book"),
    isbn13: z
      .string()
      .regex(/^\d{13}$/)
      .optional(),
    openLibraryId: z.string().min(1).optional(),
    googleBooksId: z.string().min(1).optional(),
  })
  .refine(
    (ref) =>
      ref.isbn13 !== undefined ||
      ref.openLibraryId !== undefined ||
      ref.googleBooksId !== undefined,
    { message: "a book ref needs at least one external id" },
  );
export type BookRef = z.infer<typeof bookRefSchema>;

/**
 * TMDB is the sole movie/TV metadata source (PLAN §8). Movie and TV ids live
 * in separate TMDB namespaces, so the medium literal is part of the identity.
 */
export const movieRefSchema = z.object({
  medium: z.literal("movie"),
  tmdbId: z.number().int().positive(),
});
export type MovieRef = z.infer<typeof movieRefSchema>;

export const tvRefSchema = z.object({
  medium: z.literal("tv"),
  tmdbId: z.number().int().positive(),
});
export type TvRef = z.infer<typeof tvRefSchema>;

/**
 * Podcast show identity across iTunes Search, Podcast Index, and Spotify.
 * The Spotify show id powers the Spotify-first deep link (PLAN §5).
 */
export const podcastRefSchema = z
  .object({
    medium: z.literal("podcast"),
    appleId: z.number().int().positive().optional(),
    spotifyShowId: z.string().min(1).optional(),
    podcastIndexId: z.number().int().positive().optional(),
  })
  .refine(
    (ref) =>
      ref.appleId !== undefined ||
      ref.spotifyShowId !== undefined ||
      ref.podcastIndexId !== undefined,
    { message: "a podcast ref needs at least one external id" },
  );
export type PodcastRef = z.infer<typeof podcastRefSchema>;

/**
 * Provider-neutral identity: the medium plus every external id we hold.
 * Every provider module normalizes into this — nothing downstream of E2 ever
 * touches a raw provider payload.
 */
export const mediaRefSchema = z.discriminatedUnion("medium", [
  bookRefSchema,
  movieRefSchema,
  tvRefSchema,
  podcastRefSchema,
]);
export type MediaRef = z.infer<typeof mediaRefSchema>;
