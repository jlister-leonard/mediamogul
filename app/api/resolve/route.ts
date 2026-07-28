import { resolve, type ResolveResult } from "../../../lib/resolve";
import { mediumSchema, type Medium } from "../../../lib/types";

/**
 * E2.4 — `GET /api/resolve?q=&media=`. One query, every provider, grouped and
 * deduped: the endpoint E2.5's omnibox calls. All logic lives in
 * `lib/resolve`; this handler parses params, picks a status, and sets cache
 * headers. Every response is the typed `ResolveResult` envelope, never an
 * HTML error page.
 *
 * `media` is an optional comma-separated subset of `book,movie,tv,podcast`.
 */

/**
 * The shortest-lived lane governs the whole answer: TMDB search results turn
 * over hourly (`TMDB_CACHE_TTL_MS.search`), so the CDN holds a resolve
 * response for an hour and may serve it stale for a day while revalidating.
 */
const SUCCESS_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/**
 * A degraded answer is missing a provider's results. Caching it publicly
 * would replay one provider's outage to every user for an hour, so it gets a
 * short private lifetime instead — recovery shows up within a minute.
 */
const DEGRADED_CACHE_CONTROL = "private, max-age=60";

function json(result: ResolveResult, status: number): Response {
  const cacheControl = !result.ok
    ? "no-store"
    : result.degraded.length > 0
      ? DEGRADED_CACHE_CONTROL
      : SUCCESS_CACHE_CONTROL;
  return Response.json(result, {
    status,
    headers: { "cache-control": cacheControl },
  });
}

function badRequest(message: string): Response {
  return json({ ok: false, error: { code: "bad-request", message } }, 400);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const rawMedia = params.get("media");

    let media: Medium[] | undefined;
    if (rawMedia !== null) {
      media = [];
      for (const part of rawMedia.split(",")) {
        const parsed = mediumSchema.safeParse(part.trim());
        if (!parsed.success) {
          return badRequest(
            "media must be a comma-separated subset of: book, movie, tv, podcast",
          );
        }
        media.push(parsed.data);
      }
    }

    const result = await resolve(
      params.get("q") ?? "",
      media === undefined ? {} : { media },
    );
    if (result.ok) return json(result, 200);
    return json(result, result.error.code === "bad-request" ? 400 : 502);
  } catch (error) {
    // Unreachable by design (resolve never throws — every lane catches) but a
    // framework 500 page would break the typed contract if it ever were.
    return json(
      {
        ok: false,
        error: {
          code: "all-providers-failed",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      502,
    );
  }
}
