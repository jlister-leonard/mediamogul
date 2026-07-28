import {
  cacheControlForEnvelope,
  httpStatusForEnvelope,
  lookupPodcastShow,
  spotifyConfigFromEnv,
} from "../../../../../../lib/providers/podcasts";

/**
 * GET /api/providers/podcasts/show/[appleId]
 *
 * Stateless show detail by Apple id (E2.3) — the detail half of the provider.
 * Same normalization, Spotify enrichment, and caching posture as search.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ appleId: string }> },
): Promise<Response> {
  const { appleId } = await context.params;
  // Bounded digits: keeps the value a safe integer before Number() sees it.
  const parsed = /^\d{1,12}$/.test(appleId) ? Number(appleId) : Number.NaN;
  const envelope = await lookupPodcastShow(parsed, {
    spotify: spotifyConfigFromEnv(),
  });
  return Response.json(envelope, {
    status: httpStatusForEnvelope(envelope),
    headers: { "Cache-Control": cacheControlForEnvelope(envelope) },
  });
}
