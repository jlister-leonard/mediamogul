import type { TmdbNowPlayingEntry } from "../providers/tmdb";
import { providerRegistry } from "../providers/registry";
import type { TheaterAvailability } from "../types";

export const THEATER_ZIP_STORAGE_KEY = "nightstand:settings:theater-zip";
export const MOVIES_IN_THEATERS_NOW_LABEL = "movies in theaters now";

const US_ZIP = /^\d{5}(?:-\d{4})?$/;
const THEATER_DATA_TTL_MS = 24 * 60 * 60 * 1_000;

type ZipStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ZipSaveResult =
  | { ok: true; zip: string }
  | { ok: false; reason: "invalid" | "storage-unavailable" };

/** A strict five-digit US ZIP, with the optional four-digit delivery suffix. */
export function normalizeUsZip(value: string): string | undefined {
  const normalized = value.trim();
  return US_ZIP.test(normalized) ? normalized : undefined;
}

/** Read the one device-local theater ZIP. Corrupt legacy values are ignored. */
export function readTheaterZip(storage: ZipStorage | undefined = browserStorage()): string | undefined {
  if (storage === undefined) return undefined;
  try {
    const stored = storage.getItem(THEATER_ZIP_STORAGE_KEY);
    return stored === null ? undefined : normalizeUsZip(stored);
  } catch {
    return undefined;
  }
}

/** Validate before writing so malformed location data never enters settings. */
export function saveTheaterZip(
  value: string,
  storage: ZipStorage | undefined = browserStorage(),
): ZipSaveResult {
  const zip = normalizeUsZip(value);
  if (zip === undefined) return { ok: false, reason: "invalid" };
  if (storage === undefined) return { ok: false, reason: "storage-unavailable" };
  try {
    storage.setItem(THEATER_ZIP_STORAGE_KEY, zip);
    return { ok: true, zip };
  } catch {
    return { ok: false, reason: "storage-unavailable" };
  }
}

export function clearTheaterZip(storage: ZipStorage | undefined = browserStorage()): boolean {
  if (storage === undefined) return false;
  try {
    storage.removeItem(THEATER_ZIP_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): ZipStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * A reverse-geocoder is deliberately injected instead of silently choosing a
 * new location processor. The UI currently supplies none, so coordinates are
 * neither requested nor transmitted until the user approves that dependency.
 */
export type ReverseGeocodeToZip = (coordinates: {
  latitude: number;
  longitude: number;
}) => Promise<string | undefined>;

export type LocationZipResult =
  | { ok: true; zip: string }
  | {
      ok: false;
      reason: "not-enabled" | "unsupported" | "permission-denied" | "unavailable" | "invalid-zip";
    };

export async function requestTheaterZipFromLocation(options: {
  geolocation?: Pick<Geolocation, "getCurrentPosition">;
  reverseGeocode?: ReverseGeocodeToZip;
} = {}): Promise<LocationZipResult> {
  // Do not request sensitive coordinates when there is nowhere approved to
  // process them. Calling this function alone is not consent to a third party.
  if (options.reverseGeocode === undefined) return { ok: false, reason: "not-enabled" };
  const geolocation = options.geolocation ?? globalThis.navigator?.geolocation;
  if (geolocation === undefined) return { ok: false, reason: "unsupported" };

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        // Coordinates stay in this callback and are not written to Nightstand
        // storage. The approved adapter must return only a postal code.
        void options.reverseGeocode!({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }).then(
          (candidate) => {
            const zip = candidate === undefined ? undefined : normalizeUsZip(candidate);
            resolve(zip === undefined ? { ok: false, reason: "invalid-zip" } : { ok: true, zip });
          },
          () => resolve({ ok: false, reason: "unavailable" }),
        );
      },
      (error) => {
        resolve({
          ok: false,
          reason: error.code === 1 ? "permission-denied" : "unavailable",
        });
      },
      { enableHighAccuracy: false, maximumAge: 15 * 60 * 1_000, timeout: 10_000 },
    );
  });
}

/**
 * Fandango's first-party search accepts an exact title query. Its undocumented
 * `zip` query parameter is intentionally not used: a local ZIP is not sent to
 * a provider until that behavior is verified.
 */
export function fandangoShowtimesUrl(title: string): string {
  const exactTitle = title.trim();
  if (exactTitle.length === 0) throw new Error("A movie title is required for showtimes.");

  const provider = providerRegistry.fandango;
  if (provider.deepLink.params !== "showtimes") {
    throw new Error("Fandango is not configured for showtimes.");
  }
  const url = new URL(provider.deepLink.web({ title: exactTitle }));
  if (
    url.protocol !== "https:" ||
    !provider.allowedHosts.includes(url.hostname.toLowerCase()) ||
    url.pathname !== "/search" ||
    url.searchParams.get("q") !== exactTitle ||
    url.searchParams.getAll("q").length !== 1 ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new Error("Fandango produced an unsafe or inexact showtimes destination.");
  }
  // Reject added location/tracking inputs; only the exact title leaves the app.
  if ([...url.searchParams.keys()].some((key) => key !== "q")) {
    throw new Error("Fandango produced an unexpected showtimes parameter.");
  }
  return url.toString();
}

/** Add an actionable Fandango link only to an already-confirmed theater row. */
export function withFandangoShowtimes(
  availability: TheaterAvailability,
  title: string,
): TheaterAvailability {
  return { ...availability, fandangoUrl: fandangoShowtimesUrl(title) };
}

export interface MoviesInTheatersNowChipData {
  id: "movies-in-theaters-now";
  label: typeof MOVIES_IN_THEATERS_NOW_LABEL;
  prompt: string;
  /** Confirmed presences from the capped feed; zero means unknown, not none. */
  status: "present" | "unknown";
  entries: readonly TmdbNowPlayingEntry[];
  fetchedAt?: string;
  stale: boolean;
}

/** Turn the capped `now_playing` slate into the recommender's theater chip. */
export function moviesInTheatersNowChip(
  entries: readonly TmdbNowPlayingEntry[],
  now: Date = new Date(),
): MoviesInTheatersNowChipData {
  const unique = new Map<number, TmdbNowPlayingEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.seed.ref.tmdbId)) unique.set(entry.seed.ref.tmdbId, entry);
  }
  const confirmed = [...unique.values()];
  const fetchedAt = confirmed.map((entry) => entry.availability.fetchedAt).sort()[0];
  const fetchedMs = fetchedAt === undefined ? Number.NaN : Date.parse(fetchedAt);
  return {
    id: "movies-in-theaters-now",
    label: MOVIES_IN_THEATERS_NOW_LABEL,
    prompt: "Recommend a movie confirmed as playing in theaters now.",
    status: confirmed.length > 0 ? "present" : "unknown",
    entries: confirmed,
    ...(fetchedAt !== undefined && { fetchedAt }),
    stale: !Number.isFinite(fetchedMs) || now.getTime() >= fetchedMs + THEATER_DATA_TTL_MS,
  };
}
