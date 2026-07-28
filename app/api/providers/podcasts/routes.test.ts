import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  itunesLookupEmpty,
  itunesLookupOneShow,
  itunesMalformedResponse,
  itunesSearchTwoShows,
  spotifySearchMatch,
  spotifyTokenResponse,
} from "../../../../lib/providers/podcasts.fixtures";
import { resetPodcastProviderCaches } from "../../../../lib/providers/podcasts";
import { GET as searchGET } from "./search/route";
import { GET as showGET } from "./show/[appleId]/route";

/** Routes global fetch (what the handlers use) to fixture responses. */
function stubUpstream(
  respond: (url: URL) => Response | undefined = () => undefined,
) {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL): Promise<Response> => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const response = respond(new URL(href));
      if (response === undefined) {
        throw new TypeError(`fetch failed: no route for ${href}`);
      }
      return response;
    },
  );
}

function searchRequest(q?: string): Request {
  const url = new URL("http://localhost:3000/api/providers/podcasts/search");
  if (q !== undefined) url.searchParams.set("q", q);
  return new Request(url);
}

function showParams(appleId: string): { params: Promise<{ appleId: string }> } {
  return { params: Promise.resolve({ appleId }) };
}

const showRequest = new Request(
  "http://localhost:3000/api/providers/podcasts/show/394775318",
);

beforeEach(() => {
  resetPodcastProviderCaches();
  // Unconfigured Spotify is the baseline; individual tests opt in.
  vi.stubEnv("SPOTIFY_CLIENT_ID", "");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/providers/podcasts/search", () => {
  it("returns 200 with seeds, the spotify-unconfigured marker, and CDN cache headers", async () => {
    stubUpstream((url) =>
      url.hostname === "itunes.apple.com"
        ? Response.json(itunesSearchTwoShows)
        : undefined,
    );
    const response = await searchGET(searchRequest("99% invisible"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.spotify).toBe("spotify-unconfigured");
    expect(body.seeds).toHaveLength(2);
    expect(body.seeds[0].ref.appleId).toBe(394775318);
    expect(body.seeds[0].ref.spotifyShowId).toBeUndefined();
  });

  it("enriches with spotifyShowId when credentials are configured — and never leaks them", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "route-client-id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "route-client-secret");
    stubUpstream((url) => {
      if (url.hostname === "itunes.apple.com") {
        return Response.json(itunesLookupOneShow); // one show, matched fixture
      }
      if (url.hostname === "accounts.spotify.com") {
        return Response.json(spotifyTokenResponse);
      }
      if (url.hostname === "api.spotify.com") {
        return Response.json(spotifySearchMatch);
      }
      return undefined;
    });
    const response = await searchGET(searchRequest("99% invisible"));
    const text = await response.text();
    expect(response.status).toBe(200);
    const body = JSON.parse(text);
    expect(body.spotify).toBe("spotify-resolved");
    expect(body.seeds[0].ref.spotifyShowId).toBe("2vjzeqQaEPCn7UBM8mNa1a");
    // Keys stay server-side only (EPICS E2.1–2.3 AC).
    expect(text).not.toContain("route-client-id");
    expect(text).not.toContain("route-client-secret");
  });

  it("returns 400 no-store for a missing query", async () => {
    stubUpstream();
    const response = await searchGET(searchRequest());
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "bad-request", message: expect.any(String) },
    });
  });

  it("returns 502 for malformed upstream and 503 for unreachable upstream", async () => {
    stubUpstream((url) =>
      url.hostname === "itunes.apple.com"
        ? Response.json(itunesMalformedResponse)
        : undefined,
    );
    const malformed = await searchGET(searchRequest("99pi"));
    expect(malformed.status).toBe(502);
    expect((await malformed.json()).error.code).toBe("upstream-malformed");

    stubUpstream(); // everything throws
    const unreachable = await searchGET(searchRequest("99pi again"));
    expect(unreachable.status).toBe(503);
    expect(unreachable.headers.get("Cache-Control")).toBe("no-store");
    expect((await unreachable.json()).error.code).toBe("upstream-unreachable");
  });
});

describe("GET /api/providers/podcasts/show/[appleId]", () => {
  it("returns 200 with the seed for a known appleId", async () => {
    stubUpstream((url) =>
      url.hostname === "itunes.apple.com"
        ? Response.json(itunesLookupOneShow)
        : undefined,
    );
    const response = await showGET(showRequest, showParams("394775318"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.seed.title).toBe("99% Invisible");
    expect(body.seed.ref.appleId).toBe(394775318);
  });

  it("returns 404 for an appleId iTunes does not know", async () => {
    stubUpstream((url) =>
      url.hostname === "itunes.apple.com"
        ? Response.json(itunesLookupEmpty)
        : undefined,
    );
    const response = await showGET(showRequest, showParams("999999999"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not-found");
  });

  it("returns 400 for a non-numeric or overlong appleId without touching the network", async () => {
    stubUpstream();
    const nonNumeric = await showGET(showRequest, showParams("not-a-number"));
    expect(nonNumeric.status).toBe(400);
    expect((await nonNumeric.json()).error.code).toBe("bad-request");

    const overlong = await showGET(showRequest, showParams("9".repeat(13)));
    expect(overlong.status).toBe(400);
    expect((await overlong.json()).error.code).toBe("bad-request");
  });
});
