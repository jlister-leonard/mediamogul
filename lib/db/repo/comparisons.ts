// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import Dexie from "dexie";
import {
  comparisonIdSchema,
  comparisonSchema,
  type Comparison,
  type Genre,
} from "../../types";
import { db } from "../index";
import { validate } from "./errors";
import { mintId, nowIso } from "./mint";

/**
 * `comparisons` — the pairwise duel log (E1.2 repo layer).
 *
 * Append-only: a duel is a historical fact, so there is no update or delete
 * verb. The Elo math that reads this log lives in E4.2; this file stores and
 * replays, nothing more.
 */

/** What a caller supplies; the id and `comparedAt` are minted here. */
export type ComparisonInput = Omit<Comparison, "id" | "comparedAt">;

/**
 * A one-genre key range over the `[genre+comparedAt]` compound index.
 *
 * The compound serves genre-equality *and* chronological order with one
 * index, but only through a prefix range — `where("[genre+comparedAt]")
 * .equals(g)` cannot match a two-element key. Wrapped here so no consuming
 * bead has to re-derive the `minKey`/`maxKey` bounds.
 */
function genrePrefixRange(genre: Genre) {
  return db.comparisons
    .where("[genre+comparedAt]")
    .between([genre, Dexie.minKey], [genre, Dexie.maxKey]);
}

/**
 * Record a duel result. The contract refuses an item duelling itself, so that
 * arrives here as a typed validation error rather than a corrupt ladder.
 *
 * Consumers: E4.3 duel UI (tap a winner), E4.5 ladder screen
 * (drag-to-correct writes a comparison).
 */
export async function appendComparison(
  input: ComparisonInput,
): Promise<Comparison> {
  const comparison = validate(
    comparisonSchema,
    { ...input, id: mintId(comparisonIdSchema), comparedAt: nowIso() },
    "comparisons",
    "appendComparison",
  );
  await db.comparisons.add(comparison);
  return comparison;
}

/**
 * One ladder's duels, oldest first — the replay sequential Elo updates run
 * over. Chronological because millisecond-ISO timestamps sort
 * lexicographically as IndexedDB keys (contract invariant), and
 * genre-isolated because cross-genre duels never happen (PLAN §4.2).
 *
 * Consumers: E4.2 ladder engine (score replay), E4.5 ladder screen
 * (confidence from duel count).
 */
export async function replayComparisonsByGenre(
  genre: Genre,
): Promise<Comparison[]> {
  return genrePrefixRange(genre).toArray();
}
