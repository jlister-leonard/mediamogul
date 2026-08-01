import { describe, expect, it, vi } from "vitest";
import type { TmdbNowPlayingEntry } from "../providers/tmdb";
import { providerRegistry } from "../providers/registry";
import { itemIdSchema, type TheaterAvailability } from "../types";
import {
  THEATER_ZIP_STORAGE_KEY,
  clearTheaterZip,
  fandangoShowtimesUrl,
  moviesInTheatersNowChip,
  normalizeUsZip,
  readTheaterZip,
  requestTheaterZipFromLocation,
  saveTheaterZip,
  withFandangoShowtimes,
} from "./theaters";

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
