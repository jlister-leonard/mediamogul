import { z } from "zod";
import { resolve } from "../resolve";
import { type MediaRef, mediaRefSchema, type Medium, mediumSchema } from "../types";
import {
  MAX_AVAILABILITY_REFS,
  MAX_CATALOG_QUERY_CHARS,
  MAX_SERIALIZED_TOOL_RESULT_CHARS,
} from "./config";
import type { LlmToolDefinition } from "./transport";

/**
 * The tools the model may call while dealing a hand or chatting: check what
 * the user can actually access tonight, and search the world's catalog.
 *
 * Catalog search is statically wired to E2.4's resolver so the production
 * bundle includes the real provider fan-out and identity-deduplication path.
 * Availability remains optional until E5.1 supplies it; its absence degrades
 * to the typed `unavailable` result below rather than claiming it was checked.
 */

export const checkAvailabilityInputSchema = z.object({
  itemRefs: z.array(mediaRefSchema).min(1).max(MAX_AVAILABILITY_REFS),
});
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilityInputSchema>;

export const searchCatalogInputSchema = z.object({
  query: z.string().min(1).max(MAX_CATALOG_QUERY_CHARS),
  medium: mediumSchema.optional(),
});
export type SearchCatalogInput = z.infer<typeof searchCatalogInputSchema>;

export const TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [
  {
    name: "check_availability",
    description:
      "Check which of the user's services can play, stream, or supply the given items right now. Call this before recommending anything the user would have to go get.",
    inputSchema: z.toJSONSchema(checkAvailabilityInputSchema),
  },
  {
    name: "search_catalog",
    description:
      "Search the world's catalog of books, movies, TV shows, and podcasts by free-text query, optionally narrowed to one medium. Call this to resolve a title you want to recommend into a concrete item.",
    inputSchema: z.toJSONSchema(searchCatalogInputSchema),
  },
];

/** What a tool execution hands back to the model, always as a typed shape. */
export type ToolOutcome =
  | { status: "ok"; result: unknown }
  | { status: "invalid-input"; message: string }
  | { status: "unavailable"; message: string };

interface ProvidersModule {
  checkAvailability?: (itemRefs: MediaRef[], signal?: AbortSignal) => Promise<unknown>;
  searchCatalog?: (
    query: string,
    medium?: Medium,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

export type ProvidersLoader = (signal?: AbortSignal) => Promise<ProvidersModule>;

/** Adapt the model's optional single-medium input to the resolver's scope. */
async function searchResolvedCatalog(
  query: string,
  medium?: Medium,
  signal?: AbortSignal,
): Promise<unknown> {
  throwIfAborted(signal);
  const result = await waitForOrAbort(
    resolve(query, medium === undefined ? {} : { media: [medium] }),
    signal,
  );
  throwIfAborted(signal);
  return result;
}

/**
 * This static adapter is deliberately a loader-shaped value: production gets
 * bundle-safe imports while tests can still inject deterministic tool fakes.
 */
const defaultProvidersLoader: ProvidersLoader = async () => ({
  searchCatalog: searchResolvedCatalog,
});

const UNAVAILABLE_MESSAGE =
  "This capability is not available right now; recommend without it and say availability was not checked.";

/**
 * Execute one model-requested tool call. Inputs are zod-validated; every
 * failure mode returns a typed outcome rather than throwing, so the model
 * always gets a tool result it can reason about.
 */
export async function executeTool(
  name: string,
  input: unknown,
  loadProviders: ProvidersLoader = defaultProvidersLoader,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  let providers: ProvidersModule;
  try {
    throwIfAborted(signal);
    providers = await waitForOrAbort(loadProviders(signal), signal);
    throwIfAborted(signal);
  } catch {
    if (signal?.aborted) throw abortReason(signal);
    return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  switch (name) {
    case "check_availability": {
      const parsed = checkAvailabilityInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: "invalid-input", message: "itemRefs must be a non-empty array of media refs." };
      }
      if (providers.checkAvailability === undefined) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      try {
        const result = await waitForOrAbort(
          providers.checkAvailability(parsed.data.itemRefs, signal),
          signal,
        );
        throwIfAborted(signal);
        return { status: "ok", result };
      } catch {
        if (signal?.aborted) throw abortReason(signal);
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
    }
    case "search_catalog": {
      const parsed = searchCatalogInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: "invalid-input", message: "query must be a non-empty string; medium, if given, one of book|movie|tv|podcast." };
      }
      if (providers.searchCatalog === undefined) {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
      try {
        const result = await waitForOrAbort(
          providers.searchCatalog(parsed.data.query, parsed.data.medium, signal),
          signal,
        );
        throwIfAborted(signal);
        return { status: "ok", result };
      } catch {
        if (signal?.aborted) throw abortReason(signal);
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
    }
    default:
      return { status: "invalid-input", message: `Unknown tool: ${name}` };
  }
}

/**
 * Tool results are replayed into the next billed model turn. Keep one result
 * below 64,000 characters so a surprising provider payload cannot dominate
 * context or memory. Oversize/circular results degrade to a small typed result.
 */
export function serializeToolOutcome(outcome: ToolOutcome): string {
  try {
    const serialized = JSON.stringify(outcome);
    if (serialized.length <= MAX_SERIALIZED_TOOL_RESULT_CHARS) {
      return serialized;
    }
  } catch {
    // Fall through to the small typed result below.
  }
  return JSON.stringify({
    status: "unavailable",
    message: "The tool result was too large to use safely; continue without it.",
  } satisfies ToolOutcome);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function waitForOrAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return await promise;
  throwIfAborted(signal);
  return await new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => rejectPromise(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolvePromise, rejectPromise).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
