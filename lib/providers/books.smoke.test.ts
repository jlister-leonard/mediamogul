import { describe, expect, it } from "vitest";
import {
  bookQuerySchema,
  createBooksProvider,
  googleBooksUrl,
  googleVolumesSchema,
  openLibrarySearchSchema,
  openLibraryUrl,
} from "./books";

/**
 * Live smoke tests — hit the real upstreams to catch drift between the
 * documented shapes our fixtures encode and reality. They AUTO-SKIP when a
 * host is unreachable or rate-limited (this build environment can reach
 * www.googleapis.com only, and Google's keyless quota may be exhausted), so
 * `npm test` is deterministic everywhere and fully live in open networks.
 */

const SMOKE_TIMEOUT_MS = 30_000;

type Probe =
  | { status: "ok"; body: unknown }
  | { status: "unreachable"; reason: string };

async function probe(url: string, attempts = 2): Promise<Probe> {
  let reason = "unknown";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      if (response.status === 429) {
        reason = "HTTP 429 (rate limited)";
        // Back off politely before the single retry.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      if (!response.ok) return { status: "unreachable", reason: `HTTP ${response.status}` };
      return { status: "ok", body: (await response.json()) as unknown };
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  return { status: "unreachable", reason };
}

const isbnQuery = bookQuerySchema.parse({ isbn: "9780857197689" });
const textQuery = bookQuerySchema.parse({ q: "the psychology of money", limit: 5 });

describe("live smoke: Open Library", () => {
  it(
    "search.json matches our upstream schema and normalizes end-to-end",
    { timeout: SMOKE_TIMEOUT_MS },
    async (ctx) => {
      const probed = await probe(openLibraryUrl(textQuery));
      if (probed.status === "unreachable") {
        console.warn(`[smoke] skipping Open Library: ${probed.reason}`);
        return ctx.skip();
      }
      expect(openLibrarySearchSchema.safeParse(probed.body).success).toBe(true);

      // Only Open Library upstream: an unreachable-Google env still verifies
      // the primary path; the provider must not need the fallback here.
      const provider = createBooksProvider();
      const result = await provider.search(textQuery);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.source).toBe("openlibrary");
      expect(result.seeds.length).toBeGreaterThan(0);
      expect(result.seeds[0].ref.openLibraryId).toBeDefined();
    },
  );
});

describe("live smoke: Google Books", () => {
  it(
    "volumes endpoint matches our upstream schema for an ISBN lookup",
    { timeout: SMOKE_TIMEOUT_MS },
    async (ctx) => {
      const probed = await probe(googleBooksUrl(isbnQuery));
      if (probed.status === "unreachable") {
        console.warn(`[smoke] skipping Google Books: ${probed.reason}`);
        return ctx.skip();
      }
      const parsed = googleVolumesSchema.safeParse(probed.body);
      expect(parsed.success).toBe(true);

      // Exercise the fallback path against the live upstream: with Open
      // Library forced down, the provider must land on googlebooks.
      const provider = createBooksProvider({
        fetchFn: (input, init) => {
          const url = String(input);
          if (url.startsWith("https://openlibrary.org/")) {
            return Promise.reject(new TypeError("forced down for smoke"));
          }
          return globalThis.fetch(input, init);
        },
      });
      const result = await provider.search({ isbn: "9780857197689" });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.source).toBe("googlebooks");
      expect(result.seeds).toHaveLength(1);
      expect(result.seeds[0].ref.isbn13).toBe("9780857197689");
    },
  );
});
