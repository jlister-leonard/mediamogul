import { afterEach, describe, expect, it, vi } from "vitest";
import { booksResultSchema } from "../../../../lib/providers/books";
import {
  googleBooksSearchFixture,
  openLibrarySearchFixture,
} from "../../../../lib/providers/fixtures/books";
import { GET } from "./route";

/**
 * The route uses the module-level provider singleton, whose default fetch
 * resolves `globalThis.fetch` at call time — so stubbing the global here
 * controls the upstreams. Each test uses a distinct query to stay clear of
 * the singleton's (intentionally persistent) LRU.
 */

const request = (qs: string): Request =>
  new Request(`https://nightstand.test/api/providers/books?${qs}`);

const stubUpstreams = (handler: (url: string) => Response | Promise<Response>) =>
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL): Promise<Response> =>
      Promise.resolve(handler(String(input))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/providers/books", () => {
  it("400 + typed bad_request envelope when no query is given; never cached", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await response.json();
    const parsed = booksResultSchema.parse(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected error envelope");
    expect(parsed.error.code).toBe("bad_request");
  });

  it("400 for a malformed ISBN", async () => {
    const response = await GET(request("isbn=not-a-number"));
    expect(response.status).toBe(400);
    const parsed = booksResultSchema.parse(await response.json());
    if (parsed.ok) throw new Error("expected error envelope");
    expect(parsed.error.code).toBe("bad_request");
  });

  it("200 with normalized seeds and shared-cache headers", async () => {
    stubUpstreams(() =>
      new Response(JSON.stringify(openLibrarySearchFixture), {
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await GET(request("q=route+success+case"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
    );
    const parsed = booksResultSchema.parse(await response.json());
    if (!parsed.ok) throw new Error("expected success envelope");
    expect(parsed.source).toBe("openlibrary");
    expect(parsed.seeds.length).toBeGreaterThan(0);
  });

  it("serves a repeated query from the LRU without re-hitting upstream", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(googleBooksSearchFixture), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    // Open Library "unreachable" would reject; return the Google fixture for
    // whichever upstream answers — call count is what's under test.
    await GET(request("q=route+cache+case"));
    const callsAfterFirst = fetchSpy.mock.calls.length;
    const second = await GET(request("q=route+cache+case"));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
    expect(second.status).toBe(200);
  });

  it("502 + typed envelope (JSON, not an HTML error page) when every upstream is down", async () => {
    stubUpstreams(() => {
      throw new TypeError("fetch failed");
    });
    const response = await GET(request("q=route+outage+case"));
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const parsed = booksResultSchema.parse(await response.json());
    if (parsed.ok) throw new Error("expected error envelope");
    expect(parsed.error.code).toBe("upstream_unavailable");
    expect(parsed.error.upstream).toHaveLength(2);
  });
});
