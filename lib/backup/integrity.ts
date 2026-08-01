import type { Backup } from "./schema";

export interface IntegrityIssue {
  path: string;
  message: string;
}

/** Validate the graph between records after shape validation, before writes. */
export function validateBackupIntegrity(backup: Backup): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const items = new Map(backup.data.items.map((item) => [item.id, item]));

  checkUnique(backup.data.items, "items", (row) => row.id, issues);
  checkUnique(backup.data.entries, "entries", (row) => row.id, issues);
  checkUnique(backup.data.comparisons, "comparisons", (row) => row.id, issues);
  checkUnique(backup.data.queue, "queue", (row) => row.id, issues);
  checkUnique(backup.data.situations, "situations", (row) => row.id, issues);
  checkUnique(backup.data.recs, "recs", (row) => row.id, issues);
  checkUnique(backup.data.portrait, "portrait", (row) => row.version, issues);
  checkUnique(backup.data.manualMatches, "manualMatches", (row) => row.id, issues);
  checkUnique(
    backup.data.availabilityRefreshes,
    "availabilityRefreshes",
    (row) => row.itemId,
    issues,
  );

  backup.data.entries.forEach((entry, index) => {
    requireItem(items, entry.itemId, `data.entries.${index}.itemId`, issues);
  });
  backup.data.queue.forEach((row, index) => {
    requireItem(items, row.itemId, `data.queue.${index}.itemId`, issues);
  });
  backup.data.availability.forEach((row, index) => {
    requireItem(items, row.itemId, `data.availability.${index}.itemId`, issues);
  });
  backup.data.availabilityRefreshes.forEach((row, index) => {
    requireItem(items, row.itemId, `data.availabilityRefreshes.${index}.itemId`, issues);
  });
  backup.data.recs.forEach((rec, index) => {
    requireItem(items, rec.itemId, `data.recs.${index}.itemId`, issues);
  });
  backup.data.comparisons.forEach((comparison, index) => {
    for (const side of ["winnerId", "loserId"] as const) {
      const item = items.get(comparison[side]);
      const path = `data.comparisons.${index}.${side}`;
      if (!item) {
        issues.push({
          path,
          message: `references missing item “${comparison[side]}”`,
        });
      } else if (item.genre?.genre !== comparison.genre) {
        issues.push({
          path,
          message: `references an item outside the “${comparison.genre}” ladder`,
        });
      }
    }
  });

  return issues;
}

function checkUnique<T>(
  rows: readonly T[],
  table: string,
  keyOf: (row: T) => string | number,
  issues: IntegrityIssue[],
): void {
  const seen = new Set<string | number>();
  rows.forEach((row, index) => {
    const key = keyOf(row);
    if (seen.has(key)) {
      issues.push({
        path: `data.${table}.${index}`,
        message: `duplicates key “${key}”`,
      });
    }
    seen.add(key);
  });
}

function requireItem(
  items: ReadonlyMap<string, unknown>,
  itemId: string,
  path: string,
  issues: IntegrityIssue[],
): void {
  if (!items.has(itemId)) {
    issues.push({ path, message: `references missing item “${itemId}”` });
  }
}
