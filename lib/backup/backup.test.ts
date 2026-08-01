import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { readSnapshot, restoreSnapshot } from "../db/repo";
import {
  backupSchema,
  createBackup,
  importBackupText,
  parseBackupText,
  serializeBackup,
  validateBackupIntegrity,
  type Backup,
} from ".";

const T0 = "2026-08-01T14:30:00.000Z";

function completeBackup(): Backup {
  return backupSchema.parse({
    version: 1,
    exportedAt: T0,
    data: {
      items: [
        {
          id: "item-book",
          medium: "book",
          title: "Bad Blood",
          creators: ["John Carreyrou"],
          ref: { medium: "book", isbn13: "9781524731656" },
          genre: { genre: "money-markets", source: "auto" },
        },
        {
          id: "item-rival",
          medium: "book",
          title: "Going Infinite",
          creators: ["Michael Lewis"],
          ref: { medium: "book", isbn13: "9781324074335" },
          genre: { genre: "money-markets", source: "manual" },
        },
      ],
      entries: [
        {
          id: "entry-1",
          itemId: "item-book",
          status: "finished",
          startedAt: "2026-07-01T09:00:00.000Z",
          finishedAt: "2026-07-08T19:12:31.125Z",
          gradient: "loved",
          mode: "admired",
          tags: ["voice"],
          note: "Reporting with momentum.",
        },
      ],
      comparisons: [
        {
          id: "comparison-1",
          genre: "money-markets",
          winnerId: "item-book",
          loserId: "item-rival",
          comparedAt: "2026-07-09T08:05:00.000Z",
        },
      ],
      queue: [
        {
          id: "queue-1",
          itemId: "item-rival",
          contextTags: ["flight"],
          addedAt: "2026-07-10T12:00:00.000Z",
        },
      ],
      situations: [
        {
          id: "situation-1",
          label: "Long flight",
          prompt: "Six hours, no wifi.",
          source: "chat",
          createdAt: "2026-07-10T12:01:00.000Z",
        },
      ],
      availability: [
        {
          itemId: "item-rival",
          region: "US",
          kind: "buy",
          providerId: "kindle",
          priceUsd: 14.99,
          fetchedAt: "2026-07-11T10:00:00.000Z",
        },
      ],
      recs: [
        {
          id: "rec-1",
          itemId: "item-rival",
          reason: "You loved Bad Blood.",
          source: { entry: "situation", situationId: "situation-1" },
          dealtAt: "2026-07-10T12:02:00.000Z",
        },
      ],
      portrait: [
        {
          version: 1,
          synthesizedAt: "2026-07-12T10:00:00.000Z",
          claims: [{ kind: "obsession", text: "Institutional failure" }],
          corrections: [],
        },
      ],
    },
  });
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterAll(() => db.close());

describe("Nightstand backup", () => {
  it("round-trips every table into a fresh install identically", async () => {
    const original = completeBackup();
    await restoreSnapshot(original.data);
    const before = await readSnapshot();
    const exported = await createBackup(new Date(T0));

    await Promise.all(db.tables.map((table) => table.clear()));
    const result = await importBackupText(serializeBackup(exported));

    expect(result).toMatchObject({ ok: true, message: "Backup restored successfully." });
    expect(await readSnapshot()).toEqual(before);
  });

  it("strips unknown envelope and nested fields for forward compatibility", () => {
    const raw = completeBackup() as Backup & {
      futureEnvelope?: boolean;
      data: Backup["data"] & { futureTable?: unknown[] };
    };
    raw.futureEnvelope = true;
    raw.data.futureTable = [];
    (raw.data.items[0] as Backup["data"]["items"][number] & { future?: string }).future = "later";

    const parsed = parseBackupText(JSON.stringify(raw));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.backup).not.toHaveProperty("futureEnvelope");
      expect(parsed.backup.data).not.toHaveProperty("futureTable");
      expect(parsed.backup.data.items[0]).not.toHaveProperty("future");
    }
  });

  it("rejects malformed JSON and millisecond-less timestamps in human words", async () => {
    expect(await importBackupText("{oops")).toMatchObject({
      ok: false,
      code: "invalid-json",
    });

    const corrupt = completeBackup();
    const raw = JSON.parse(JSON.stringify(corrupt)) as Record<string, unknown>;
    raw.exportedAt = "2026-08-01T14:30:00Z";
    const result = await importBackupText(JSON.stringify(raw));

    expect(result).toMatchObject({ ok: false, code: "invalid-backup" });
    expect(result.message).toContain("Nothing was imported");
    expect(await readSnapshot()).toEqual({
      items: [], entries: [], comparisons: [], queue: [], situations: [],
      availability: [], recs: [], portrait: [],
    });
  });

  it("rejects dangling and semantically invalid cross-references", () => {
    const missing = completeBackup();
    missing.data.entries[0].itemId = "missing-item" as typeof missing.data.entries[0]["itemId"];
    expect(validateBackupIntegrity(missing)[0]).toMatchObject({
      path: "data.entries.0.itemId",
    });

    const wrongLadder = completeBackup();
    wrongLadder.data.items[0].genre = {
      genre: "lives",
      source: "auto",
    };
    expect(validateBackupIntegrity(wrongLadder)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "data.comparisons.0.winnerId" }),
      ]),
    );
  });

  it("preserves recommendation provenance after its situation was deleted", async () => {
    const backup = completeBackup();
    backup.data.situations = [];

    expect(validateBackupIntegrity(backup)).toEqual([]);
    expect(await importBackupText(serializeBackup(backup))).toMatchObject({ ok: true });
    expect((await readSnapshot()).recs[0].source).toEqual({
      entry: "situation",
      situationId: "situation-1",
    });
  });

  it("refuses to merge a backup into any non-empty database", async () => {
    const backup = completeBackup();
    await restoreSnapshot({ availability: backup.data.availability });

    const result = await importBackupText(serializeBackup(backup));

    expect(result).toMatchObject({ ok: false, code: "not-empty" });
    expect(await db.availability.count()).toBe(1);
    expect(await db.items.count()).toBe(0);
  });

  it("rejects duplicate persisted keys before writing", async () => {
    const raw = JSON.parse(JSON.stringify(completeBackup())) as {
      data: { items: unknown[] };
    };
    raw.data.items.push(raw.data.items[0]);

    const result = await importBackupText(JSON.stringify(raw));

    expect(result).toMatchObject({ ok: false, code: "integrity" });
    expect(result.message).toContain("duplicates key");
    expect(await db.items.count()).toBe(0);
  });

  it("atomically loses a race to a concurrent writer and imports nothing", async () => {
    const backup = completeBackup();
    let releaseWriter!: () => void;
    let writerEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const entered = new Promise<void>((resolve) => { writerEntered = resolve; });
    const competingItem = {
      ...backup.data.items[0],
      id: "item-concurrent" as typeof backup.data.items[0]["id"],
    };

    const writer = db.transaction("rw", db.tables, async () => {
      await db.items.add(competingItem);
      writerEntered();
      await Dexie.waitFor(release);
    });
    await entered;

    const importing = Dexie.ignoreTransaction(() =>
      importBackupText(serializeBackup(backup)),
    );
    releaseWriter();
    await writer;

    expect(await importing).toMatchObject({ ok: false, code: "not-empty" });
    expect(await db.items.toArray()).toEqual([competingItem]);
    expect(await db.entries.count()).toBe(0);
    expect(await db.availability.count()).toBe(0);
  });
});

