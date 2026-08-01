import { z } from "zod";
import {
  readSnapshot,
  RepoConflictError,
  restoreSnapshotIfEmpty,
  type RepoSnapshot,
} from "../db/repo";
import { validateBackupIntegrity } from "./integrity";
import { BACKUP_VERSION, backupSchema, type Backup } from "./schema";

export { BACKUP_VERSION, backupSchema, validateBackupIntegrity };
export type { IntegrityIssue } from "./integrity";
export type { Backup } from "./schema";

export type ImportResult =
  | { ok: true; message: string; counts: Record<keyof RepoSnapshot, number> }
  | {
      ok: false;
      code: "invalid-json" | "invalid-backup" | "integrity" | "not-empty" | "restore";
      message: string;
    };

export type ExportResult =
  | { ok: true; method: "share" | "download"; message: string }
  | { ok: false; message: string };

export async function createBackup(now = new Date()): Promise<Backup> {
  return backupSchema.parse({
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: await readSnapshot(),
  });
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/** Parse, strip unknown fields, and return a human-readable result. */
export function parseBackupText(
  text: string,
): { ok: true; backup: Backup } | { ok: false; result: ImportResult } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      result: {
        ok: false,
        code: "invalid-json",
        message: "This file is not valid JSON. Choose a Nightstand backup file.",
      },
    };
  }

  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "invalid-backup",
        message: describeZodError(parsed.error),
      },
    };
  }

  const integrityIssues = validateBackupIntegrity(parsed.data);
  if (integrityIssues.length > 0) {
    const first = integrityIssues[0];
    return {
      ok: false,
      result: {
        ok: false,
        code: "integrity",
        message: `This backup is incomplete: ${first.path} ${first.message}. Nothing was imported.`,
      },
    };
  }

  return { ok: true, backup: parsed.data };
}

export async function importBackupText(text: string): Promise<ImportResult> {
  const parsed = parseBackupText(text);
  if (!parsed.ok) return parsed.result;

  try {
    await restoreSnapshotIfEmpty(parsed.backup.data);
  } catch (error) {
    const collision = error instanceof RepoConflictError;
    return {
      ok: false,
      code: collision ? "not-empty" : "restore",
      message: collision
        ? "This Nightstand is no longer empty. Nothing from the backup was imported."
        : "Nightstand could not restore this backup. Nothing was imported; check your device storage and try again.",
    };
  }

  const counts = Object.fromEntries(
    Object.entries(parsed.backup.data).map(([table, rows]) => [table, rows.length]),
  ) as Record<keyof RepoSnapshot, number>;
  return { ok: true, counts, message: "Backup restored successfully." };
}

/** Use the OS share sheet when it accepts files; otherwise download the JSON. */
export async function exportBackup(): Promise<ExportResult> {
  try {
    const backup = await createBackup();
    const filename = `nightstand-backup-${backup.exportedAt.slice(0, 10)}.json`;
    const file = new File([serializeBackup(backup)], filename, {
      type: "application/json",
    });
    const shareData: ShareData = {
      title: "Nightstand backup",
      text: "My Nightstand library backup",
      files: [file],
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return { ok: true, method: "share", message: "Backup shared." };
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true, method: "download", message: "Backup downloaded." };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, message: "Sharing was cancelled. No backup was sent." };
    }
    return {
      ok: false,
      message: "Nightstand could not create a backup. Please try again.",
    };
  }
}

function describeZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.length ? issue.path.join(".") : "the file";
  return `This is not a compatible Nightstand backup: ${path} ${issue?.message ?? "is invalid"}. Nothing was imported.`;
}
