import { z } from "zod";
import {
  buyAvailabilitySchema,
  itemSeedSchema,
  rentAvailabilitySchema,
  subscriptionAvailabilitySchema,
  theaterAvailabilitySchema,
  type BookItem,
} from "../types";
import type {
  TmdbNowPlayingEntry,
  TmdbResult,
  TmdbWatchProviders,
} from "../providers/tmdb";
import {
  matchesAudibleIdentity,
  type AudibleCatalogResult,
} from "./audible";

const TIMEOUT_MS = 10_000;
const errorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
const availabilitySeedSchema = z.discriminatedUnion("kind", [
  subscriptionAvailabilitySchema.omit({ itemId: true }),
  rentAvailabilitySchema.omit({ itemId: true }),
  buyAvailabilitySchema.omit({ itemId: true }),
  theaterAvailabilitySchema.omit({ itemId: true }),
]);
const watchSchema = z.union([
  errorSchema,
  z.object({
    ok: z.literal(true),
    data: z.object({
      attributionLink: z.string().optional(),
      offers: z.array(z.object({
        availability: availabilitySeedSchema,
        tmdbProviderId: z.number().int(),
        providerName: z.string(),
      })),
    }),
  }),
]);
const nowPlayingSchema = z.union([
  errorSchema,
  z.object({
    ok: z.literal(true),
    data: z.array(z.object({
      seed: itemSeedSchema,
      availability: theaterAvailabilitySchema.omit({ itemId: true }),
    })),
  }),
]);
const audibleResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    product: z.object({
      asin: z.string().min(1),
      title: z.string().min(1),
      authors: z.array(z.object({ name: z.string().min(1) })),
    }).optional(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["catalog-unavailable", "catalog-invalid"]),
    message: z.string(),
  }),
]);

export async function fetchTmdbWatchProviders(
  medium: "movie" | "tv",
  tmdbId: number,
): Promise<TmdbResult<TmdbWatchProviders>> {
  const query = new URLSearchParams({ medium, tmdbId: String(tmdbId) });
  try {
    return await fetchValidated(
      `/api/providers/tmdb/watch-providers?${query}`,
      watchSchema,
    ) as TmdbResult<TmdbWatchProviders>;
  } catch {
    return { ok: false, error: { code: "provider-unreachable", message: "TMDB availability route did not respond." } };
  }
}

export async function fetchTmdbNowPlaying(): Promise<
  TmdbResult<TmdbNowPlayingEntry[]>
> {
  try {
    return await fetchValidated(
      "/api/providers/tmdb/now-playing",
      nowPlayingSchema,
    ) as TmdbResult<TmdbNowPlayingEntry[]>;
  } catch {
    return { ok: false, error: { code: "provider-unreachable", message: "TMDB theater route did not respond." } };
  }
}

export async function fetchAudibleCatalog(
  book: BookItem,
): Promise<AudibleCatalogResult> {
  try {
    const result = await fetchValidated("/api/providers/audible/catalog", audibleResultSchema, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: book.title, creators: book.creators }),
    });
    return result.ok && result.product !== undefined &&
      !matchesAudibleIdentity(book, result.product)
      ? { ok: true }
      : result;
  } catch {
    return { ok: false, code: "catalog-unavailable", message: "Audible catalog route did not respond." };
  }
}

async function fetchValidated<S extends z.ZodType>(
  url: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.output<S>> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(url, { ...init, signal });
  const body: unknown = await response.json();
  return schema.parse(body);
}
