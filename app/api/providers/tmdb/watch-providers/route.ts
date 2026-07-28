import {
  getTmdbWatchProviders,
  TMDB_CACHE_TTL_MS,
  tmdbMediumSchema,
} from "../../../../../lib/providers/tmdb";
import { invalidRequest, tmdbResponse } from "../envelope";

export const dynamic = "force-dynamic";

/**
 * `GET /api/providers/tmdb/watch-providers?medium=movie|tv&tmdbId=…` →
 * `TmdbWatchProviders` (US offers; deep links filled by E5.2's registry).
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const medium = tmdbMediumSchema.safeParse(params.get("medium"));
  if (!medium.success) {
    return invalidRequest("medium must be movie or tv.");
  }
  const result = await getTmdbWatchProviders(
    medium.data,
    Number(params.get("tmdbId")),
  );
  // Halved SWR window: availability carries a ~24h staleness budget (E5.1),
  // so the CDN gets less headroom to serve stale offers than metadata gets.
  return tmdbResponse(
    result,
    TMDB_CACHE_TTL_MS.watchProviders,
    TMDB_CACHE_TTL_MS.watchProviders / 2,
  );
}
