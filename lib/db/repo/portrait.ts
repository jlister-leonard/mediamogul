// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import { portraitSchema, type Portrait } from "../../types";
import { db } from "../index";
import { validate } from "./errors";
import { nowIso } from "./mint";

/**
 * `portrait` — the taste model, written down (E1.2 repo layer).
 *
 * Append-only and keyed by `version`: a synthesis never edits its
 * predecessor, so the history of what the model believed about you stays
 * readable (E7.1). The synthesis itself is E7.1's; this file mints the next
 * version number and stores the result.
 */

/** What a caller supplies; `version` and `synthesizedAt` are minted here. */
export type PortraitInput = Omit<Portrait, "version" | "synthesizedAt">;

/**
 * The current portrait — the last row in primary-key order, which is the
 * highest version. No secondary index needed, and no "is latest" flag to keep
 * in sync.
 *
 * Consumers: E7.2 portrait page, E7.1 (staleness check: refresh on app-open
 * ≥7 days old, and the corrections every synthesis carries forward).
 */
export async function latestPortrait(): Promise<Portrait | undefined> {
  return db.portrait.toCollection().last();
}

/**
 * Store a new synthesis as the next version. Reading the current version and
 * writing the successor happen in one transaction, so two syntheses racing on
 * app-open cannot mint the same version number.
 *
 * Corrections ride in the record: every synthesis receives all of them and
 * carries them forward (PLAN §4.6), and this layer stores what it is given
 * rather than merging — merge policy is E7.1's.
 *
 * Consumers: E7.1 portrait synthesis, E7.2 (a thumbs-down correction lands as
 * the next version).
 */
export async function appendPortraitVersion(
  input: PortraitInput,
): Promise<Portrait> {
  return db.transaction("rw", db.portrait, async () => {
    const current = await db.portrait.toCollection().last();
    const portrait = validate(
      portraitSchema,
      {
        ...input,
        version: (current?.version ?? 0) + 1,
        synthesizedAt: nowIso(),
      },
      "portrait",
      "appendPortraitVersion",
    );
    await db.portrait.add(portrait);
    return portrait;
  });
}
