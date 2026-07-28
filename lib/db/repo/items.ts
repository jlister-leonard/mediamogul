// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import {
  genreAssignmentSchema,
  itemIdSchema,
  itemSchema,
  type Genre,
  type GenreAssignment,
  type Item,
  type ItemId,
  type ItemSeed,
  type Medium,
} from "../../types";
import { db } from "../index";
import { RepoNotFoundError, validate } from "./errors";
import { mintId } from "./mint";

/**
 * `items` — the canonical-title table (E1.2 repo layer).
 *
 * Storage verbs only: genre *assignment* is E4.1's logic and cross-provider
 * identity dedupe is E2.4's; this file just puts records in and reads them
 * back through the indexes `lib/db/schema.ts` declares.
 */

/**
 * Add a provider-normalized search result to the library, minting its
 * `ItemId` on the way in (the seed contract has no id by construction).
 *
 * Consumers: E2.5 omnibox add, E3.1 log flow's add-to-stack, E1.4's
 * Goodreads import.
 */
export async function addItem(seed: ItemSeed): Promise<Item> {
  const item = validate(
    itemSchema,
    { ...seed, id: mintId(itemIdSchema) },
    "items",
    "addItem",
  );
  await db.items.add(item);
  return item;
}

/** One title by id. Consumers: E3.3 detail page, E6.3's rec cards. */
export async function getItem(id: ItemId): Promise<Item | undefined> {
  return db.items.get(id);
}

/**
 * The whole library, whole-table. Not four `itemsByMedium` calls stitched
 * together: that loses every item the day the contract gains a medium, and
 * these consumers want the corpus, not a shelf.
 *
 * Consumers: E3.4 local search (titles, authors, tags, notes — no network),
 * E6.2 taste context, E1.3 export.
 */
export async function listItems(): Promise<Item[]> {
  return db.items.toArray();
}

/**
 * Every title of one medium, via the `medium` index.
 *
 * Consumers: E3.2 library filter by medium, E2.5's "Your library" scope,
 * E6.3's media-spanning hand.
 */
export async function itemsByMedium(medium: Medium): Promise<Item[]> {
  return db.items.where("medium").equals(medium).toArray();
}

/**
 * One ladder's pool, via the `genre.genre` dotted-keypath index. Items with
 * no genre assigned yet are absent from the index and so from this result —
 * which is the wanted semantics: an unassigned item cannot duel.
 *
 * Consumers: E3.2 library filter by genre, E4.1/E4.2 duel-pool selection.
 */
export async function itemsByGenre(genre: Genre): Promise<Item[]> {
  return db.items.where("genre.genre").equals(genre).toArray();
}

/**
 * Assign (or re-assign) an item's ladder. The whole updated record is
 * re-validated, so a bad assignment can never land; the read-modify-write
 * runs in a transaction so a concurrent auto-assignment cannot clobber a
 * manual one mid-flight.
 *
 * Consumers: E4.1 genre-assign (both the `auto` derivation and the `manual`
 * override that must never be clobbered).
 */
export async function setItemGenre(
  id: ItemId,
  assignment: GenreAssignment,
): Promise<Item> {
  const genre = validate(
    genreAssignmentSchema,
    assignment,
    "items",
    "setItemGenre",
  );
  return db.transaction("rw", db.items, async () => {
    const existing = await db.items.get(id);
    if (!existing) {
      throw new RepoNotFoundError("items", `setItemGenre: no item ${id}`);
    }
    const updated = validate(
      itemSchema,
      { ...existing, genre },
      "items",
      "setItemGenre",
    );
    await db.items.put(updated);
    return updated;
  });
}
