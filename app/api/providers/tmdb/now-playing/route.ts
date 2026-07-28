import { getTmdbNowPlaying, TMDB_CACHE_TTL_MS } from "../../../../../lib/providers/tmdb";
import { tmdbResponse } from "../envelope";

// Never prerendered: without this, the build would bake an unconfigured-key
// error into a static response.
export const dynamic = "force-dynamic";

/**
 * `GET /api/providers/tmdb/now-playing` → `TmdbNowPlayingEntry[]` (US
 * theatrical slate; Fandango deep links filled by E5.4).
 */
export async function GET(): Promise<Response> {
  return tmdbResponse(await getTmdbNowPlaying(), TMDB_CACHE_TTL_MS.nowPlaying);
}
