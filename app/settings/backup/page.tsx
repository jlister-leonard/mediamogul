"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { exportBackup, importBackupText } from "@/lib/backup";

type Notice = { tone: "success" | "error"; text: string };

export default function BackupSettingsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState<"export" | "import">();

  async function handleExport() {
    setBusy("export");
    setNotice(undefined);
    const result = await exportBackup();
    setNotice({ tone: result.ok ? "success" : "error", text: result.message });
    setBusy(undefined);
  }

  async function handleImport(file: File) {
    setBusy("import");
    setNotice(undefined);
    try {
      const result = await importBackupText(await file.text());
      setNotice({ tone: result.ok ? "success" : "error", text: result.message });
    } catch {
      setNotice({
        tone: "error",
        text: "Nightstand could not read that file. Nothing was imported.",
      });
    } finally {
      setBusy(undefined);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-6 py-12">
      <p className="text-sm font-medium text-accent">Settings</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Backup</h1>
      <p className="mt-3 text-fg-muted">
        Your library lives on this device. Save a backup somewhere safe before
        changing phones or clearing browser data.
      </p>

      <section aria-labelledby="export-heading" className="mt-10 rounded-xl bg-surface p-6">
        <h2 id="export-heading" className="text-xl font-semibold">Save a backup</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Includes your full library, ratings, notes, rankings, recommendations,
          availability, and Portrait history.
        </p>
        <Button className="mt-5" disabled={busy !== undefined} onClick={handleExport}>
          {busy === "export" ? "Preparing…" : "Export backup"}
        </Button>
      </section>

      <section aria-labelledby="import-heading" className="mt-6 rounded-xl bg-surface p-6">
        <h2 id="import-heading" className="text-xl font-semibold">Restore a backup</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Restore works only on a fresh, empty Nightstand. Invalid files are
          rejected without changing your library.
        </p>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Choose a Nightstand backup file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void handleImport(file);
          }}
        />
        <Button
          className="mt-5"
          variant="quiet"
          disabled={busy !== undefined}
          onClick={() => inputRef.current?.click()}
        >
          {busy === "import" ? "Restoring…" : "Choose backup file"}
        </Button>
      </section>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-6 rounded-md p-4 text-sm ${
            notice.tone === "success"
              ? "bg-surface text-fg"
              : "border border-line text-fg"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
    </main>
  );
}

