import {
  cacheControlForEnvelope,
  httpStatusForEnvelope,
  searchPodcastShows,
  spotifyConfigFromEnv,
} from "../../../../../lib/providers/podcasts";

/**
 * GET /api/providers/podcasts/search?q=…
 *
 * Stateless podcast SHOW search (E2.3, decision #2: never episodes). iTunes
 * Search is the keyless primary; Spotify show-id enrichment happens when
 * SPOTIFY_CLIENT_ID/SECRET are set — the credentials live server-side only
 * and never appear in a response.
 */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const envelope = await searchPodcastShows(query, {
    spotify: spotifyConfigFromEnv(),
  });
  return Response.json(envelope, {
    status: httpStatusForEnvelope(envelope),
    headers: { "Cache-Control": cacheControlForEnvelope(envelope) },
  });
}
