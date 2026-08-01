import { describe, expect, it, vi } from "vitest";
import type { TmdbNowPlayingEntry } from "../providers/tmdb";
import { providerRegistry } from "../providers/registry";
import { itemIdSchema, type TheaterAvailability } from "../types";
import {
  BigDataCloudLookupError,
  THEATER_ZIP_STORAGE_KEY,
  bigDataCloudReverseGeocode,
  clearTheaterZip,
  fandangoShowtimesUrl,
  moviesInTheatersNowChip,
  normalizeUsZip,
  readTheaterZip,
  requestTheaterZipFromLocation,
  saveTheaterZip,
  withFandangoShowtimes,
} from "./theaters";

function bigDataCloudResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    lookupSource: "coordinates",
    countryCode: "US",
    postcode: "94110",
    locality: "San Francisco",
    ...overrides,
  }), { headers: { "content-type": "application/json" } });
}

async function expectLookupFailure(promise: Promise<unknown>, reason: BigDataCloudLookupError["reason"]) {
  await expect(promise).rejects.toMatchObject({
    name: "BigDataCloudLookupError",
    reason,
  });
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(THEATER_ZIP_STORAGE_KEY, initial);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

function entry(tmdbId: number, title: string, fetchedAt: string): TmdbNowPlayingEntry {
  return {
    seed: { medium: "movie", title, creators: [], ref: { medium: "movie", tmdbId } },
    availability: { kind: "theater", region: "US", fetchedAt },
  };
}

describe("theater ZIP setting", () => {
  it("accepts only strict US ZIP and ZIP+4 forms", () => {
    expect(normalizeUsZip(" 10001 ")).toBe("10001");
    expect(normalizeUsZip("02138-1234")).toBe("02138-1234");
    for (const value of ["2138", "123456", "10001 1234", "ABCDE", "10001<script>"]) {
      expect(normalizeUsZip(value)).toBeUndefined();
    }
  });

  it("stores one validated value locally and removes it", () => {
    const storage = memoryStorage();
    expect(saveTheaterZip(" 10001 ", storage)).toEqual({ ok: true, zip: "10001" });
    expect(storage.setItem).toHaveBeenCalledWith(THEATER_ZIP_STORAGE_KEY, "10001");
    expect(readTheaterZip(storage)).toBe("10001");
    expect(clearTheaterZip(storage)).toBe(true);
    expect(readTheaterZip(storage)).toBeUndefined();
  });

  it("never writes invalid input and fails closed when storage throws", () => {
    const storage = memoryStorage("corrupt-value");
    expect(saveTheaterZip("not-a-zip", storage)).toEqual({ ok: false, reason: "invalid" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(readTheaterZip(storage)).toBeUndefined();

    const blocked = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
      removeItem: vi.fn(() => { throw new Error("blocked"); }),
    };
    expect(readTheaterZip(blocked)).toBeUndefined();
    expect(saveTheaterZip("10001", blocked)).toEqual({ ok: false, reason: "storage-unavailable" });
    expect(clearTheaterZip(blocked)).toBe(false);
  });
});

describe("optional geolocation boundary", () => {
  it("does not request coordinates while no processor is approved", async () => {
    const getCurrentPosition = vi.fn();
    await expect(
      requestTheaterZipFromLocation({ geolocation: { getCurrentPosition } }),
    ).resolves.toEqual({ ok: false, reason: "not-enabled" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("reports permission denial without calling the converter", async () => {
    const reverseGeocode = vi.fn();
    const geolocation = {
      getCurrentPosition: vi.fn((_success: PositionCallback, error?: PositionErrorCallback | null) => {
        error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      }),
    };
    await expect(requestTheaterZipFromLocation({ geolocation, reverseGeocode })).resolves.toEqual({
      ok: false,
      reason: "permission-denied",
    });
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it("keeps coordinates transient and accepts only a validated converted ZIP", async () => {
    const reverseGeocode = vi.fn(async () => "94110");
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => {
        success({ coords: { latitude: 37.75, longitude: -122.42 } } as GeolocationPosition);
      }),
    };
    await expect(requestTheaterZipFromLocation({ geolocation, reverseGeocode })).resolves.toEqual({
      ok: true,
      zip: "94110",
    });
    expect(reverseGeocode).toHaveBeenCalledWith({ latitude: 37.75, longitude: -122.42 });

    reverseGeocode.mockResolvedValueOnce("outside-US");
    await expect(requestTheaterZipFromLocation({ geolocation, reverseGeocode })).resolves.toEqual({
      ok: false,
      reason: "invalid-zip",
    });
  });
});

describe("BigDataCloud client-only ZIP adapter", () => {
  it("calls only the documented endpoint with validated three-decimal coordinates", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => bigDataCloudResponse(),
    );
    await expect(bigDataCloudReverseGeocode(
      { latitude: 37.77491, longitude: -122.41939 },
      { fetch },
    )).resolves.toBe("94110");

    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0];
    const url = new URL(input);
    expect(url.origin).toBe("https://api.bigdatacloud.net");
    expect(url.pathname).toBe("/data/reverse-geocode-client");
    expect([...url.searchParams.entries()]).toEqual([
      ["latitude", "37.775"],
      ["longitude", "-122.419"],
      ["localityLanguage", "en"],
    ]);
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).toBe(timeoutSignal);
    expect(timeout).toHaveBeenCalledWith(8_000);
  });

  it.each([
    [{ latitude: Number.NaN, longitude: 0 }],
    [{ latitude: Number.POSITIVE_INFINITY, longitude: 0 }],
    [{ latitude: 90.001, longitude: 0 }],
    [{ latitude: 0, longitude: -180.001 }],
  ])("rejects invalid WGS84 coordinates before fetching: %o", async (coordinates) => {
    const fetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => bigDataCloudResponse(),
    );
    await expectLookupFailure(bigDataCloudReverseGeocode(coordinates, { fetch }), "invalid-coordinates");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts only the official coordinate discriminator and rejects IP fallback", async () => {
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => bigDataCloudResponse({ lookupSource: "ipGeolocation" }) },
    ), "invalid-response");
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => bigDataCloudResponse({ lookupSource: "reverseGeocoding" }) },
    ), "invalid-response");
  });

  it("rejects non-US results", async () => {
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 43.7, longitude: -79.4 },
      { fetch: async () => bigDataCloudResponse({ countryCode: "CA", postcode: "M5V 3A8" }) },
    ), "non-us");
  });

  it.each([
    ["malformed JSON", "{"],
    ["HTML", "<html>not JSON</html>"],
    ["bad ZIP", JSON.stringify({ lookupSource: "coordinates", countryCode: "US", postcode: "9411" })],
    ["missing discriminator", JSON.stringify({ countryCode: "US", postcode: "94110" })],
  ])("rejects a %s response", async (_case, body) => {
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(body) },
    ), "invalid-response");
  });

  it("cancels a response declared over the limit before reading a chunk", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream, { headers: { "content-length": "32769" } }) },
    ), "invalid-response");
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops and cancels the stream on the first byte over the limit", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(32_768));
        else if (pulls === 2) controller.enqueue(new Uint8Array([1]));
        else controller.enqueue(new Uint8Array([2]));
      },
      cancel,
    }, { highWaterMark: 0 });
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream) },
    ), "invalid-response");
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("skips many empty chunks without retaining them, then parses valid JSON", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({
      lookupSource: "coordinates",
      countryCode: "US",
      postcode: "94110",
    }));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 128) {
          const empty = new Uint8Array(0);
          controller.enqueue(empty);
          // Retaining this empty view would make the final body.set throw;
          // successfully parsing proves empty chunks were actually skipped.
          structuredClone(empty.buffer, { transfer: [empty.buffer] });
        } else if (pulls === 129) controller.enqueue(encoded);
        else controller.close();
      },
    }, { highWaterMark: 0 });
    await expect(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream) },
    )).resolves.toBe("94110");
    expect(pulls).toBe(130);
  });

  it("bounds an endless empty-chunk stream before it can starve timeout tasks", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(0));
      },
      cancel,
    }, { highWaterMark: 0 });
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream) },
    ), "invalid-response");
    expect(pulls).toBe(256);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not await a never-settling cancel promise for an invalid response", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
    const lookup = bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream, { headers: { "content-length": "32769" } }) },
    );
    const settled = await Promise.race([
      lookup.catch((error: unknown) => error),
      new Promise((resolve) => setTimeout(() => resolve("deadline"), 100)),
    ]);
    expect(settled).toMatchObject({ reason: "invalid-response" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a missing body and a stream read failure without exposing details", async () => {
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(null) },
    ), "invalid-response");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("sensitive upstream detail"));
      },
    });
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream) },
    ), "invalid-response");
  });

  it("cancels a pending body read when the timeout signal aborts", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
    const lookup = bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream), signal: controller.signal },
    );
    controller.abort();
    await expectLookupFailure(lookup, "timeout");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns timeout even when cancellation itself never settles", async () => {
    const controller = new AbortController();
    let markPulled: (() => void) | undefined;
    const pulled = new Promise<void>((resolve) => { markPulled = resolve; });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        markPulled?.();
        return new Promise<void>(() => {});
      },
      cancel,
    }, { highWaterMark: 0 });
    const lookup = bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response(stream), signal: controller.signal },
    );
    await pulled;
    controller.abort();
    const settled = await Promise.race([
      lookup.catch((error: unknown) => error),
      new Promise((resolve) => setTimeout(() => resolve("deadline"), 100)),
    ]);
    expect(settled).toMatchObject({ reason: "timeout" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("distinguishes fair-use blocking, ordinary HTTP failure, and timeout", async () => {
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response("blocked", { status: 402 }) },
    ), "service-blocked");
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch: async () => new Response("failed", { status: 503 }) },
    ), "lookup-failed");

    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => { throw new DOMException("aborted", "AbortError"); },
    );
    await expectLookupFailure(bigDataCloudReverseGeocode(
      { latitude: 40.7, longitude: -74 },
      { fetch, signal: controller.signal },
    ), "timeout");
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe("Fandango theater links", () => {
  it("builds an exact-title HTTPS search without leaking the local ZIP", () => {
    const url = new URL(fandangoShowtimesUrl(" Dune: Part Two "));
    expect(url.origin).toBe("https://www.fandango.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("Dune: Part Two");
    expect([...url.searchParams.keys()]).toEqual(["q"]);
  });

  it("rejects a compromised registry destination", () => {
    const deepLink = providerRegistry.fandango.deepLink;
    if (deepLink.params !== "showtimes") throw new Error("bad fixture");
    const original = deepLink.web;
    deepLink.web = () => "https://fandango.example.com/search?q=Dune";
    try {
      expect(() => fandangoShowtimesUrl("Dune")).toThrow("unsafe or inexact");
    } finally {
      deepLink.web = original;
    }
  });

  it("rejects duplicate title parameters and non-default HTTPS ports", () => {
    const deepLink = providerRegistry.fandango.deepLink;
    if (deepLink.params !== "showtimes") throw new Error("bad fixture");
    const original = deepLink.web;
    try {
      deepLink.web = ({ title }) =>
        `https://www.fandango.com/search?q=${encodeURIComponent(title)}&q=${encodeURIComponent(title)}`;
      expect(() => fandangoShowtimesUrl("Dune")).toThrow("unsafe or inexact");

      deepLink.web = ({ title }) =>
        `https://www.fandango.com:444/search?q=${encodeURIComponent(title)}`;
      expect(() => fandangoShowtimesUrl("Dune")).toThrow("unsafe or inexact");
    } finally {
      deepLink.web = original;
    }
  });

  it("accepts an explicitly written default HTTPS port after URL normalization", () => {
    const deepLink = providerRegistry.fandango.deepLink;
    if (deepLink.params !== "showtimes") throw new Error("bad fixture");
    const original = deepLink.web;
    deepLink.web = ({ title }) =>
      `https://www.fandango.com:443/search?q=${encodeURIComponent(title)}`;
    try {
      expect(fandangoShowtimesUrl("Dune")).toBe("https://www.fandango.com/search?q=Dune");
    } finally {
      deepLink.web = original;
    }
  });

  it("enriches only an already-confirmed theater offer", () => {
    const theater: TheaterAvailability = {
      itemId: itemIdSchema.parse("movie-1"),
      kind: "theater",
      region: "US",
      fetchedAt: "2026-08-01T12:00:00.000Z",
    };
    const enriched = withFandangoShowtimes(theater, "Dune");
    expect(enriched.fandangoUrl).toContain("q=Dune");
    expect(enriched.fetchedAt).toBe(theater.fetchedAt);
  });
});

describe("movies in theaters now chip", () => {
  it("contains only deduped confirmed presences and exposes staleness", () => {
    const old = entry(1, "Old Evidence", "2026-07-30T12:00:00.000Z");
    const current = entry(2, "Current Evidence", "2026-08-01T12:00:00.000Z");
    const chip = moviesInTheatersNowChip(
      [old, current, current],
      new Date("2026-08-01T13:00:00.000Z"),
    );
    expect(chip.status).toBe("present");
    expect(chip.entries.map((item) => item.seed.title)).toEqual(["Old Evidence", "Current Evidence"]);
    expect(chip.fetchedAt).toBe("2026-07-30T12:00:00.000Z");
    expect(chip.stale).toBe(true);
  });

  it("treats an empty capped feed as unknown, never as absent", () => {
    const chip = moviesInTheatersNowChip([], new Date("2026-08-01T13:00:00.000Z"));
    expect(chip.status).toBe("unknown");
    expect(chip.entries).toEqual([]);
    expect(chip.stale).toBe(true);
  });
});
