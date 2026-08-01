import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BackupSettingsPage from "./page";

const mocks = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  importBackupText: vi.fn(),
}));

vi.mock("@/lib/backup", () => mocks);

beforeEach(() => {
  mocks.exportBackup.mockReset();
  mocks.importBackupText.mockReset();
});

describe("Backup settings", () => {
  it("exposes labelled controls and announces export and import outcomes", async () => {
    mocks.exportBackup.mockResolvedValue({
      ok: true,
      method: "download",
      message: "Backup downloaded.",
    });
    mocks.importBackupText.mockResolvedValue({
      ok: false,
      code: "invalid-backup",
      message: "This is not a compatible Nightstand backup. Nothing was imported.",
    });
    render(<BackupSettingsPage />);

    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Backup" })).toBeTruthy();
    expect(
      screen.getByLabelText("Choose a Nightstand backup file").getAttribute("accept"),
    ).toBe("application/json,.json");

    fireEvent.click(screen.getByRole("button", { name: "Export backup" }));
    expect((await screen.findByRole("status")).textContent).toContain("Backup downloaded.");

    const file = new File(["{}"], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue("{}") });
    fireEvent.change(screen.getByLabelText("Choose a Nightstand backup file"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(mocks.importBackupText).toHaveBeenCalledWith("{}"));
    expect(screen.getByRole("status").textContent).toContain(
      "This is not a compatible Nightstand backup. Nothing was imported.",
    );
  });
});
