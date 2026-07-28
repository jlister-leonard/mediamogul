import type { TmdbErrorCode, TmdbResult } from "../../../../lib/providers/tmdb";

/**
 * Shared HTTP mapping for the TMDB routes (colocated, non-routable). The
 * body is always the full `TmdbResult` envelope, so clients switch on
 * `ok`/`error.code` rather than sniffing statuses.
 */

const HTTP_STATUS: Record<TmdbErrorCode, number> = {
  "invalid-request": 400,
  "not-found": 404,
  "provider-error": 502,
  "upstream-invalid": 502,
  "provider-unconfigured": 503,
  "provider-unreachable": 503,
};

export function tmdbResponse<T>(
  result: TmdbResult<T>,
  cacheTtlMs: number,
  staleWhileRevalidateMs: number = cacheTtlMs,
): Response {
  if (!result.ok) {
    return Response.json(result, {
      status: HTTP_STATUS[result.error.code],
      headers: { "cache-control": "no-store" },
    });
  }
  // Mirror the lib's LRU TTL at the CDN as s-maxage; the SWR window bounds
  // how much longer a stale copy may serve while revalidating (endpoints
  // with a declared staleness budget pass a tighter window).
  const seconds = Math.floor(cacheTtlMs / 1000);
  const swrSeconds = Math.floor(staleWhileRevalidateMs / 1000);
  return Response.json(result, {
    headers: {
      "cache-control": `public, s-maxage=${String(seconds)}, stale-while-revalidate=${String(swrSeconds)}`,
    },
  });
}

export function invalidRequest(message: string): Response {
  return tmdbResponse(
    { ok: false, error: { code: "invalid-request", message } },
    0,
  );
}
