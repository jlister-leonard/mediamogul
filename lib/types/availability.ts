import { z } from "zod";
import { isoTimestampSchema, itemIdSchema, providerIdSchema } from "./ids";

/**
 * How you can get a title tonight. 'borrow' is deliberately absent —
 * Libby/OverDrive was dropped (decision #11); 'theater' is a first-class
 * state, not an afterthought (decision #14).
 */
export const availabilityKindSchema = z.enum([
  "subscription",
  "rent",
  "buy",
  "theater",
]);
export type AvailabilityKind = z.infer<typeof availabilityKindSchema>;

const availabilityBaseSchema = z.object({
  itemId: itemIdSchema,
  /** All lookups are region US (decision #8). */
  region: z.literal("US"),
  /** Availability is cached ~24h with visible staleness (E5.1), so the fetch time is part of the record. */
  fetchedAt: isoTimestampSchema,
});

/**
 * Included with a subscription — the "on something I already pay for" state
 * the recommender treats as a constraint (PLAN §5). `url` is the resolved
 * deep link straight to the title inside the provider's app; when absent, it
 * is built from the registry's deep-link template (E5.2).
 */
export const subscriptionAvailabilitySchema = availabilityBaseSchema.extend({
  kind: z.literal("subscription"),
  providerId: providerIdSchema,
  url: z.url().optional(),
});
export type SubscriptionAvailability = z.infer<
  typeof subscriptionAvailabilitySchema
>;

export const rentAvailabilitySchema = availabilityBaseSchema.extend({
  kind: z.literal("rent"),
  providerId: providerIdSchema,
  /** "rent $3.99" (PLAN §5) — absent when the source doesn't report a price. */
  priceUsd: z.number().positive().optional(),
  url: z.url().optional(),
});
export type RentAvailability = z.infer<typeof rentAvailabilitySchema>;

/** Buying covers Kindle, Audible, Bookshop.org, and digital purchase on video services (PLAN §5). */
export const buyAvailabilitySchema = availabilityBaseSchema.extend({
  kind: z.literal("buy"),
  providerId: providerIdSchema,
  priceUsd: z.number().positive().optional(),
  url: z.url().optional(),
});
export type BuyAvailability = z.infer<typeof buyAvailabilitySchema>;

/**
 * Currently in theaters, from TMDB `now_playing` (decision #14). No
 * providerId: the provider is implicitly Fandango. `fandangoUrl` deep-links
 * to this title's showtimes page; absent until the theaters resolver fills it
 * (E5.4).
 */
export const theaterAvailabilitySchema = availabilityBaseSchema.extend({
  kind: z.literal("theater"),
  fandangoUrl: z.url().optional(),
});
export type TheaterAvailability = z.infer<typeof theaterAvailabilitySchema>;

/** One record per (item, offer) — the §8 sketch's per-item, per-provider row. */
export const availabilitySchema = z.discriminatedUnion("kind", [
  subscriptionAvailabilitySchema,
  rentAvailabilitySchema,
  buyAvailabilitySchema,
  theaterAvailabilitySchema,
]);
export type Availability = z.infer<typeof availabilitySchema>;