describe("backup delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(T0));
  });

  it("shares a JSON File with a deterministic name when file sharing is available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });

    const { exportBackup } = await import(".");
    const result = await exportBackup();

    expect(result).toEqual({ ok: true, method: "share", message: "Backup shared." });
    expect(canShare).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledOnce();
    const payload = share.mock.calls[0][0] as ShareData;
    expect(payload.title).toBe("Nightstand backup");
    expect(payload.files).toHaveLength(1);
    expect(payload.files?.[0]).toMatchObject({
      name: "nightstand-backup-2026-08-01.json",
      type: "application/json",
    });
    const contents = JSON.parse(await readBlob(payload.files![0])) as {
      version: number;
      data: Record<string, unknown[]>;
    };
    expect(contents.version).toBe(1);
    expect(Object.keys(contents.data).sort()).toEqual([
      "availability", "comparisons", "entries", "items", "portrait",
      "queue", "recs", "situations",
    ]);
  });

  it("downloads the same JSON file and revokes its blob URL as a fallback", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:nightstand-backup");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { exportBackup } = await import(".");
    const result = await exportBackup();

    expect(result).toEqual({ ok: true, method: "download", message: "Backup downloaded." });
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ name: "nightstand-backup-2026-08-01.json" }),
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:nightstand-backup");
  });

  it("reports a cancelled share without attempting a download", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("navigator", { share, canShare: vi.fn().mockReturnValue(true) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { exportBackup } = await import(".");
    const result = await exportBackup();

    expect(result).toEqual({
      ok: false,
      message: "Sharing was cancelled. No backup was sent.",
    });
    expect(click).not.toHaveBeenCalled();
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}
