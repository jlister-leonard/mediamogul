// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import {
  recIdSchema,
  recSchema,
  type Rec,
  type RecId,
  type RejectionReason,
  type SituationId,
} from "../../types";
import { db } from "../index";
import { RepoConflictError, RepoNotFoundError, validate } from "./errors";
import { mintId, nowIso } from "./mint";

/**
 * `recs` — what was suggested, why, and how it was turned down (E1.2 repo
 * layer). Negative signal is the flywheel (PLAN §4.3), so a rejection is a
 * first-class write, not a delete.
 */

/** What a caller supplies; the id, `dealtAt` and any rejection are handled here. */
export type RecInput = Omit<Rec, "id" | "dealtAt" | "rejection">;

/**
 * Persist a dealt recommendation. `reason` is non-empty by contract — a rec
 * that cannot cite your history does not ship (PLAN §10) — so a reasonless
 * rec fails here as a typed validation error.
 *
 * Consumers: E6.3 hand, E6.4 chat, E6.5 situation chips (each stamps its own
 * `source`).
 */
export async function recordRec(input: RecInput): Promise<Rec> {
  const rec = validate(
    recSchema,
    { ...input, id: mintId(recIdSchema), dealtAt: nowIso() },
    "recs",
    "recordRec",
  );
  await db.recs.add(rec);
  return rec;
}

/**
 * Record a one-tap dismissal with its reason. Rejecting twice is a conflict:
 * the first `at` is the one that dated the signal, and quietly overwriting it
 * would blur E6.6's "reject 3 long books → nothing >400 pages" test.
 *
 * Consumers: E6.6 rejection flow (every rec card, hand or chip or chat).
 */
export async function markRecRejected(
  id: RecId,
  reason: RejectionReason,
): Promise<Rec> {
  return db.transaction("rw", db.recs, async () => {
    const existing = await db.recs.get(id);
    if (!existing) {
      throw new RepoNotFoundError("recs", `markRecRejected: no rec ${id}`);
    }
    if (existing.rejection) {
      throw new RepoConflictError(
        "recs",
        `markRecRejected: rec ${id} was already rejected (${existing.rejection.reason})`,
      );
    }
    const updated = validate(
      recSchema,
      { ...existing, rejection: { reason, at: nowIso() } },
      "recs",
      "markRecRejected",
    );
    await db.recs.put(updated);
    return updated;
  });
}

/**
 * Every rec ever dealt, newest first, via the `dealtAt` index.
 *
 * Consumers: E6.2 taste context (rejection history with reasons), E6.3 (the
 * last hand, cached for instant open and offline display), E6.6.
 */
export async function recHistoryByRecency(): Promise<Rec[]> {
  return db.recs.orderBy("dealtAt").reverse().toArray();
}

/**
 * Recs dealt for one situation, via the `source.situationId` dotted-keypath
 * index. Hand and chat recs carry no such path and are simply absent — the
 * index is the filter.
 *
 * Consumers: E6.5 (the derived "what worked": join these against later
 * entries and stack adds).
 */
export async function recsBySituationId(
  situationId: SituationId,
): Promise<Rec[]> {
  return db.recs.where("source.situationId").equals(situationId).toArray();
}
