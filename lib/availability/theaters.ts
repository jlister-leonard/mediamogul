import { z } from "zod";
import type { TmdbNowPlayingEntry } from "../providers/tmdb";
import { providerRegistry } from "../providers/registry";
import type { TheaterAvailability } from "../types";

export const THEATER_ZIP_STORAGE_KEY = "nightstand:settings:theater-zip";
export const MOVIES_IN_THEATERS_NOW_LABEL = "movies in theaters now";

const US_ZIP = /^\d{5}(?:-\d{4})?$/;
const THEATER_DATA_TTL_MS = 24 * 60 * 60 * 1_000;
const BIG_DATA_CLOUD_ENDPOINT = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const BIG_DATA_CLOUD_TIMEOUT_MS = 8_000;
const BIG_DATA_CLOUD_MAX_RESPONSE_BYTES = 32_768;
// A separate read budget prevents an endless sequence of empty chunks from
// retaining state or starving the task queue before the timeout can fire.
const BIG_DATA_CLOUD_MAX_BODY_READS = 256;

const bigDataCloudCountryPeekSchema = z.object({ countryCode: z.string() });
const bigDataCloudResponseSchema = z.object({
  lookupSource: z.literal("coordinates"),
  countryCode: z.literal("US"),
  postcode: z.string().min(1).max(16),
});

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
 * A reverse-geocoder is deliberately injected so requesting coordinates never
 * silently selects a processor. Production supplies the approved BigDataCloud
 * adapter only from the disclosed, explicit-click settings flow.
 */
export type ReverseGeocodeToZip = (coordinates: {
  latitude: number;
  longitude: number;
}) => Promise<string | undefined>;

export type BigDataCloudLookupFailure =
  | "invalid-coordinates"
  | "timeout"
  | "service-blocked"
  | "lookup-failed"
  | "non-us"
  | "invalid-response";

export class BigDataCloudLookupError extends Error {
  constructor(readonly reason: BigDataCloudLookupFailure) {
    super(reason);
    this.name = "BigDataCloudLookupError";
  }
}

type TheaterFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function roundedCoordinate(value: number, minimum: number, maximum: number): string | undefined {
  if (!Number.isFinite(value) || value < minimum || value > maximum) return undefined;
  const rounded = Math.round(value * 1_000) / 1_000;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(3);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    // Cancellation is cleanup, not a condition for returning the real error.
    // Observe rejection without awaiting a potentially hostile cancel promise.
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort after the response has already been rejected.
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new BigDataCloudLookupError("timeout");
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new BigDataCloudLookupError("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (response.body === null) throw new BigDataCloudLookupError("invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reads = 0;
  try {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const bytes = Number(declaredLength);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > BIG_DATA_CLOUD_MAX_RESPONSE_BYTES) {
        cancelReader(reader);
        throw new BigDataCloudLookupError("invalid-response");
      }
    }

    while (true) {
      if (reads >= BIG_DATA_CLOUD_MAX_BODY_READS) {
        cancelReader(reader);
        throw new BigDataCloudLookupError("invalid-response");
      }
      reads += 1;
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      // Response chunks can originate in the browser/undici realm, so an
      // instanceof check against this module's Uint8Array can be false.
      if (Object.prototype.toString.call(value) !== "[object Uint8Array]") {
        cancelReader(reader);
        throw new BigDataCloudLookupError("invalid-response");
      }
      // Do not retain an attacker-controlled number of empty views. The read
      // budget above still guarantees this loop settles without task starvation.
      if (value.byteLength === 0) continue;
      if (value.byteLength > BIG_DATA_CLOUD_MAX_RESPONSE_BYTES - total) {
        cancelReader(reader);
        throw new BigDataCloudLookupError("invalid-response");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    cancelReader(reader);
    if (error instanceof BigDataCloudLookupError) throw error;
    throw new BigDataCloudLookupError(signal.aborted ? "timeout" : "invalid-response");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Convert current HTML5 coordinates to a US ZIP through BigDataCloud's
 * no-key, client-only endpoint. Only the validated ZIP leaves this boundary.
 */
export async function bigDataCloudReverseGeocode(
  coordinates: { latitude: number; longitude: number },
  options: { fetch?: TheaterFetch; signal?: AbortSignal } = {},
): Promise<string> {
  const latitude = roundedCoordinate(coordinates.latitude, -90, 90);
  const longitude = roundedCoordinate(coordinates.longitude, -180, 180);
  if (latitude === undefined || longitude === undefined) {
    throw new BigDataCloudLookupError("invalid-coordinates");
  }

  const url = new URL(BIG_DATA_CLOUD_ENDPOINT);
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("localityLanguage", "en");
  const signal = options.signal ?? AbortSignal.timeout(BIG_DATA_CLOUD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch {
    throw new BigDataCloudLookupError(signal.aborted ? "timeout" : "lookup-failed");
  }

  if (response.status === 402) throw new BigDataCloudLookupError("service-blocked");
  if (!response.ok) throw new BigDataCloudLookupError("lookup-failed");

  let body: unknown;
  try {
    const bytes = await readBoundedBody(response, signal);
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof BigDataCloudLookupError) throw error;
    throw new BigDataCloudLookupError(signal.aborted ? "timeout" : "invalid-response");
  }

  const country = bigDataCloudCountryPeekSchema.safeParse(body);
  if (country.success && country.data.countryCode !== "US") {
    throw new BigDataCloudLookupError("non-us");
  }
  const parsed = bigDataCloudResponseSchema.safeParse(body);
  if (!parsed.success) throw new BigDataCloudLookupError("invalid-response");
  const zip = normalizeUsZip(parsed.data.postcode);
  if (zip === undefined) throw new BigDataCloudLookupError("invalid-response");
  return zip;
}

export type LocationZipResult =
  | { ok: true; zip: string }
  | {
      ok: false;
      reason:
        | "not-enabled"
        | "unsupported"
        | "permission-denied"
        | "timeout"
        | "service-blocked"
        | "unavailable"
        | "non-us"
        | "invalid-zip";
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
          (error) => {
            if (error instanceof BigDataCloudLookupError) {
              if (error.reason === "timeout") return resolve({ ok: false, reason: "timeout" });
              if (error.reason === "service-blocked") {
                return resolve({ ok: false, reason: "service-blocked" });
              }
              if (error.reason === "non-us") return resolve({ ok: false, reason: "non-us" });
              if (error.reason === "invalid-coordinates" || error.reason === "invalid-response") {
                return resolve({ ok: false, reason: "invalid-zip" });
              }
            }
            return resolve({ ok: false, reason: "unavailable" });
          },
        );
      },
      (error) => {
        resolve({
          ok: false,
          reason:
            error.code === error.PERMISSION_DENIED
              ? "permission-denied"
              : error.code === error.TIMEOUT
                ? "timeout"
                : "unavailable",
        });
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
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
