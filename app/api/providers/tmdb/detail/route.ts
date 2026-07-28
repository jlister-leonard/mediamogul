import {
  getTmdbDetail,
  TMDB_CACHE_TTL_MS,
  tmdbMediumSchema,
} from "../../../../../lib/providers/tmdb";
import { invalidRequest, tmdbResponse } from "../envelope";

export const dynamic = "force-dynamic";

/** `GET /api/providers/tmdb/detail?medium=movie|tv&tmdbId=…` → `TmdbDetail`. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const medium = tmdbMediumSchema.safeParse(params.get("medium"));
  if (!medium.success) {
    return invalidRequest("medium must be movie or tv.");
  }
  const result = await getTmdbDetail(
    medium.data,
    Number(params.get("tmdbId")),
  );
  return tmdbResponse(result, TMDB_CACHE_TTL_MS.detail);
}
