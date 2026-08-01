export {
  BOOK_GENRES,
  classifyGenre,
  normalizeGenreText,
  type GenreDecision,
  type GenreMetadata,
} from "./classify";

import type { Item } from "../types";
import { setAutoItemGenreIfAllowed } from "../db/repo";
import { classifyGenre } from "./classify";

/** Classify and atomically apply unless a manual assignment already exists. */
export async function applyAutoGenre(item: Item): Promise<Item> {
  const { genre } = classifyGenre(item).assignment;
  return setAutoItemGenreIfAllowed(item.id, genre);
}
