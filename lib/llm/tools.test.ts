// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
}));

vi.mock("../resolve", () => ({
  resolve: resolveMock,
}));

import {
  checkAvailabilityInputSchema,
  executeTool,
  searchCatalogInputSchema,
  serializeToolOutcome,
  TOOL_DEFINITIONS,
} from "./tools";

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

  it("accepts a 500-character catalog query and rejects 501", () => {
    expect(
      searchCatalogInputSchema.safeParse({ query: "q".repeat(500) }).success,
    ).toBe(true);
    expect(
      searchCatalogInputSchema.safeParse({ query: "q".repeat(501) }).success,
    ).toBe(false);
  });

  it("accepts 50 availability refs and rejects 51", () => {
    expect(
      checkAvailabilityInputSchema.safeParse({ itemRefs: Array(50).fill(movieRef) })
        .success,
    ).toBe(true);
    expect(
      checkAvailabilityInputSchema.safeParse({ itemRefs: Array(51).fill(movieRef) })
        .success,
    ).toBe(false);
  });
});

describe("tool execution safety", () => {
  it("caps every serialized tool result at 64,000 characters", () => {
    expect(serializeToolOutcome({ status: "ok", result: "small" })).toBe(
      JSON.stringify({ status: "ok", result: "small" }),
    );
    const serialized = serializeToolOutcome({
      status: "ok",
      result: "x".repeat(100_000),
    });
    expect(serialized.length).toBeLessThanOrEqual(64_000);
    expect(JSON.parse(serialized)).toMatchObject({ status: "unavailable" });
    expect(serialized).not.toContain("x".repeat(1_000));
  });

  it("rejects before loading a provider when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const loader = vi.fn(() => Promise.resolve({}));
    await expect(
      executeTool("search_catalog", { query: "x" }, loader, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("passes the signal to a provider and stops waiting when it aborts", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const never = new Promise<unknown>(() => {});
    const pending = executeTool(
      "search_catalog",
      { query: "x" },
      () =>
        Promise.resolve({
          searchCatalog: (_query, _medium, signal) => {
            observedSignal = signal;
            markStarted();
            return never;
          },
        }),
      controller.signal,
    );
    await started;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal).toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
  });
});
