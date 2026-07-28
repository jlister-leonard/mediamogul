// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import {
  situationIdSchema,
  situationSchema,
  type Situation,
  type SituationId,
} from "../../types";
import { db } from "../index";
import { RepoNotFoundError, validate } from "./errors";
import { mintId, nowIso } from "./mint";

/**
 * `situations` — saved openings for the recommender (E1.2 repo layer).
 *
 * What a situation *learned* is never stored here: it is derived by joining
 * recs carrying this situation's id against later entries and stack adds
 * (E6.5 note in EPICS.md). So the verbs are plain CRUD.
 */

/** What a caller supplies; the id and `createdAt` are minted here. */
export type SituationInput = Omit<Situation, "id" | "createdAt">;
/** The editable half of a saved situation. */
export type SituationPatch = Partial<Pick<Situation, "label" | "prompt">>;

/**
 * Save an opening — a built-in chip at first run, or one lifted from a chat
 * answer that worked.
 *
 * Consumers: E6.5 situations (built-in seeding + "save this as a chip"),
 * E6.4 chat.
 */
export async function createSituation(
  input: SituationInput,
): Promise<Situation> {
  const situation = validate(
    situationSchema,
    { ...input, id: mintId(situationIdSchema), createdAt: nowIso() },
    "situations",
    "createSituation",
  );
  await db.situations.add(situation);
  return situation;
}

/**
 * One situation by id — the ask handed to the engine when a chip is tapped.
 *
 * Consumers: E6.5 (chip tap → deal a hand), E6.2 (the situation's prompt in
 * the briefing).
 */
export async function getSituation(
  id: SituationId,
): Promise<Situation | undefined> {
  return db.situations.get(id);
}

/**
 * The whole chip row. A full-table read on purpose: the table stays
 * chip-sized by construction, which is why `lib/db/schema.ts` gives it no
 * secondary index.
 *
 * Consumers: E6.5 chip row.
 */
export async function listSituations(): Promise<Situation[]> {
  return db.situations.toArray();
}

/**
 * Rename or reword a saved situation. `source` and `createdAt` are
 * provenance and stay put; the merged record is re-validated before it lands.
 *
 * Consumers: E6.5 (editing a saved chip).
 */
export async function updateSituation(
  id: SituationId,
  patch: SituationPatch,
): Promise<Situation> {
  return db.transaction("rw", db.situations, async () => {
    const existing = await db.situations.get(id);
    if (!existing) {
      throw new RepoNotFoundError(
        "situations",
        `updateSituation: no situation ${id}`,
      );
    }
    const updated = validate(
      situationSchema,
      { ...existing, ...patch },
      "situations",
      "updateSituation",
    );
    await db.situations.put(updated);
    return updated;
  });
}

/**
 * Drop a chip. Recs that cite it keep their `source.situationId` — the
 * rejection and "what worked" history stay honest about where they came
 * from, even after the chip is gone.
 *
 * Consumers: E6.5 (removing a saved chip).
 */
export async function deleteSituation(id: SituationId): Promise<void> {
  await db.transaction("rw", db.situations, async () => {
    const existing = await db.situations.get(id);
    if (!existing) {
      throw new RepoNotFoundError(
        "situations",
        `deleteSituation: no situation ${id}`,
      );
    }
    await db.situations.delete(id);
  });
}
