import { z } from "zod";
import { type MediaRef, mediaRefSchema, type Medium, mediumSchema } from "../types";
import type { LlmToolDefinition } from "./transport";

/**
 * The tools the model may call while dealing a hand or chatting: check what
 * the user can actually access tonight, and search the world's catalog.
 *
 * ## The lib/providers seam (wave-4 wiring)
 *
 * E2.x builds the provider modules in parallel with this bead, so the
 * executor must not hard-depend on them. It expects `lib/providers` (barrel)
 * to export:
 *
 *   checkAvailability(itemRefs: MediaRef[]): Promise<unknown>
 *   searchCatalog(query: string, medium?: Medium): Promise<unknown>
 *
 * The default loader dynamic-imports that barrel with a non-literal specifier
 * (so the bundler doesn't fail the build while the module is absent) and any
 * failure degrades to a typed `unavailable` tool result the model can work
 * around. Once E2.x lands, wave-4 wiring replaces `defaultProvidersLoader`'s
 * body with a static `import("@/lib/providers")` — a one-line change — and
 * the `unavailable` path remains as the graceful degradation for genuinely
 * broken providers.
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

/**
 * Non-literal specifier defeats bundler static resolution: `lib/providers`
 * does not exist until E2.x merges, and a literal `import("@/lib/providers")`
 * would fail `next build` today. See the seam note above.
 */
const providersSpecifier = ["@", "lib", "providers"].join("/");

const defaultProvidersLoader: ProvidersLoader = () =>
  import(providersSpecifier) as Promise<ProvidersModule>;

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
