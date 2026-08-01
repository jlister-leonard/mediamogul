import { listItems } from "../db/repo/items";
import { readAvailabilityState } from "../db/repo/availability";
import type { AvailabilityContext } from "../llm/tools";
import { availabilityContextEntrySchema } from "../llm/tools";
import { AVAILABILITY_TTL_MS } from ".";

/**
 * Build the request-scoped E6 bridge from local IndexedDB. Only external
 * media refs and offer facts leave the browser; ids, titles, history,
 * ratings, notes, and queue state do not.
 */
export async function buildRecommendationAvailabilityContext(
  now: Date = new Date(),
): Promise<AvailabilityContext> {
  const items = (await listItems()).slice(0, 50);
  const entries = await Promise.all(items.map(async (item) => {
    const state = await readAvailabilityState(item.id);
    if (!isFresh(state, now)) return undefined;
    return availabilityContextEntrySchema.parse({
      ref: item.ref,
      offers: state.offers.map((offer) =>
        Object.fromEntries(
          Object.entries(offer).filter(([field]) => field !== "itemId"),
        ),
      ),
    });
  }));
  return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
}

function isFresh(
  state: Awaited<ReturnType<typeof readAvailabilityState>>,
  now: Date,
): boolean {
  const evidenceAt =
    state.offers.map((offer) => offer.fetchedAt).sort()[0] ??
    state.refresh?.fetchedAt;
  return (
    evidenceAt !== undefined &&
    now.getTime() < Date.parse(evidenceAt) + AVAILABILITY_TTL_MS
  );
}
