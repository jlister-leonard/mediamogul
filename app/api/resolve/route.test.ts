import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolveOptions, ResolveResult } from "../../../lib/resolve";
import { GET } from "./route";

/**
 * The route is a thin shell: parse params → `resolve()` → status + cache
 * headers. `resolve` itself is faked at the module boundary (its own fan-out
 * is covered by lib/resolve/resolve.test.ts with injected provider fakes),
 * so these cases test exactly what the route owns.
 */
const { resolveMock } = vi.hoisted(() => ({
  resolveMock: vi.fn<(query: string, options?: ResolveOptions) => Promise<ResolveResult>>(),
}));

vi.mock("../../../lib/resolve", () => ({ resolve: resolveMock }));

const empty: ResolveResult = {
  ok: true,
  groups: { book: [], movie: [], tv: [], podcast: [] },
  searched: ["book", "movie", "tv", "podcast"],
  degraded: [],
};

const request = (qs: string): Request =>
  new Request(`https://nightstand.test/api/resolve?${qs}`);

afterEach(() => {
  resolveMock.mockReset();
});

describe("GET /api/resolve", () => {
  it("200 with the resolve envelope and shared-cache headers", async () => {
    resolveMock.mockResolvedValue(empty);
    const response = await GET(request("q=dune"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
    expect(await response.json()).toEqual(empty);
    expect(resolveMock).toHaveBeenCalledWith("dune", {});
  });

  it("caches a degraded answer briefly and privately, so recovery is not masked", async () => {
    resolveMock.mockResolvedValue({ ...empty, degraded: ["tv"] });
    const response = await GET(request("q=dune"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("passes a media scope through", async () => {
    resolveMock.mockResolvedValue(empty);
    await GET(request("q=dune&media=book,tv"));
    expect(resolveMock).toHaveBeenCalledWith("dune", {
      media: ["book", "tv"],
    });
  });

  it("400 + no-store for an unknown medium, without calling resolve", async () => {
    const response = await GET(request("q=dune&media=book,vhs"));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ResolveResult;
    if (body.ok) throw new Error("expected an error envelope");
    expect(body.error.code).toBe("bad-request");
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("400 + no-store for a missing query", async () => {
    resolveMock.mockResolvedValue({
      ok: false,
      error: { code: "bad-request", message: "a non-empty query is required" },
    });
    const response = await GET(request(""));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(resolveMock).toHaveBeenCalledWith("", {});
  });

  it("502 + no-store when every provider is down", async () => {
    resolveMock.mockResolvedValue({
      ok: false,
      error: { code: "all-providers-failed", message: "everything is down" },
    });
    const response = await GET(request("q=dune"));

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ResolveResult;
    if (body.ok) throw new Error("expected an error envelope");
    expect(body.error.code).toBe("all-providers-failed");
  });

  it("degrades a thrown error to the typed envelope, never an HTML 500", async () => {
    resolveMock.mockRejectedValue(new Error("unexpected"));
    const response = await GET(request("q=dune"));

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ResolveResult;
    if (body.ok) throw new Error("expected an error envelope");
    expect(body.error.message).toBe("unexpected");
  });
});
