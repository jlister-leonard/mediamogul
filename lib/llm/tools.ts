import { z } from "zod";
import { resolve } from "../resolve";
import { type MediaRef, mediaRefSchema, type Medium, mediumSchema } from "../types";
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
  itemRefs: z.array(mediaRefSchema).min(1),
});
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilityInputSchema>;

export const searchCatalogInputSchema = z.object({
  query: z.string().min(1),
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
  checkAvailability?: (itemRefs: MediaRef[]) => Promise<unknown>;
  searchCatalog?: (query: string, medium?: Medium) => Promise<unknown>;
}

export type ProvidersLoader = () => Promise<ProvidersModule>;

/** Adapt the model's optional single-medium input to the resolver's scope. */
async function searchResolvedCatalog(
  query: string,
  medium?: Medium,
): Promise<unknown> {
  return await resolve(query, medium === undefined ? {} : { media: [medium] });
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
): Promise<ToolOutcome> {
  let providers: ProvidersModule;
  try {
    providers = await loadProviders();
  } catch {
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
        return { status: "ok", result: await providers.checkAvailability(parsed.data.itemRefs) };
      } catch {
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
        return { status: "ok", result: await providers.searchCatalog(parsed.data.query, parsed.data.medium) };
      } catch {
        return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
      }
    }
    default:
      return { status: "invalid-input", message: `Unknown tool: ${name}` };
  }
}
