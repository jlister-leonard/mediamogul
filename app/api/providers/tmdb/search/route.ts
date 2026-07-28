import {
  searchTmdb,
  TMDB_CACHE_TTL_MS,
  tmdbSearchScopeSchema,
} from "../../../../../lib/providers/tmdb";
import { invalidRequest, tmdbResponse } from "../envelope";

// Never prerendered: results depend on the query and the server-side key.
export const dynamic = "force-dynamic";

/** `GET /api/providers/tmdb/search?q=…&scope=movie|tv|all` → `ItemSeed[]`. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const scope = tmdbSearchScopeSchema.safeParse(params.get("scope") ?? "all");
  if (!scope.success) {
    return invalidRequest("scope must be movie, tv, or all.");
  }
  const result = await searchTmdb(params.get("q") ?? "", scope.data);
  return tmdbResponse(result, TMDB_CACHE_TTL_MS.search);
}
