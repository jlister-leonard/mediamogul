// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
}));

vi.mock("../resolve", () => ({
  resolve: resolveMock,
}));

import { executeTool, TOOL_DEFINITIONS } from "./tools";

const movieRef = { medium: "movie", tmdbId: 603 };

describe("tool definitions", () => {
  it("defines exactly check_availability and search_catalog with object schemas", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "check_availability",
      "search_catalog",
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });
});

describe("executeTool default wiring", () => {
  const absentLoader = () => Promise.reject(new Error("Cannot find module"));

  beforeEach(() => {
    resolveMock.mockReset();
  });

  it("degrades check_availability to a typed unavailable result", async () => {
    const outcome = await executeTool(
      "check_availability",
      { itemRefs: [movieRef] },
      absentLoader,
    );
    expect(outcome.status).toBe("unavailable");
  });

  it("degrades search_catalog when an injected provider loader is unavailable", async () => {
    const outcome = await executeTool("search_catalog", { query: "lighthouse" }, absentLoader);
    expect(outcome.status).toBe("unavailable");
  });

  it("honestly degrades check_availability until E5.1 is wired", async () => {
    const outcome = await executeTool("check_availability", { itemRefs: [movieRef] });
    expect(outcome.status).toBe("unavailable");
  });

  it("statically routes search_catalog through the existing resolver", async () => {
    const resolved = {
      ok: true,
      groups: { book: [], movie: [], tv: [], podcast: [] },
      searched: ["book"],
      degraded: [],
    };
    resolveMock.mockResolvedValue(resolved);

    const outcome = await executeTool("search_catalog", {
      query: "lighthouse keeper",
      medium: "book",
    });

    expect(resolveMock).toHaveBeenCalledOnce();
    expect(resolveMock).toHaveBeenCalledWith("lighthouse keeper", {
      media: ["book"],
    });
    expect(outcome).toEqual({ status: "ok", result: resolved });
  });

  it("lets an unscoped catalog search fan out across every medium", async () => {
    resolveMock.mockResolvedValue({
      ok: true,
      groups: { book: [], movie: [], tv: [], podcast: [] },
      searched: ["book", "movie", "tv", "podcast"],
      degraded: [],
    });

    await executeTool("search_catalog", { query: "dune" });

    expect(resolveMock).toHaveBeenCalledWith("dune", {});
  });
});

describe("executeTool with injected providers", () => {
  it("routes check_availability to the provider function with parsed refs", async () => {
    const calls: unknown[] = [];
    const outcome = await executeTool("check_availability", { itemRefs: [movieRef] }, () =>
      Promise.resolve({
        checkAvailability: (itemRefs: unknown) => {
          calls.push(itemRefs);
          return Promise.resolve([{ providerId: "netflix", kind: "sub" }]);
        },
      }),
    );
    expect(outcome).toEqual({
      status: "ok",
      result: [{ providerId: "netflix", kind: "sub" }],
    });
    expect(calls).toEqual([[movieRef]]);
  });

  it("routes search_catalog through with query and optional medium", async () => {
    const calls: unknown[] = [];
    const outcome = await executeTool(
      "search_catalog",
      { query: "lighthouse keeper", medium: "book" },
      () =>
        Promise.resolve({
          searchCatalog: (query: string, medium?: string) => {
            calls.push([query, medium]);
            return Promise.resolve([{ title: "The Lamplighters" }]);
          },
        }),
    );
    expect(outcome).toEqual({ status: "ok", result: [{ title: "The Lamplighters" }] });
    expect(calls).toEqual([["lighthouse keeper", "book"]]);
  });

  it("degrades when the module exists but lacks the function", async () => {
    const outcome = await executeTool("search_catalog", { query: "x" }, () =>
      Promise.resolve({}),
    );
    expect(outcome.status).toBe("unavailable");
  });

  it("degrades when the provider function throws", async () => {
    const outcome = await executeTool("search_catalog", { query: "x" }, () =>
      Promise.resolve({
        searchCatalog: () => Promise.reject(new Error("provider down")),
      }),
    );
    expect(outcome.status).toBe("unavailable");
  });
});

describe("executeTool input validation", () => {
  const providers = () =>
    Promise.resolve({
      checkAvailability: () => Promise.resolve([]),
      searchCatalog: () => Promise.resolve([]),
    });

  it("rejects an empty itemRefs array", async () => {
    const outcome = await executeTool("check_availability", { itemRefs: [] }, providers);
    expect(outcome.status).toBe("invalid-input");
  });

  it("rejects a ref that fails the media-ref contract", async () => {
    const outcome = await executeTool(
      "check_availability",
      { itemRefs: [{ medium: "book" }] }, // book ref needs at least one external id
      providers,
    );
    expect(outcome.status).toBe("invalid-input");
  });

  it("rejects an unknown medium on search_catalog", async () => {
    const outcome = await executeTool(
      "search_catalog",
      { query: "x", medium: "vinyl" },
      providers,
    );
    expect(outcome.status).toBe("invalid-input");
  });

  it("rejects an unknown tool name", async () => {
    const outcome = await executeTool("delete_library", {}, providers);
    expect(outcome.status).toBe("invalid-input");
  });
});
