import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("backup settings are accessible and export/import files in the browser", async ({
  page,
}) => {
  await page.goto("/settings/backup");

  await expect(page.getByRole("heading", { level: 1, name: "Backup" })).toBeVisible();
  await expect(page.getByLabel("Choose a Nightstand backup file")).toHaveAttribute(
    "accept",
    "application/json,.json",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^nightstand-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    version: number;
    data: Record<string, unknown[]>;
  };
  expect(backup.version).toBe(1);
  expect(Object.keys(backup.data)).toHaveLength(8);
  await expect(page.getByRole("status")).toHaveText("Backup downloaded.");

  await page.getByLabel("Choose a Nightstand backup file").setInputFiles({
    name: "corrupt.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  await expect(page.getByRole("status")).toContainText("not valid JSON");
});

