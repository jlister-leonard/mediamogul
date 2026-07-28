// @vitest-environment node
import { describe, expect, it } from "vitest";
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

describe("executeTool without lib/providers (E2.x not yet merged)", () => {
  const absentLoader = () => Promise.reject(new Error("Cannot find module"));

  it("degrades check_availability to a typed unavailable result", async () => {
    const outcome = await executeTool(
      "check_availability",
      { itemRefs: [movieRef] },
      absentLoader,
    );
    expect(outcome.status).toBe("unavailable");
  });

  it("degrades search_catalog to a typed unavailable result", async () => {
    const outcome = await executeTool("search_catalog", { query: "lighthouse" }, absentLoader);
    expect(outcome.status).toBe("unavailable");
  });

  it("degrades via the DEFAULT loader too — the real current state of the repo", async () => {
    const outcome = await executeTool("check_availability", { itemRefs: [movieRef] });
    expect(outcome.status).toBe("unavailable");
  });
});

describe("executeTool with lib/providers present (post wave-4 state)", () => {
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
