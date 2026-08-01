// Relative (not "@/lib/..."): vitest's vite config resolves no path aliases,
// and every lib/ module keeps imports alias-free for that reason.
import type { z } from "zod";

/**
 * The repo layer's failure vocabulary (E1.2).
 *
 * The schema layer deliberately does not validate (see `lib/db/schema.ts`),
 * so this layer is the single gate every record passes on its way into
 * IndexedDB. Failures are thrown, not returned: a local write that violates a
 * contract is a bug in the calling bead, not a condition the UI renders — the
 * provider modules' `{ ok: false }` envelopes exist because *networks* fail,
 * which is a different thing.
 *
 * `code` is a discriminant so a caller can branch without `instanceof`
 * chains (E3.1's optimistic writes distinguish "already on the stack" from a
 * genuinely bad record).
 */
export type RepoErrorCode = "validation" | "not-found" | "conflict";

/** Every table name this layer writes — carried on errors for legible messages. */
export type RepoTable =
  | "items"
  | "entries"
  | "comparisons"
  | "queue"
  | "situations"
  | "availability"
  | "recs"
  | "portrait"
  | "manualMatches"
  | "availabilityRefreshes";

export abstract class RepoError extends Error {
  abstract readonly code: RepoErrorCode;
  readonly table: RepoTable;

  constructor(table: RepoTable, message: string) {
    super(message);
    this.name = new.target.name;
    this.table = table;
  }
}

/**
 * A write whose record failed its contract schema. `issues` is Zod's raw issue
 * list, kept so callers (and E1.3's import path, which reports corrupt backups
 * to a human) can say which field was wrong.
 */
export class RepoValidationError extends RepoError {
  readonly code = "validation" as const;
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(table: RepoTable, message: string, issues: readonly z.core.$ZodIssue[]) {
    super(table, message);
    this.issues = issues;
  }
}

/** A write or transition addressed at a row that is not there. */
export class RepoNotFoundError extends RepoError {
  readonly code = "not-found" as const;
}

/**
 * A write the current state forbids: a duplicate stack add, a second open
 * entry for one item, finishing something that was never started.
 */
export class RepoConflictError extends RepoError {
  readonly code = "conflict" as const;
}

/**
 * The validation gate itself. Every write in this layer routes its record
 * through here before it reaches Dexie, so nothing enters IndexedDB that the
 * `lib/types` contracts would reject.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
  table: RepoTable,
  verb: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // Zod always reports at least one issue, but the message must not depend on
  // that: a validation failure reported as a TypeError would be worse than the
  // failure itself.
  const first = result.error.issues.at(0);
  const where = first?.path.length ? first.path.join(".") : "(record)";
  throw new RepoValidationError(
    table,
    `${verb}: invalid ${table} record at ${where} — ${first?.message ?? "failed contract validation"}`,
    result.error.issues,
  );
}
