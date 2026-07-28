import { describe, expect, it } from "vitest";
import {
  resolveSpotifyShow,
  searchPodcastShows,
  spotifyConfigFromEnv,
} from "./podcasts";

/**
 * Live smokes — verify the real wire shapes the fixtures model. They AUTO-SKIP
 * when the environment cannot run them honestly: itunes.apple.com is not
 * egress-reachable from every build environment, and Spotify needs
 * SPOTIFY_CLIENT_ID/SECRET. Where both exist (production CI), these run.
 */

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

const ITUNES_PROBE =
  "https://itunes.apple.com/search?term=test&media=podcast&entity=podcast&limit=1";

describe("live smokes", () => {
  it("iTunes Search: a real query normalizes to seeds", async (ctx) => {
    if (!(await reachable(ITUNES_PROBE))) ctx.skip();
    const result = await searchPodcastShows("99% invisible", { limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spotify).toBe("spotify-unconfigured");
    expect(result.seeds.length).toBeGreaterThan(0);
    expect(result.seeds[0].medium).toBe("podcast");
    expect(result.seeds[0].ref.appleId).toBeTypeOf("number");
  });

  it("Spotify: client-credentials search resolves a well-known show id", async (ctx) => {
    const config = spotifyConfigFromEnv();
    if (config === undefined) ctx.skip();
    if (config === undefined) return; // narrow for TS; skip() already threw
    const resolution = await resolveSpotifyShow(
      { title: "The Daily", publisher: "The New York Times" },
      config,
    );
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.spotifyShowId).toMatch(/^[0-9A-Za-z]{22}$/);
  });
});
