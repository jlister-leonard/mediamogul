import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { itemSchema, subscriptionAvailabilitySchema } from "../types";
import { resolveItemAvailability } from ".";
import { buildRecommendationAvailabilityContext } from "./recommend-context";
import { executeTool, providersLoaderWithAvailability } from "../llm/tools";

const fetchedAt = new Date().toISOString();
const movie = itemSchema.parse({
  id: "item-client-movie",
  medium: "movie",
  title: "Heat",
  creators: ["Michael Mann"],
  ref: { medium: "movie", tmdbId: 949 },
});
const podcast = itemSchema.parse({
  id: "item-client-podcast",
  medium: "podcast",
  title: "Acquired",
  creators: ["Ben Gilbert"],
  ref: { medium: "podcast", spotifyShowId: "show-123" },
});
const book = itemSchema.parse({
  id: "item-client-book",
  medium: "book",
  title: "Bad Blood",
  creators: ["John Carreyrou"],
  ref: { medium: "book", isbn13: "9781524731656" },
});

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});
afterAll(() => db.close());

describe("production browser availability path", () => {
  it("cold-refreshes movie, podcast, and book through safe adapters, then reloads all from durable cache", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.startsWith("/api/providers/tmdb/watch-providers")) {
        return Response.json({ ok: true, data: { offers: [{
          tmdbProviderId: 8,
          providerName: "Netflix",
          availability: {
            kind: "subscription",
            providerId: "netflix",
            region: "US",
            fetchedAt,
          },
        }] } });
      }
      if (url === "/api/providers/tmdb/now-playing") {
        return Response.json({ ok: true, data: [] });
      }
      if (url === "/api/providers/audible/catalog") {
        expect(JSON.parse(String(init?.body))).toEqual({
          title: "Bad Blood",
          creators: ["John Carreyrou"],
        });
        return Response.json({ ok: true, product: {
          asin: "B07C8GVTB5",
          title: "Bad Blood",
          authors: [{ name: "John Carreyrou" }],
        } });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await db.items.bulkAdd([movie, podcast, book]);

    const cold = await Promise.all([
      resolveItemAvailability(movie),
      resolveItemAvailability(podcast),
      resolveItemAvailability(book),
    ]);
    expect(cold.map((result) => result.metadata.cache)).toEqual([
      "refreshed", "refreshed", "refreshed",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const recommendationContext = await buildRecommendationAvailabilityContext();
    expect(recommendationContext).toHaveLength(3);
    expect(Object.keys(recommendationContext[0]).sort()).toEqual(["offers", "ref"]);
    expect(JSON.stringify(recommendationContext)).not.toContain("John Carreyrou");
    expect(JSON.stringify(recommendationContext)).not.toContain("Bad Blood");
    expect(JSON.stringify(recommendationContext)).not.toContain("item-client");

    db.close();
    await db.open();
    const offlineFetch = vi.fn(async () => { throw new Error("offline after reload"); });
    vi.stubGlobal("fetch", offlineFetch);
    const reloaded = await Promise.all([
      resolveItemAvailability(movie),
      resolveItemAvailability(podcast),
      resolveItemAvailability(book),
    ]);
    expect(reloaded.map((result) => result.metadata.cache)).toEqual([
      "hit", "hit", "hit",
    ]);
    expect(reloaded.map((result) => {
      const offer = result.offers[0];
      return offer && "providerId" in offer ? offer.providerId : undefined;
    })).toEqual([
      "netflix", "spotify", "audible",
    ]);
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it("excludes stale positive and empty evidence from model tool answers", async () => {
    const now = new Date("2026-08-01T16:00:00.000Z");
    await db.items.bulkAdd([movie, podcast, book]);
    await db.availability.bulkAdd([subscriptionAvailabilitySchema.parse({
      itemId: movie.id,
      kind: "subscription",
      providerId: "netflix",
      region: "US",
      fetchedAt: "2026-07-31T15:59:59.999Z",
    })]);
    await db.availabilityRefreshes.bulkAdd([
      { itemId: movie.id, fetchedAt: "2026-08-01T15:00:00.000Z" },
      { itemId: book.id, fetchedAt: "2026-07-31T16:00:00.000Z" },
      { itemId: podcast.id, fetchedAt: "2026-08-01T15:00:00.000Z" },
    ]);

    const context = await buildRecommendationAvailabilityContext(now);
    expect(context).toEqual([{ ref: podcast.ref, offers: [] }]);

    const outcome = await executeTool(
      "check_availability",
      { itemRefs: [movie.ref, book.ref, podcast.ref] },
      providersLoaderWithAvailability(context),
    );
    expect(outcome).toEqual({
      status: "ok",
      result: [
        { ref: movie.ref, checked: false, offers: [] },
        { ref: book.ref, checked: false, offers: [] },
        { ref: podcast.ref, checked: true, offers: [] },
      ],
    });
  });
});
